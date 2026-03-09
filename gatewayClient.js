// gatewayClient.js - HTTP bridge from CommandDesk -> local OpenClaw gateway
// Uses the OpenAI-compatible /v1/chat/completions endpoint exposed by the
// running gateway. This keeps the Electron app simple: text in, text out.

import { promises as fs } from "fs";
import path from "path";

const OPENCLAW_CONFIG = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".openclaw",
  "openclaw.json"
);

const DEFAULT_AGENT = "main";
const DEFAULT_SESSION = "agent:main:commanddesk";
const DEFAULT_PROBE_TIMEOUT_MS = 3500;

const gatewayConnectionState = {
  connected: false,
  gatewayUrl: null,
  agentId: DEFAULT_AGENT,
  checkedAt: null,
  lastConnectedAt: null,
  lastError: "Not checked yet",
  via: "none"
};

function log(...args) {
  console.log("[gatewayClient:http]", ...args);
}

function snapshotGatewayStatus() {
  return { ...gatewayConnectionState };
}

function markGatewayConnected({ gatewayUrl, agentId, via }) {
  const nowIso = new Date().toISOString();
  gatewayConnectionState.connected = true;
  gatewayConnectionState.gatewayUrl = gatewayUrl || gatewayConnectionState.gatewayUrl || null;
  gatewayConnectionState.agentId = agentId || gatewayConnectionState.agentId || DEFAULT_AGENT;
  gatewayConnectionState.checkedAt = nowIso;
  gatewayConnectionState.lastConnectedAt = nowIso;
  gatewayConnectionState.lastError = null;
  gatewayConnectionState.via = via || "chat";
}

function markGatewayDisconnected(err, { gatewayUrl = null, agentId = DEFAULT_AGENT, via = "unknown" } = {}) {
  gatewayConnectionState.connected = false;
  gatewayConnectionState.gatewayUrl = gatewayUrl || gatewayConnectionState.gatewayUrl || null;
  gatewayConnectionState.agentId = agentId || gatewayConnectionState.agentId || DEFAULT_AGENT;
  gatewayConnectionState.checkedAt = new Date().toISOString();
  gatewayConnectionState.lastError = err?.message || String(err) || "Unknown gateway error";
  gatewayConnectionState.via = via;
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS));
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    }
  };
}

async function tryGatewayProbe({ url, token, agentId, timeoutMs, pathName }) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(new URL(pathName, url).toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-openclaw-agent-id": agentId || DEFAULT_AGENT
      },
      signal: timeout.signal
    });

    if (response.ok) {
      return { ok: true, status: response.status };
    }

    let snippet = "";
    try {
      snippet = (await response.text()).slice(0, 200);
    } catch {
      snippet = "";
    }

    return {
      ok: false,
      status: response.status,
      error: `${pathName} HTTP ${response.status}${snippet ? `: ${snippet}` : ""}`
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.name === "AbortError"
        ? `Gateway probe timed out (${pathName})`
        : (err?.message || String(err))
    };
  } finally {
    timeout.clear();
  }
}

async function loadGatewayConfig() {
  const raw = await fs.readFile(OPENCLAW_CONFIG, "utf8");
  const json = JSON.parse(raw);
  const gateway = json.gateway || {};
  const port = gateway.port || 18789;
  const token = gateway.auth?.token;

  if (!token) {
    throw new Error("No gateway token found in ~/.openclaw/openclaw.json");
  }

  return { url: `http://127.0.0.1:${port}`, token };
}

export function getGatewayConnectionStatus() {
  return snapshotGatewayStatus();
}

export async function probeGatewayConnection({ agentId = DEFAULT_AGENT, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  let config;
  try {
    config = await loadGatewayConfig();
  } catch (err) {
    markGatewayDisconnected(err, { agentId, via: "config" });
    return snapshotGatewayStatus();
  }

  const { url, token } = config;
  const checks = ["/health", "/v1/models"];
  const errors = [];

  for (const pathName of checks) {
    const result = await tryGatewayProbe({ url, token, agentId, timeoutMs, pathName });
    if (result.ok) {
      markGatewayConnected({ gatewayUrl: url, agentId, via: `probe:${pathName}` });
      return snapshotGatewayStatus();
    }
    if (result.error) {
      errors.push(result.error);
    }
  }

  markGatewayDisconnected(new Error(errors.join(" | ") || "Gateway probe failed"), {
    gatewayUrl: url,
    agentId,
    via: "probe"
  });
  return snapshotGatewayStatus();
}

/**
 * Send one chat turn through the gateway using the HTTP
 * /v1/chat/completions endpoint.
 *
 * Params:
 *   text: string                // user message
 *   conversationId?: string     // optional, used to stabilize sessions
 *   session?: string            // optional explicit session key
 *   agentId?: string            // optional target agent id (defaults to main)
 *   contextMessages?: Array     // optional system/developer messages prepended before the user turn
 */
export async function sendChatThroughGateway({
  text,
  conversationId = null,
  session = DEFAULT_SESSION,
  agentId = DEFAULT_AGENT,
  contextMessages = []
}) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Message is empty.");
  }

  let config;
  try {
    config = await loadGatewayConfig();
  } catch (err) {
    markGatewayDisconnected(err, { agentId, via: "config" });
    throw err;
  }

  const { url, token } = config;

  const endpoint = new URL("/v1/chat/completions", url).toString();

  const agentKey = agentId || DEFAULT_AGENT;
  const sessionKey = session || (conversationId ? `agent:${agentKey}:commanddesk:${conversationId}` : `agent:${agentKey}:commanddesk`);
  
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "x-openclaw-agent-id": agentId || DEFAULT_AGENT,
    "x-openclaw-session-key": sessionKey,
    "x-openclaw-message-channel": "webchat"
  };

  const body = {
    model: "openclaw",
    // Also provide an OpenAI-style user tag for extra stability.
    user: conversationId ? `commanddesk:${conversationId}` : "commanddesk:matt",
    messages: [
      ...(Array.isArray(contextMessages) ? contextMessages.filter(message => message && typeof message === "object") : []),
      { role: "user", content: text.trim() }
    ]
  };

  log("POST", endpoint, "session=", sessionKey);

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  } catch (err) {
    log("HTTP error", err);
    markGatewayDisconnected(new Error("Unable to reach OpenClaw gateway HTTP endpoint"), {
      gatewayUrl: url,
      agentId: agentKey,
      via: "chat"
    });
    throw new Error("Unable to reach OpenClaw gateway HTTP endpoint");
  }

  if (!res.ok) {
    const snippet = await res.text().catch(() => "");
    log("Non-200 from gateway", res.status, snippet.slice(0, 512));
    const statusErr = new Error(`Gateway HTTP ${res.status}: ${snippet.slice(0, 256)}`);
    markGatewayDisconnected(statusErr, {
      gatewayUrl: url,
      agentId: agentKey,
      via: "chat"
    });
    throw statusErr;
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    log("JSON parse error", err);
    const parseErr = new Error("Invalid JSON from gateway chatCompletions endpoint");
    markGatewayDisconnected(parseErr, {
      gatewayUrl: url,
      agentId: agentKey,
      via: "chat"
    });
    throw parseErr;
  }

  const reply = json?.choices?.[0]?.message?.content ?? "";
  if (!reply) {
    log("Empty reply payload", JSON.stringify(json).slice(0, 512));
  }

  markGatewayConnected({ gatewayUrl: url, agentId: agentKey, via: "chat" });
  return { reply };
}
