import { app, BrowserWindow, Notification, dialog, ipcMain, screen, session, shell } from "electron";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { loadMemory, saveMemory } from "./memory/memory.js";
import { getOpenAIKey, setOpenAIKey } from "./config/settings.js";
import { listNextEvents } from "./googleAPI.js";
import {
  getGatewayConnectionStatus,
  probeGatewayConnection,
  sendChatThroughGateway
} from "./gatewayClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chatsDir = path.join(__dirname, "chats");
const mergedChatsFile = path.join(chatsDir, "merged_chats.json");
const dataDir = path.join(__dirname, "data");
const uiStateFile = path.join(dataDir, "ui_state.json");
const DEFAULT_MAIN_WINDOW_BOUNDS = { width: 1100, height: 750 };
const DEFAULT_WEBAPP_WINDOW_BOUNDS = { width: 1220, height: 840 };
const MIN_AUTO_COMMAND_APP_BOUNDS = { width: 700, height: 500 };
const SHARED_WEBAPP_PARTITION = "persist:commanddesk-webapps";
const APP_ID_URL_FALLBACKS = {
  fmgjjmmmmlfnkbppncabfkddbjjmcfcm: "https://mail.google.com"
};
const projectConfig = {
  trading: {
    id: "trading",
    label: "Trading / Crypto",
    agentId: "main",
    notesPath: path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".openclaw",
      "workspace",
      "crypto-engine",
      "NOTES.md"
    )
  },
  court: {
    id: "court",
    label: "Court / Legal",
    agentId: "main",
    notesPath: path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".openclaw",
      "workspace",
      "projects",
      "legal_custody",
      "NOTES.md"
    )
  },
  coding: {
    id: "coding",
    label: "Coding / Dev",
    agentId: "main",
    notesPath: path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".openclaw",
      "workspace",
      "projects",
      "CODING_NOTES.md"
    )
  }
};
const webAppsConfigFile = path.join(dataDir, "webapps.json");
const todayNotesFile = path.join(dataDir, "today_notes.json");
const newsFeedsFile = path.join(dataDir, "news_feeds.json");
const tickersFile = path.join(dataDir, "tickers.json");
const alarmStateFile = path.join(dataDir, "alarm_state.json");
const DEFAULT_TICKERS = [
  { symbol: "BTCUSD", kind: "crypto", exchange: "CRYPTOCOMPARE" },
  { symbol: "ETHUSD", kind: "crypto", exchange: "CRYPTOCOMPARE" },
  { symbol: "XRPUSD", kind: "crypto", exchange: "CRYPTOCOMPARE" },
  { symbol: "SPY", kind: "stock", exchange: "YAHOO" },
  { symbol: "QQQ", kind: "stock", exchange: "YAHOO" }
];
const DEFAULT_WEATHER_LOCATION = {
  label: "Harper Woods, MI 48225",
  query: "48225"
};

let mainWindow;
const webAppWindows = new Map();
let uiStateCache = null;
let uiStateLoadPromise = null;
let uiStateWriteQueue = Promise.resolve();
let systemCpuSnapshot = null;
let activeAlarm = null;
let alarmTimer = null;
let installedAppsCacheLoadedAt = 0;
let installedAppsCache = [];
let openClawBootstrapAttempted = false;
const chromiumAppTrackers = new Map();
const useNoSandbox = process.platform === "linux"
  && String(process.env.OPENCLAW_USE_NO_SANDBOX || "1").trim() !== "0";

if (useNoSandbox) {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-setuid-sandbox");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
}

function takeCpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  cpus.forEach(cpu => {
    const times = cpu?.times || {};
    idle += Number(times.idle) || 0;
    total += Object.values(times).reduce((sum, value) => sum + (Number(value) || 0), 0);
  });

  return { idle, total };
}

function toMegabytes(bytes) {
  return Math.max(0, (Number(bytes) || 0) / (1024 * 1024));
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, Math.max(400, Number(timeoutMs) || 7000));

  try {
    const nextOptions = options && typeof options === "object" ? { ...options } : {};
    nextOptions.signal = controller.signal;
    return await fetch(resource, nextOptions);
  } finally {
    clearTimeout(timer);
  }
}

function readSystemStats() {
  const current = takeCpuSnapshot();
  const previous = systemCpuSnapshot;
  systemCpuSnapshot = current;

  let cpuPercent = 0;
  if (previous && current.total > previous.total) {
    const idleDelta = current.idle - previous.idle;
    const totalDelta = current.total - previous.total;
    const usage = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
    cpuPercent = Math.max(0, Math.min(100, usage));
  }

  const memTotalMb = toMegabytes(os.totalmem());
  const memFreeMb = toMegabytes(os.freemem());
  const memUsedMb = Math.max(0, memTotalMb - memFreeMb);
  const memPercent = memTotalMb > 0 ? (memUsedMb / memTotalMb) * 100 : 0;

  return {
    cpuPercent: Number(cpuPercent.toFixed(1)),
    memory: {
      totalMb: Number(memTotalMb.toFixed(1)),
      usedMb: Number(memUsedMb.toFixed(1)),
      freeMb: Number(memFreeMb.toFixed(1)),
      percent: Number(memPercent.toFixed(1))
    },
    updatedAt: new Date().toISOString()
  };
}

function parseBounds(rawBounds) {
  if (!rawBounds || typeof rawBounds !== "object") {
    return null;
  }

  const width = Number(rawBounds.width);
  const height = Number(rawBounds.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240) {
    return null;
  }

  const bounds = {
    width: Math.round(width),
    height: Math.round(height)
  };

  const x = Number(rawBounds.x);
  const y = Number(rawBounds.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    bounds.x = Math.round(x);
    bounds.y = Math.round(y);
  }

  return bounds;
}

function normalizeUiState(rawState) {
  const state = rawState && typeof rawState === "object" ? rawState : {};
  const pinnedAppIds = Array.isArray(state.pinnedAppIds)
    ? [...new Set(state.pinnedAppIds.map(id => String(id || "").trim()).filter(Boolean))]
    : [];

  const webAppsState = {};
  if (state.webApps && typeof state.webApps === "object") {
    for (const [key, entry] of Object.entries(state.webApps)) {
      const bounds = parseBounds(entry?.bounds);
      webAppsState[key] = {
        bounds,
        isMaximized: Boolean(entry?.isMaximized),
        manual: Boolean(entry?.manual)
      };
    }
  }

  return {
    mainWindow: {
      bounds: parseBounds(state.mainWindow?.bounds),
      isMaximized: Boolean(state.mainWindow?.isMaximized)
    },
    webApps: webAppsState,
    pinnedAppIds
  };
}

async function loadUiState() {
  if (uiStateCache) {
    return uiStateCache;
  }
  if (uiStateLoadPromise) {
    return uiStateLoadPromise;
  }

  uiStateLoadPromise = (async () => {
    try {
      const raw = await fs.readFile(uiStateFile, "utf8");
      uiStateCache = normalizeUiState(JSON.parse(raw));
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn("[CommandDesk] Failed to load ui_state.json", err);
      }
      uiStateCache = normalizeUiState({});
    }
    return uiStateCache;
  })();

  return uiStateLoadPromise;
}

function queueUiStateWrite() {
  if (!uiStateCache) {
    return;
  }

  const snapshot = JSON.stringify(uiStateCache, null, 2);
  uiStateWriteQueue = uiStateWriteQueue
    .then(async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(uiStateFile, snapshot, "utf8");
    })
    .catch(err => {
      console.error("[CommandDesk] Failed to write ui_state.json", err);
    });
}

function debounce(fn, waitMs = 200) {
  let timer = null;

  const debounced = (...args) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };

  debounced.flush = (...args) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fn(...args);
  };

  return debounced;
}

function hasRectIntersection(a, b, minVisibleWidth = 80, minVisibleHeight = 80) {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap >= minVisibleWidth && yOverlap >= minVisibleHeight;
}

function resolveWindowBounds(savedBounds, fallbackBounds) {
  const fallback = parseBounds(fallbackBounds) || { width: 960, height: 700 };
  const candidate = parseBounds(savedBounds) || fallback;
  const primaryWorkArea = screen.getPrimaryDisplay()?.workArea || {
    x: 0,
    y: 0,
    width: fallback.width,
    height: fallback.height
  };

  const width = Math.max(420, Math.min(candidate.width, primaryWorkArea.width));
  const height = Math.max(320, Math.min(candidate.height, primaryWorkArea.height));
  const resolved = { width, height };

  if (Number.isFinite(candidate.x) && Number.isFinite(candidate.y)) {
    const candidateRect = { x: candidate.x, y: candidate.y, width, height };
    const isVisible = screen.getAllDisplays().some(display =>
      hasRectIntersection(candidateRect, display.workArea)
    );
    if (isVisible) {
      resolved.x = candidateRect.x;
      resolved.y = candidateRect.y;
    }
  }

  return resolved;
}

function captureWindowState(windowRef) {
  const bounds = parseBounds(
    windowRef.isMaximized() ? windowRef.getNormalBounds() : windowRef.getBounds()
  );
  return {
    bounds,
    isMaximized: windowRef.isMaximized()
  };
}

function attachWindowStateMemory(windowRef, { scope, key }) {
  const persist = debounce(() => {
    if (windowRef.isDestroyed()) {
      return;
    }
    const snapshot = captureWindowState(windowRef);
    void loadUiState()
      .then(state => {
        if (scope === "mainWindow") {
          state.mainWindow = snapshot;
        } else if (scope === "webApps" && key) {
          state.webApps[key] = snapshot;
        }
        queueUiStateWrite();
      })
      .catch(err => {
        console.error("[CommandDesk] Failed to save window state", err);
      });
  }, 180);

  windowRef.on("resize", persist);
  windowRef.on("move", persist);
  windowRef.on("maximize", persist);
  windowRef.on("unmaximize", persist);
  windowRef.on("close", () => persist.flush());
}

function normalizeWebUrl(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!input) {
    return null;
  }

  try {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(input)) {
      return new URL(input).toString();
    }

    if (input.startsWith("localhost") || input.startsWith("127.0.0.1")) {
      return new URL(`http://${input}`).toString();
    }

    return new URL(`https://${input}`).toString();
  } catch {
    return null;
  }
}

const WEBAPP_LAUNCH_TYPES = new Set([
  "external-url",
  "internal-url",
  "app-command",
  "file-path"
]);

function normalizeLauncherType(rawType) {
  const value = String(rawType || "").trim().toLowerCase();
  return WEBAPP_LAUNCH_TYPES.has(value) ? value : "";
}

function normalizeLauncherIcon(rawIcon) {
  const icon = String(rawIcon || "").trim();
  if (!icon) {
    return "";
  }
  if (/^data:image\//i.test(icon)) {
    return icon.slice(0, 300_000);
  }
  if (/^https?:\/\//i.test(icon)) {
    return icon;
  }
  return icon.slice(0, 24);
}

function inferDefaultLauncherIcon(name, launchType) {
  const lowerName = String(name || "").toLowerCase();
  if (lowerName.includes("screenshot") || lowerName.includes("screen shot")) {
    return "📸";
  }
  if (launchType === "app-command" || launchType === "file-path") {
    return "🧩";
  }
  return "🌐";
}

function resolveWebAppLaunchTarget(appEntry, urlOverride) {
  const launchType = normalizeLauncherType(appEntry?.launchType);
  const overrideUrl = normalizeWebUrl(urlOverride);
  if (overrideUrl && (launchType === "external-url" || launchType === "internal-url")) {
    return overrideUrl;
  }

  if (launchType === "external-url" || launchType === "internal-url") {
    const directTarget = normalizeWebUrl(appEntry?.target || appEntry?.url);
    if (directTarget) {
      return directTarget;
    }

    const appId = String(appEntry?.appId || "").trim();
    if (appId) {
      const appIdUrl = APP_ID_URL_FALLBACKS[appId];
      if (appIdUrl) {
        return appIdUrl;
      }

      const appIdAsUrl = normalizeWebUrl(appId);
      if (appIdAsUrl) {
        return appIdAsUrl;
      }
    }
    return null;
  }

  if (launchType === "app-command") {
    return String(appEntry?.target || appEntry?.command || "").trim() || null;
  }
  if (launchType === "file-path") {
    return String(appEntry?.target || appEntry?.path || "").trim() || null;
  }

  const legacyUrl = normalizeWebUrl(appEntry?.url || appEntry?.appId || "");
  if (legacyUrl) {
    return legacyUrl;
  }
  return String(appEntry?.target || "").trim() || null;
}

async function readWebAppsWithPinnedState() {
  const apps = await readWebAppsConfig();
  const uiState = await loadUiState();
  const knownIds = new Set(apps.map(appItem => appItem?.id).filter(Boolean));
  const pinnedIds = uiState.pinnedAppIds.filter(id => knownIds.has(id));

  if (pinnedIds.length !== uiState.pinnedAppIds.length) {
    uiState.pinnedAppIds = pinnedIds;
    queueUiStateWrite();
  }

  const rank = new Map(pinnedIds.map((id, index) => [id, index]));
  return apps
    .filter(appItem => appItem && appItem.id)
    .slice()
    .sort((a, b) => {
      const aRank = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bRank = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return 0;
    })
    .map(appItem => ({ ...appItem, pinned: rank.has(appItem.id) }));
}

function toSafeWebAppId(rawValue) {
  return String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeWebAppEntry(entry) {
  const id = toSafeWebAppId(entry?.id || entry?.name);
  if (!id) {
    return null;
  }

  const name = String(entry?.name || id).trim() || id;
  let launchType = normalizeLauncherType(entry?.launchType);
  let target = String(entry?.target || "").trim();

  const rawAppId = String(entry?.appId || "").trim();
  const appIdFallbackUrl = rawAppId
    ? normalizeWebUrl(APP_ID_URL_FALLBACKS[rawAppId] || rawAppId)
    : null;
  const legacyUrl = normalizeWebUrl(entry?.url || entry?.target || "") || appIdFallbackUrl;
  const legacyCommand = String(entry?.command || "").trim();
  const legacyPath = String(entry?.path || "").trim();
  const legacyMode = String(entry?.mode || "").trim().toLowerCase();
  const legacyType = String(entry?.type || "").trim().toLowerCase();

  if (!launchType) {
    if (legacyType === "electron-chromium-window" || legacyMode === "window") {
      launchType = "internal-url";
    } else if (legacyCommand) {
      launchType = "app-command";
    } else if (legacyPath) {
      launchType = "file-path";
    } else if (legacyUrl) {
      launchType = "external-url";
    }
  }

  if (!target) {
    if (launchType === "external-url" || launchType === "internal-url") {
      target = legacyUrl || "";
    } else if (launchType === "app-command") {
      target = legacyCommand;
    } else if (launchType === "file-path") {
      target = legacyPath;
    }
  }

  if (launchType === "external-url" || launchType === "internal-url") {
    const validUrl = normalizeWebUrl(target || legacyUrl);
    if (!validUrl) {
      return null;
    }
    target = validUrl;
  } else if (launchType === "app-command" || launchType === "file-path") {
    target = String(target || "").trim();
    if (!target) {
      return null;
    }
  } else {
    return null;
  }

  const icon = normalizeLauncherIcon(entry?.icon) || inferDefaultLauncherIcon(name, launchType);

  const normalized = {
    id,
    name,
    icon,
    launchType,
    target
  };

  if (launchType === "external-url" || launchType === "internal-url") {
    normalized.url = target;
    normalized.mode = launchType === "internal-url" ? "window" : "external";
    normalized.type = launchType === "internal-url"
      ? "electron-chromium-window"
      : "system-default-browser";
  } else if (launchType === "app-command") {
    normalized.command = target;
    normalized.mode = "command";
    normalized.type = "native-command";
  } else if (launchType === "file-path") {
    normalized.path = target;
    normalized.mode = "file";
    normalized.type = "native-file";
  }

  return normalized;
}

function sanitizeWebAppPayload(payload) {
  const rawId = payload?.id || payload?.name;
  const id = toSafeWebAppId(rawId);
  if (!id) {
    throw new Error("Web app id is required.");
  }

  const launchType = normalizeLauncherType(payload?.launchType)
    || (normalizeWebUrl(payload?.target || payload?.url || payload?.appId || "")
      ? "external-url"
      : "app-command");

  const candidate = normalizeWebAppEntry({
    id,
    name: String(payload?.name || id || "Launcher").trim(),
    icon: payload?.icon,
    launchType,
    target: payload?.target || payload?.url || payload?.command || payload?.path || payload?.appId || ""
  });

  if (!candidate) {
    if (launchType === "external-url" || launchType === "internal-url") {
      throw new Error("Valid URL is required.");
    }
    throw new Error("Launcher target is required.");
  }

  return candidate;
}

function sortWebAppsByName(apps) {
  return (Array.isArray(apps) ? apps : [])
    .slice()
    .sort((a, b) => {
      const aName = String(a?.name || a?.id || "").trim().toLowerCase();
      const bName = String(b?.name || b?.id || "").trim().toLowerCase();
      return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: "base" });
    });
}

async function setWebAppPinned(id, pinned) {
  const appId = String(id || "").trim();
  if (!appId) {
    throw new Error("Web app id is required.");
  }

  const uiState = await loadUiState();
  const nextPinned = uiState.pinnedAppIds.filter(existingId => existingId !== appId);
  if (pinned) {
    nextPinned.push(appId);
  }
  uiState.pinnedAppIds = nextPinned;
  queueUiStateWrite();
}

async function prunePinnedAppIds(validAppIds) {
  const uiState = await loadUiState();
  const validSet = new Set(validAppIds);
  const nextPinned = uiState.pinnedAppIds.filter(id => validSet.has(id));
  if (nextPinned.length !== uiState.pinnedAppIds.length) {
    uiState.pinnedAppIds = nextPinned;
    queueUiStateWrite();
  }
}

async function launchChromiumWindow({ windowKey, stateKey, title, url }) {
  const existing = webAppWindows.get(windowKey);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.focus();
    if (url && existing.webContents.getURL() !== url) {
      await existing.loadURL(url);
    }
    return { launched: true, reused: true };
  }

  const uiState = await loadUiState();
  const saved = uiState.webApps[stateKey] || {};
  const bounds = resolveWindowBounds(saved.bounds, DEFAULT_WEBAPP_WINDOW_BOUNDS);

  const webWindow = new BrowserWindow({
    ...bounds,
    minWidth: 520,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    title: title || "Web App",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      partition: SHARED_WEBAPP_PARTITION
    }
  });

  webWindow.setMenuBarVisibility(false);
  webWindow.once("ready-to-show", () => {
    if (!webWindow.isDestroyed()) {
      webWindow.show();
      webWindow.focus();
    }
  });

  webWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (nextUrl) {
      void webWindow.loadURL(nextUrl).catch(err => {
        console.error("[CommandDesk] Failed to open linked URL", err);
      });
    }
    return { action: "deny" };
  });

  webWindow.on("closed", () => {
    webAppWindows.delete(windowKey);
  });

  attachWindowStateMemory(webWindow, { scope: "webApps", key: stateKey });
  await webWindow.loadURL(url);

  if (saved.isMaximized) {
    webWindow.maximize();
  }

  webAppWindows.set(windowKey, webWindow);
  return { launched: true, reused: false };
}

async function createMainWindow() {
  const uiState = await loadUiState();
  const mainState = uiState.mainWindow || {};
  const initialBounds = resolveWindowBounds(mainState.bounds, DEFAULT_MAIN_WINDOW_BOUNDS);

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 900,
    minHeight: 620,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      webviewTag: true
    }
  });

  attachWindowStateMemory(mainWindow, { scope: "mainWindow" });
  await mainWindow.loadFile(path.join(__dirname, "app.html"));

  if (mainState.isMaximized) {
    mainWindow.maximize();
  }
}

async function readMergedChats() {
  try {
    const raw = await fs.readFile(mergedChatsFile, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function writeMergedChats(chats) {
  await fs.mkdir(chatsDir, { recursive: true });
  await fs.writeFile(mergedChatsFile, JSON.stringify(chats, null, 2), "utf8");
}

async function readWebAppsConfig() {
  try {
    const raw = await fs.readFile(webAppsConfigFile, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [];
    const normalized = items.map(normalizeWebAppEntry).filter(Boolean);
    const deduped = [];
    const seen = new Set();
    normalized.forEach(item => {
      if (!item?.id || seen.has(item.id)) return;
      seen.add(item.id);
      deduped.push(item);
    });
    return deduped;
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function writeWebAppsConfig(apps) {
  const normalized = (Array.isArray(apps) ? apps : [])
    .map(normalizeWebAppEntry)
    .filter(Boolean);
  const deduped = [];
  const seen = new Set();
  normalized.forEach(item => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    deduped.push(item);
  });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(webAppsConfigFile, JSON.stringify(deduped, null, 2), "utf8");
}

function expandHomePath(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value) {
    return "";
  }
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function makeUniqueWebAppId(baseId, apps) {
  const seed = toSafeWebAppId(baseId) || "launcher";
  const used = new Set((Array.isArray(apps) ? apps : []).map(item => item?.id).filter(Boolean));
  if (!used.has(seed)) {
    return seed;
  }
  let idx = 2;
  while (used.has(`${seed}-${idx}`)) {
    idx += 1;
  }
  return `${seed}-${idx}`;
}

function stripDesktopExecPlaceholders(execLine) {
  return String(execLine || "")
    .replace(/\s+%[fFuUdDnNickvm]/g, "")
    .replace(/%[fFuUdDnNickvm]/g, "")
    .trim();
}

function extractDesktopEntryValue(rawText, key) {
  const match = String(rawText || "").match(new RegExp(`^${key}=(.*)$`, "mi"));
  return match ? String(match[1] || "").trim() : "";
}

async function parseDesktopLauncherFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const name = extractDesktopEntryValue(raw, "Name");
  const url = normalizeWebUrl(extractDesktopEntryValue(raw, "URL"));
  const exec = stripDesktopExecPlaceholders(extractDesktopEntryValue(raw, "Exec"));
  const iconName = extractDesktopEntryValue(raw, "Icon");
  return { name, url, exec, iconName };
}

async function parseInternetShortcutFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const match = String(raw || "").match(/^URL=(.*)$/mi);
  const url = normalizeWebUrl(match ? match[1] : "");
  return { url };
}

async function parseWeblocFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const urlMatch = String(raw || "").match(/<string>(https?:\/\/[^<]+)<\/string>/i);
  const url = normalizeWebUrl(urlMatch ? urlMatch[1] : "");
  return { url };
}

function parseCommandArgValue(tokens, optionName) {
  const name = String(optionName || "").trim();
  if (!name) return "";
  for (let i = 0; i < tokens.length; i += 1) {
    const token = String(tokens[i] || "").trim();
    if (!token) continue;
    if (token === name) {
      return String(tokens[i + 1] || "").trim();
    }
    if (token.startsWith(`${name}=`)) {
      return token.slice(name.length + 1).trim();
    }
  }
  return "";
}

function normalizeChromiumPlacementBounds(rawPlacement) {
  const left = Number(rawPlacement?.left);
  const right = Number(rawPlacement?.right);
  const top = Number(rawPlacement?.top);
  const bottom = Number(rawPlacement?.bottom);
  const width = Number.isFinite(left) && Number.isFinite(right) ? Math.round(right - left) : NaN;
  const height = Number.isFinite(top) && Number.isFinite(bottom) ? Math.round(bottom - top) : NaN;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240) {
    return null;
  }

  const bounds = { width, height };
  if (Number.isFinite(left) && Number.isFinite(top)) {
    bounds.x = Math.round(left);
    bounds.y = Math.round(top);
  }

  const workLeft = Number(rawPlacement?.work_area_left);
  const workRight = Number(rawPlacement?.work_area_right);
  const workTop = Number(rawPlacement?.work_area_top);
  const workBottom = Number(rawPlacement?.work_area_bottom);
  if (
    Number.isFinite(workLeft) && Number.isFinite(workRight) &&
    Number.isFinite(workTop) && Number.isFinite(workBottom)
  ) {
    const workWidth = Math.round(workRight - workLeft);
    const workHeight = Math.round(workBottom - workTop);
    if (workWidth > 0 && workHeight > 0 && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
      const placementRect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      const workRect = { x: Math.round(workLeft), y: Math.round(workTop), width: workWidth, height: workHeight };
      // Chromium occasionally keeps stale app placement outside its own recorded work area.
      // Treat that as invalid so we can fall back to healthier placement data.
      if (!hasRectIntersection(placementRect, workRect, 80, 80)) {
        return null;
      }
    }
  }

  return bounds;
}

async function readChromiumAppPlacementFromProfile({ appId, profileDir = "Default" }) {
  const normalizedAppId = String(appId || "").trim();
  if (!normalizedAppId) {
    return null;
  }

  const candidates = [
    path.join(os.homedir(), ".var/app/org.chromium.Chromium/config/chromium", profileDir, "Preferences"),
    path.join(os.homedir(), ".config/chromium", profileDir, "Preferences"),
    path.join(os.homedir(), ".config/google-chrome", profileDir, "Preferences")
  ];

  for (const prefFile of candidates) {
    try {
      const raw = await fs.readFile(prefFile, "utf8");
      const json = JSON.parse(raw);
      const browserState = json?.browser || {};
      const candidates = [
        browserState?.app_window_placement?.[`_crx_${normalizedAppId}`],
        browserState?.window_placement_popup,
        browserState?.window_placement
      ];

      for (const placement of candidates) {
        const bounds = normalizeChromiumPlacementBounds(placement);
        if (!bounds) continue;
        return {
          bounds,
          isMaximized: Boolean(placement?.maximized)
        };
      }
    } catch {
      // Try the next profile path.
    }
  }

  return null;
}

function appendWindowBoundsArgs(args, bounds) {
  const next = Array.isArray(args) ? [...args] : [];
  const hasSize = next.some(token => /^--window-size(=|$)/.test(String(token || "")));
  const hasPos = next.some(token => /^--window-position(=|$)/.test(String(token || "")));
  const hasStartMax = next.some(token => /^--start-maximized$/.test(String(token || "")));

  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  const x = Number(bounds?.x);
  const y = Number(bounds?.y);

  if (!hasSize && Number.isFinite(width) && Number.isFinite(height)) {
    next.push(`--window-size=${Math.round(width)},${Math.round(height)}`);
  }
  if (!hasPos && Number.isFinite(x) && Number.isFinite(y)) {
    next.push(`--window-position=${Math.round(x)},${Math.round(y)}`);
  }
  if (!hasStartMax && bounds?.isMaximized) {
    next.push("--start-maximized");
  }

  return next;
}

function hasArgPrefix(args, prefix) {
  return (Array.isArray(args) ? args : []).some(token =>
    String(token || "").trim().toLowerCase().startsWith(String(prefix || "").trim().toLowerCase())
  );
}

async function runCommandCapture(executable, args = [], timeoutMs = 1400) {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    let child;
    try {
      child = spawn(executable, Array.isArray(args) ? args : [], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      });
    } catch (err) {
      reject(err);
      return;
    }

    const finish = (result, isError = false) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (isError) reject(result);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { }
      finish(new Error(`${executable} timed out`), true);
    }, Math.max(300, Number(timeoutMs) || 1400));

    child.on("error", err => finish(err, true));
    child.stdout.on("data", chunk => {
      stdout += String(chunk || "");
    });
    child.stderr.on("data", chunk => {
      stderr += String(chunk || "");
    });
    child.on("close", code => {
      const output = stdout.trim();
      if (code === 0) {
        finish(output, false);
        return;
      }
      if (output) {
        finish(output, false);
        return;
      }
      finish(new Error(stderr.trim() || `${executable} exited with code ${code}`), true);
    });
  });
}

function parseXdotoolShellGeometry(rawText) {
  const rows = String(rawText || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const values = {};
  rows.forEach(row => {
    const idx = row.indexOf("=");
    if (idx <= 0) return;
    const key = row.slice(0, idx).trim();
    const val = row.slice(idx + 1).trim();
    values[key] = val;
  });

  const x = Number(values.X);
  const y = Number(values.Y);
  const width = Number(values.WIDTH);
  const height = Number(values.HEIGHT);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 200 || height < 120) {
    return null;
  }
  return {
    bounds: {
      width: Math.round(width),
      height: Math.round(height),
      ...(Number.isFinite(x) ? { x: Math.round(x) } : {}),
      ...(Number.isFinite(y) ? { y: Math.round(y) } : {})
    }
  };
}

function normalizeX11WindowId(rawId) {
  return String(rawId || "").trim().toLowerCase();
}

async function listX11ClientWindowIds() {
  const onX11 = String(process.env.XDG_SESSION_TYPE || "").trim().toLowerCase() === "x11";
  if (!onX11) return [];

  let raw = "";
  try {
    raw = await runCommandCapture("xprop", ["-root", "_NET_CLIENT_LIST_STACKING"], 900);
  } catch {
    return [];
  }

  return [...new Set(
    String(raw || "")
      .match(/0x[0-9a-f]+/gi)
      ?.map(value => value.trim()) || []
  )];
}

async function readX11WindowMetadata(windowId) {
  const id = String(windowId || "").trim();
  if (!id) return "";
  try {
    return await runCommandCapture("xprop", ["-id", id, "WM_CLASS", "WM_NAME"], 900);
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasCommandArg(rawCommandLine, argName, argValue) {
  const name = String(argName || "").trim();
  const value = String(argValue || "").trim();
  if (!name || !value) return false;
  const pattern = new RegExp(`${escapeRegExp(name)}(?:=|\\s+)${escapeRegExp(value)}(?:\\s|$)`, "i");
  return pattern.test(String(rawCommandLine || ""));
}

function scoreX11WindowMetadata(rawText, rawCommandLine, { appId, appName }) {
  const metadata = String(rawText || "").toLowerCase();
  const commandLine = String(rawCommandLine || "").replace(/\u0000/g, " ").toLowerCase();
  if (!metadata && !commandLine) return 0;

  let score = 0;
  const normalizedAppId = String(appId || "").trim().toLowerCase();
  const normalizedAppName = String(appName || "").trim().toLowerCase();

  if (normalizedAppId && hasCommandArg(commandLine, "--app-id", normalizedAppId)) score += 100;
  if (normalizedAppId && metadata.includes(normalizedAppId)) score += 40;
  if (normalizedAppName && commandLine.includes(normalizedAppName)) score += 8;
  if (normalizedAppName && metadata.includes(normalizedAppName)) score += 6;
  if (commandLine.includes("chromium") || commandLine.includes("chrome")) score += 2;
  if (metadata.includes("chromium") || metadata.includes("chrome")) score += 1;
  return score;
}

async function readX11WindowCommandLine(windowId) {
  const id = String(windowId || "").trim();
  if (!id) return "";

  let pid = "";
  try {
    pid = String(await runCommandCapture("xdotool", ["getwindowpid", id], 900)).trim();
  } catch {
    return "";
  }
  if (!/^\d+$/.test(pid)) return "";

  try {
    return await fs.readFile(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return "";
  }
}

async function readX11WindowSnapshot(windowId) {
  const id = String(windowId || "").trim();
  if (!id) return null;

  const geoRaw = await runCommandCapture("xdotool", ["getwindowgeometry", "--shell", id], 900);
  const parsed = parseXdotoolShellGeometry(geoRaw);
  if (!parsed?.bounds) {
    return null;
  }

  let wmState = "";
  try {
    wmState = await runCommandCapture("xprop", ["-id", id, "_NET_WM_STATE"], 900);
  } catch {
    wmState = "";
  }
  parsed.isMaximized = /_NET_WM_STATE_MAXIMIZED_(VERT|HORZ)/i.test(String(wmState || ""));
  parsed.windowId = id;
  return parsed;
}

async function applyX11WindowBounds(windowId, snapshot) {
  const id = String(windowId || "").trim();
  const bounds = snapshot?.bounds;
  if (!id || !bounds) return false;

  const width = Math.round(Number(bounds.width));
  const height = Math.round(Number(bounds.height));
  const x = Number(bounds.x);
  const y = Number(bounds.y);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240) {
    return false;
  }

  try {
    // Clear maximize first so size/move commands are respected.
    await runCommandCapture("xdotool", [
      "windowstate", "--remove", "MAXIMIZED_HORZ", "--remove", "MAXIMIZED_VERT", id
    ], 1100);
  } catch {
    // Continue best-effort.
  }

  try {
    await runCommandCapture("xdotool", ["windowsize", id, String(width), String(height)], 1100);
  } catch {
    return false;
  }

  if (Number.isFinite(x) && Number.isFinite(y)) {
    try {
      await runCommandCapture("xdotool", ["windowmove", id, String(Math.round(x)), String(Math.round(y))], 1100);
    } catch {
      // Move can fail on some WMs; keep size change at least.
    }
  }

  return true;
}

async function applyManualX11WindowStateAfterLaunch({
  appId,
  appName = "",
  preLaunchWindowIds = [],
  snapshot
} = {}) {
  const normalizedAppId = String(appId || "").trim();
  if (!normalizedAppId || !snapshot?.bounds) return false;

  const onX11 = String(process.env.XDG_SESSION_TYPE || "").trim().toLowerCase() === "x11";
  if (!onX11) return false;

  const startedAt = Date.now();
  let trackedWindowId = "";

  while (Date.now() - startedAt < 10_000) {
    const state = await readX11ChromiumAppWindowState({
      appId: normalizedAppId,
      appName,
      preLaunchWindowIds,
      windowId: trackedWindowId
    });
    if (state?.windowId) {
      trackedWindowId = String(state.windowId || "");
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 220));
  }

  if (!trackedWindowId) {
    return false;
  }

  return await applyX11WindowBounds(trackedWindowId, snapshot);
}

async function selectBestX11ChromiumWindowId({ appId, appName, preLaunchWindowIds = [] }) {
  const allIds = await listX11ClientWindowIds();
  if (!allIds.length) return "";

  const baseline = new Set((Array.isArray(preLaunchWindowIds) ? preLaunchWindowIds : []).map(normalizeX11WindowId));
  const recentIds = allIds.filter(id => !baseline.has(normalizeX11WindowId(id)));
  if (recentIds.length === 1) {
    return recentIds[0];
  }

  const buckets = baseline.size ? [recentIds] : [allIds];
  const minScore = String(appId || "").trim()
    ? 40
    : String(appName || "").trim()
      ? 6
      : 2;

  for (const bucket of buckets) {
    let bestId = "";
    let bestScore = 0;
    for (let i = bucket.length - 1; i >= 0; i -= 1) {
      const id = bucket[i];
      const metadata = await readX11WindowMetadata(id);
      const commandLine = await readX11WindowCommandLine(id);
      const score = scoreX11WindowMetadata(metadata, commandLine, { appId, appName });
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    if (bestId && bestScore >= minScore) {
      return bestId;
    }

    // If no strong metadata/cmdline match is available, the newest window
    // created after launch is still the best practical fallback.
    if (bucket === recentIds && recentIds.length) {
      return recentIds[recentIds.length - 1];
    }
  }

  return "";
}

async function readX11ChromiumAppWindowState({ appId, appName = "", preLaunchWindowIds = [], windowId = "" } = {}) {
  const normalizedAppId = String(appId || "").trim();
  if (!normalizedAppId) return null;

  const onX11 = String(process.env.XDG_SESSION_TYPE || "").trim().toLowerCase() === "x11";
  if (!onX11) return null;

  const requestedWindowId = String(windowId || "").trim();
  if (requestedWindowId) {
    try {
      const snapshot = await readX11WindowSnapshot(requestedWindowId);
      if (snapshot?.bounds) return snapshot;
      return null;
    } catch {
      return null;
    }
  }

  const selectedId = await selectBestX11ChromiumWindowId({
    appId: normalizedAppId,
    appName,
    preLaunchWindowIds
  });
  if (!selectedId) {
    return null;
  }

  try {
    const snapshot = await readX11WindowSnapshot(selectedId);
    if (snapshot?.bounds) return snapshot;
  } catch {
    return null;
  }

  return null;
}

async function persistWebAppWindowState(stateKey, snapshot, { manual } = {}) {
  const key = String(stateKey || "").trim();
  if (!key || !snapshot?.bounds) {
    return;
  }

  const state = await loadUiState();
  const current = state.webApps[key] && typeof state.webApps[key] === "object"
    ? state.webApps[key]
    : {};
  const nextManual = manual === true
    ? true
    : manual === false
      ? false
      : Boolean(current.manual);
  state.webApps[key] = {
    bounds: snapshot.bounds,
    isMaximized: Boolean(snapshot.isMaximized),
    manual: nextManual
  };
  queueUiStateWrite();
}

function trackChromiumAppWindowUntilClose({ stateKey, appId, appName = "", preLaunchWindowIds = [] }) {
  const key = String(stateKey || "").trim();
  const normalizedAppId = String(appId || "").trim();
  const normalizedAppName = String(appName || "").trim();
  if (!key || !normalizedAppId) return;

  if (chromiumAppTrackers.has(key)) {
    clearInterval(chromiumAppTrackers.get(key));
    chromiumAppTrackers.delete(key);
  }

  const enabled = String(process.env.COMMANDDESK_TRACK_X11_CHROMIUM_APPS || "1").trim() !== "0";
  const onX11 = String(process.env.XDG_SESSION_TYPE || "").trim().toLowerCase() === "x11";
  if (!enabled || !onX11) return;

  let seen = false;
  let running = false;
  let ticks = 0;
  let lastSnapshot = null;
  let trackedWindowId = "";

  const intervalId = setInterval(() => {
    if (running) return;
    running = true;
    ticks += 1;

    void readX11ChromiumAppWindowState({
      appId: normalizedAppId,
      appName: normalizedAppName,
      preLaunchWindowIds,
      windowId: trackedWindowId
    })
      .then(async snapshot => {
        if (snapshot?.bounds) {
          trackedWindowId = String(snapshot.windowId || trackedWindowId || "");
          seen = true;
          lastSnapshot = snapshot;
          await persistWebAppWindowState(key, snapshot);
          return;
        }

        if (seen && lastSnapshot?.bounds) {
          await persistWebAppWindowState(key, lastSnapshot);
          clearInterval(intervalId);
          chromiumAppTrackers.delete(key);
          return;
        }

        if (ticks >= 480) { // 8 minutes at 1 second polling.
          if (lastSnapshot?.bounds) {
            await persistWebAppWindowState(key, lastSnapshot);
          }
          clearInterval(intervalId);
          chromiumAppTrackers.delete(key);
        }
      })
      .catch(() => {
        // Ignore transient X11 query errors.
      })
      .finally(() => {
        running = false;
      });
  }, 1000);

  chromiumAppTrackers.set(key, intervalId);
}

async function launchCommandTarget(commandLine, { cwd = "", stateKey = "", appName = "" } = {}) {
  const command = String(commandLine || "").trim();
  if (!command) {
    throw new Error("Command is empty.");
  }

  const tokens = normalizeLaunchCommandTokens(splitCommandLine(command));
  if (!tokens.length) {
    throw new Error("Command is empty.");
  }

  const executable = expandHomePath(tokens[0]);
  let args = tokens.slice(1);

  const appId = parseCommandArgValue(args, "--app-id");
  const looksLikeChromiumApp = Boolean(appId);
  let preLaunchWindowIds = [];
  let hasManualWindowState = false;
  let manualWindowSnapshot = null;

  if (looksLikeChromiumApp) {
    try {
      preLaunchWindowIds = await listX11ClientWindowIds();
    } catch {
      preLaunchWindowIds = [];
    }
  }

  if (looksLikeChromiumApp) {
    const forceX11ForChromiumApps = String(process.env.COMMANDDESK_FORCE_X11_CHROMIUM_APPS || "1").trim() !== "0";
    const onWayland = String(process.env.XDG_SESSION_TYPE || "").trim().toLowerCase() === "wayland";
    const hasOzonePlatformArg = hasArgPrefix(args, "--ozone-platform")
      || hasArgPrefix(args, "--ozone-platform-hint");
    if (forceX11ForChromiumApps && onWayland && !hasOzonePlatformArg) {
      // Wayland compositors frequently ignore explicit window-position hints.
      // For command-based Chromium PWAs, force X11 so size/position restore works.
      args.push("--ozone-platform=x11");
    }
  }

  if (looksLikeChromiumApp && stateKey) {
    // Prefer our own last-known bounds for command apps.
    // Ignore stale tiny auto-captured states unless they were manually saved.
    let preferredState = null;
    try {
      const uiState = await loadUiState();
      const savedState = uiState?.webApps?.[stateKey] || null;
      const savedBounds = savedState?.bounds;
      const width = Number(savedBounds?.width);
      const height = Number(savedBounds?.height);
      const isManual = Boolean(savedState?.manual);
      const autoLooksTooSmall = !isManual
        && Number.isFinite(width)
        && Number.isFinite(height)
        && (width < MIN_AUTO_COMMAND_APP_BOUNDS.width || height < MIN_AUTO_COMMAND_APP_BOUNDS.height);

      if (savedBounds && !autoLooksTooSmall) {
        preferredState = savedState;
        hasManualWindowState = isManual;
        if (isManual) {
          manualWindowSnapshot = savedState;
        }
      }
    } catch {
      preferredState = null;
    }

    if (preferredState?.bounds) {
      args = appendWindowBoundsArgs(args, {
        ...preferredState.bounds,
        isMaximized: Boolean(preferredState?.isMaximized)
      });
    }
  }

  await new Promise((resolve, reject) => {
    try {
      const child = spawn(executable, args, {
        shell: false,
        detached: true,
        stdio: "ignore",
        cwd: cwd ? expandHomePath(cwd) : undefined
      });
      child.once("error", reject);
      child.unref();
      setTimeout(resolve, 35);
    } catch (err) {
      reject(err);
    }
  });

  if (looksLikeChromiumApp && stateKey && !hasManualWindowState) {
    trackChromiumAppWindowUntilClose({ stateKey, appId, appName, preLaunchWindowIds });
  }
  if (looksLikeChromiumApp && hasManualWindowState && manualWindowSnapshot?.bounds) {
    void applyManualX11WindowStateAfterLaunch({
      appId,
      appName,
      preLaunchWindowIds,
      snapshot: manualWindowSnapshot
    }).catch(() => {
      // Keep launch flow resilient; bounds apply is best-effort.
    });
  }

}

async function launchFilePathTarget(rawPath) {
  const targetPath = path.resolve(expandHomePath(rawPath));
  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch (err) {
    throw new Error(`File path not found: ${targetPath}`);
  }

  if (stat.isDirectory()) {
    const openResult = await shell.openPath(targetPath);
    if (openResult) {
      throw new Error(openResult);
    }
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const executableExts = new Set([".appimage", ".run", ".sh", ".bin", ".exe", ".bat", ".cmd", ".ps1"]);
  const hasExecBit = process.platform !== "win32" && (stat.mode & 0o111) !== 0;
  const shouldSpawnDirect = executableExts.has(ext) || hasExecBit;

  if (shouldSpawnDirect) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(targetPath, {
          detached: true,
          stdio: "ignore"
        });
        child.once("error", reject);
        child.unref();
        setTimeout(resolve, 35);
      });
      return;
    } catch (err) {
      console.warn("[CommandDesk] Direct launch failed; falling back to shell.openPath", err);
    }
  }

  const openResult = await shell.openPath(targetPath);
  if (openResult) {
    throw new Error(openResult);
  }
}

async function suggestLauncherFromDroppedPath(rawFilePath) {
  const resolvedPath = path.resolve(expandHomePath(rawFilePath));
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    throw new Error("Drop a file shortcut or executable.");
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const baseName = path.basename(resolvedPath, ext);
  let name = baseName || "Launcher";
  let launchType = "file-path";
  let target = resolvedPath;
  let icon = inferDefaultLauncherIcon(name, launchType);

  if (ext === ".desktop") {
    const parsed = await parseDesktopLauncherFile(resolvedPath);
    name = parsed.name || name;
    if (parsed.url) {
      launchType = "external-url";
      target = parsed.url;
    } else if (parsed.exec) {
      launchType = "app-command";
      target = parsed.exec;
    }
    if (String(parsed.iconName || "").toLowerCase().includes("screenshot")) {
      icon = "📸";
    }
  } else if (ext === ".url") {
    const parsed = await parseInternetShortcutFile(resolvedPath);
    if (parsed.url) {
      launchType = "external-url";
      target = parsed.url;
    }
  } else if (ext === ".webloc") {
    const parsed = await parseWeblocFile(resolvedPath);
    if (parsed.url) {
      launchType = "external-url";
      target = parsed.url;
    }
  }

  if (String(name).toLowerCase().includes("screenshot")) {
    icon = "📸";
  }

  const normalized = normalizeWebAppEntry({
    id: toSafeWebAppId(name),
    name,
    launchType,
    target,
    icon
  });

  if (!normalized) {
    throw new Error("Unable to create launcher from dropped file.");
  }
  return normalized;
}

async function readIconFileAsDataUrl(rawPath) {
  const filePath = path.resolve(expandHomePath(rawPath));
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".bmp": "image/bmp"
  };
  const mime = mimeByExt[ext];
  if (!mime) {
    throw new Error("Pick an image file.");
  }

  const bytes = await fs.readFile(filePath);
  if (!bytes?.length) {
    throw new Error("Image file is empty.");
  }
  if (bytes.length > 256 * 1024) {
    throw new Error("Icon image too large (max 256KB).");
  }
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function parseDesktopEntryBoolean(value) {
  return /^(true|1|yes)$/i.test(String(value || "").trim());
}

function splitCommandLine(commandLine) {
  const out = [];
  let current = "";
  let quote = "";

  for (let i = 0; i < commandLine.length; i += 1) {
    const ch = commandLine[i];

    if ((ch === "\"" || ch === "'")) {
      if (!quote) {
        quote = ch;
        continue;
      }
      if (quote === ch) {
        quote = "";
        continue;
      }
    }

    if (!quote && /\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }
  if (current) out.push(current);
  return out;
}

function normalizeLaunchCommandTokens(tokens) {
  const normalized = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = String(tokens[i] || "").trim();
    if (!token) continue;

    if (token === "--profile-directory") {
      let value = String(tokens[i + 1] || "").trim();
      let j = i + 2;
      while (j < tokens.length && !String(tokens[j] || "").startsWith("-")) {
        value = `${value} ${String(tokens[j] || "").trim()}`.trim();
        j += 1;
      }
      if (value) {
        normalized.push("--profile-directory");
        normalized.push(value);
        i = j - 1;
        continue;
      }
    }

    if (token.startsWith("--profile-directory=")) {
      let value = token.slice("--profile-directory=".length);
      let j = i + 1;
      while (j < tokens.length && !String(tokens[j] || "").startsWith("-")) {
        value = `${value} ${String(tokens[j] || "").trim()}`.trim();
        j += 1;
      }
      normalized.push(`--profile-directory=${value}`);
      i = j - 1;
      continue;
    }

    normalized.push(token);
  }
  return normalized;
}

function cleanDesktopExecLine(execLine) {
  const cleaned = stripDesktopExecPlaceholders(execLine);
  if (!cleaned) return "";
  const tokens = splitCommandLine(cleaned);
  if (!tokens.length) return "";
  if (tokens[0] === "env") {
    while (tokens.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[1])) {
      tokens.splice(1, 1);
    }
    tokens.shift();
  }
  return tokens.join(" ").trim();
}

function mapDesktopIconToEmoji(name = "", iconName = "") {
  const text = `${name} ${iconName}`.toLowerCase();
  if (text.includes("screenshot") || text.includes("screen shot") || text.includes("gnome-screenshot")) return "📸";
  if (text.includes("chrome") || text.includes("chromium")) return "🌐";
  if (text.includes("mail") || text.includes("gmail")) return "📧";
  if (text.includes("calendar")) return "📅";
  if (text.includes("files") || text.includes("nautilus") || text.includes("dolphin")) return "📁";
  if (text.includes("terminal") || text.includes("konsole")) return "🖥️";
  if (text.includes("camera")) return "📷";
  return "🧩";
}

function parseDesktopEntryFile(rawText, filePath) {
  const text = String(rawText || "");
  if (!/\[Desktop Entry\]/i.test(text)) {
    return null;
  }

  const name = extractDesktopEntryValue(text, "Name");
  const genericName = extractDesktopEntryValue(text, "GenericName");
  const type = extractDesktopEntryValue(text, "Type") || "Application";
  const noDisplay = parseDesktopEntryBoolean(extractDesktopEntryValue(text, "NoDisplay"));
  const hidden = parseDesktopEntryBoolean(extractDesktopEntryValue(text, "Hidden"));
  const iconName = extractDesktopEntryValue(text, "Icon");
  const execRaw = extractDesktopEntryValue(text, "Exec");
  const url = normalizeWebUrl(extractDesktopEntryValue(text, "URL"));

  if (hidden || noDisplay) {
    return null;
  }

  let launchType = "";
  let target = "";

  if (type.toLowerCase() === "link" && url) {
    launchType = "external-url";
    target = url;
  } else if (type.toLowerCase() === "application") {
    const exec = cleanDesktopExecLine(execRaw);
    if (!exec) {
      return null;
    }
    launchType = "app-command";
    target = exec;
  } else {
    return null;
  }

  const baseId = path.basename(filePath, ".desktop");
  const displayName = String(name || genericName || baseId || "App").trim();
  const kind = /--app-id=/i.test(target)
    ? "chromium-webapp"
    : launchType === "external-url"
      ? "link"
      : "application";

  return {
    id: toSafeWebAppId(baseId),
    desktopId: baseId,
    name: displayName,
    launchType,
    target,
    icon: mapDesktopIconToEmoji(displayName, iconName),
    iconName,
    kind,
    filePath
  };
}

async function collectInstalledDesktopApps({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && installedAppsCache.length && now - installedAppsCacheLoadedAt < 60_000) {
    return installedAppsCache;
  }

  const appDirs = [
    path.join(os.homedir(), ".local/share/applications"),
    path.join(os.homedir(), ".local/share/flatpak/exports/share/applications"),
    "/var/lib/flatpak/exports/share/applications",
    "/usr/local/share/applications",
    "/usr/share/applications"
  ];

  const collected = [];
  for (const dirPath of appDirs) {
    let entries = [];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const isRegularFile = Boolean(entry?.isFile?.());
      const isSymlink = Boolean(entry?.isSymbolicLink?.());
      if (!isRegularFile && !isSymlink) continue;
      if (!String(entry.name || "").toLowerCase().endsWith(".desktop")) continue;
      const fullPath = path.join(dirPath, entry.name);
      try {
        const raw = await fs.readFile(fullPath, "utf8");
        const parsed = parseDesktopEntryFile(raw, fullPath);
        if (parsed) collected.push(parsed);
      } catch {
        // skip unreadable desktop entries
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  collected.forEach(item => {
    const key = `${item.desktopId}|${item.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  deduped.sort((a, b) => a.name.localeCompare(b.name));

  installedAppsCache = deduped;
  installedAppsCacheLoadedAt = now;
  return deduped;
}

async function readTodayNotes() {
  try {
    const raw = await fs.readFile(todayNotesFile, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function writeTodayNotes(notes) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(todayNotesFile, JSON.stringify(notes, null, 2), "utf8");
}

function normalizeAlarmRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  let whenMs = Number(value.whenMs);
  if (!Number.isFinite(whenMs)) {
    const rawWhen = String(value.whenIso || value.when || "").trim();
    const localMatch = rawWhen.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
    );
    if (localMatch) {
      const [, year, month, day, hours, minutes, seconds = "0"] = localMatch;
      whenMs = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hours),
        Number(minutes),
        Number(seconds),
        0
      ).getTime();
    } else {
      whenMs = Date.parse(rawWhen);
    }
  }
  if (!Number.isFinite(whenMs)) {
    return null;
  }

  const title = String(value.title || value.label || "").trim();
  const createdAtMs = Date.parse(String(value.createdAt || ""));

  return {
    id: String(value.id || Date.now()),
    whenIso: new Date(whenMs).toISOString(),
    title: title || "Alarm",
    createdAt: Number.isFinite(createdAtMs)
      ? new Date(createdAtMs).toISOString()
      : new Date().toISOString()
  };
}

async function readAlarmState() {
  try {
    const raw = await fs.readFile(alarmStateFile, "utf8");
    return normalizeAlarmRecord(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function writeAlarmState(alarm) {
  await fs.mkdir(dataDir, { recursive: true });
  if (!alarm) {
    try {
      await fs.unlink(alarmStateFile);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    return;
  }
  await fs.writeFile(alarmStateFile, JSON.stringify(alarm, null, 2), "utf8");
}

function clearAlarmTimer() {
  if (alarmTimer) {
    clearTimeout(alarmTimer);
    alarmTimer = null;
  }
}

function getAlarmRemainingMs(alarm) {
  if (!alarm?.whenIso) return 0;
  const remaining = Date.parse(alarm.whenIso) - Date.now();
  return Math.max(0, remaining);
}

function serializeAlarm(alarm) {
  if (!alarm) return null;
  return {
    ...alarm,
    remainingMs: getAlarmRemainingMs(alarm)
  };
}

function notifyAlarm(alarm) {
  if (!alarm) return;
  const body = alarm.title ? String(alarm.title) : "OpenClaw alarm";

  try {
    if (Notification.isSupported()) {
      new Notification({
        title: "OpenClaw Alarm",
        body,
        silent: false
      }).show();
    } else {
      shell.beep();
    }
  } catch (err) {
    console.warn("[CommandDesk] Failed to show alarm notification", err);
    shell.beep();
  }
}

async function fireAlarm(alarm) {
  if (!alarm) return;
  clearAlarmTimer();
  activeAlarm = null;
  try {
    await writeAlarmState(null);
  } catch (err) {
    console.warn("[CommandDesk] Failed to clear alarm state", err);
  }
  notifyAlarm(alarm);
}

function scheduleActiveAlarmTimer() {
  clearAlarmTimer();
  if (!activeAlarm) return;

  const remainingMs = getAlarmRemainingMs(activeAlarm);
  if (remainingMs <= 0) {
    const dueAlarm = activeAlarm;
    void fireAlarm(dueAlarm);
    return;
  }

  const MAX_TIMEOUT_MS = 2_147_000_000;
  const timeoutMs = Math.min(remainingMs, MAX_TIMEOUT_MS);
  alarmTimer = setTimeout(() => {
    if (!activeAlarm) return;
    const stillRemaining = getAlarmRemainingMs(activeAlarm);
    if (stillRemaining <= 0) {
      const dueAlarm = activeAlarm;
      void fireAlarm(dueAlarm);
      return;
    }
    scheduleActiveAlarmTimer();
  }, timeoutMs);
}

async function restoreActiveAlarm() {
  try {
    const stored = await readAlarmState();
    if (!stored) {
      activeAlarm = null;
      clearAlarmTimer();
      return;
    }

    const remainingMs = getAlarmRemainingMs(stored);
    if (remainingMs <= 0) {
      await writeAlarmState(null);
      activeAlarm = null;
      clearAlarmTimer();
      return;
    }

    activeAlarm = stored;
    scheduleActiveAlarmTimer();
  } catch (err) {
    console.warn("[CommandDesk] Failed to restore saved alarm", err);
    activeAlarm = null;
    clearAlarmTimer();
  }
}

async function readNewsFeeds() {
  try {
    const raw = await fs.readFile(newsFeedsFile, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return list
      .map(entry => {
        const id = toSafeWebAppId(entry?.id || entry?.name || "");
        const name = String(entry?.name || id).trim();
        const rss = normalizeWebUrl(entry?.rss || entry?.url || "");
        if (!id || !rss) {
          return null;
        }
        return { id, name: name || id, rss };
      })
      .filter(Boolean);
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function writeNewsFeeds(feeds) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(newsFeedsFile, JSON.stringify(feeds, null, 2), "utf8");
}

function sanitizeNewsFeedPayload(payload) {
  const rss = normalizeWebUrl(payload?.rss || payload?.url || "");
  if (!rss) {
    throw new Error("RSS URL is required.");
  }
  const host = (() => {
    try {
      return new URL(rss).hostname.replace(/^www\./, "");
    } catch {
      return "rss";
    }
  })();
  const name = String(payload?.name || payload?.id || host).trim();
  const id = toSafeWebAppId(payload?.id || name || host);
  if (!id) {
    throw new Error("Feed id is required.");
  }
  return { id, name: name || id, rss };
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripMarkup(value) {
  return decodeXmlEntities(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractXmlTag(block, tags) {
  for (const tag of tags) {
    const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = block.match(pattern);
    if (match && match[1] != null) {
      return match[1];
    }
  }
  return "";
}

function normalizeNewsUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return null;
  }
  if (value.startsWith("//")) {
    try {
      return new URL(`https:${value}`).toString();
    } catch {
      return null;
    }
  }
  return normalizeWebUrl(value);
}

function parseRssItems(xml, feed) {
  const itemBlocks = [...String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(match => match[0]);
  const entryBlocks = [...String(xml || "").matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map(match => match[0]);
  const blocks = itemBlocks.length ? itemBlocks : entryBlocks;

  return blocks.slice(0, 8).map((block, index) => {
    const title = stripMarkup(extractXmlTag(block, ["title"]));
    if (!title) {
      return null;
    }

    const atomLinkMatch = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
    const rawLink = atomLinkMatch?.[1] || extractXmlTag(block, ["link", "id"]);
    const url = normalizeNewsUrl(rawLink);

    const publishedRaw = stripMarkup(extractXmlTag(block, ["pubDate", "published", "updated", "dc:date"]));
    const publishedMs = publishedRaw ? new Date(publishedRaw).getTime() : NaN;
    const published = Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null;

    const body = stripMarkup(extractXmlTag(block, ["description", "summary", "content:encoded", "content"]));

    const tags = [];
    const categoryTextMatches = [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)];
    categoryTextMatches.forEach(match => {
      const text = stripMarkup(match[1]);
      if (text) tags.push(text);
    });
    const categoryTermMatches = [...block.matchAll(/<category[^>]*\bterm=["']([^"']+)["'][^>]*\/?>/gi)];
    categoryTermMatches.forEach(match => {
      const term = stripMarkup(match[1]);
      if (term) tags.push(term);
    });

    return {
      id: `rss:${feed.id}:${url || title}:${index}`,
      source: feed.name || feed.id || "RSS",
      title,
      body,
      url,
      published,
      tags: [...new Set(tags)].slice(0, 4)
    };
  }).filter(Boolean);
}

async function fetchCryptoCompareStories() {
  const response = await fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN");
  if (!response.ok) {
    throw new Error(`CryptoCompare HTTP ${response.status}`);
  }
  const data = await response.json();
  const items = Array.isArray(data.Data) ? data.Data : [];
  return items.slice(0, 14).map(item => ({
    id: `cc:${item.id}`,
    source: item.source_info?.name || "CryptoCompare",
    title: item.title || "Untitled",
    body: item.body || "",
    url: normalizeNewsUrl(item.url),
    published: item.published_on ? new Date(item.published_on * 1000).toISOString() : null,
    tags: item.categories ? String(item.categories).split("|").filter(Boolean).slice(0, 4) : []
  }));
}

async function fetchRssStoriesForFeed(feed) {
  const response = await fetch(feed.rss);
  if (!response.ok) {
    throw new Error(`RSS HTTP ${response.status}`);
  }
  const xml = await response.text();
  return parseRssItems(xml, feed);
}

function normalizeEconomicCalendarEvent(rawEvent, index = 0) {
  const dateRaw = rawEvent?.Date || rawEvent?.DateUtc || rawEvent?.ReferenceDate || rawEvent?.LastUpdate;
  const dateMs = Date.parse(String(dateRaw || ""));
  if (!Number.isFinite(dateMs)) {
    return null;
  }

  const event = String(rawEvent?.Event || rawEvent?.Category || "").trim();
  if (!event) {
    return null;
  }

  const country = String(rawEvent?.Country || "Global").trim() || "Global";
  const sourceUrl = normalizeNewsUrl(
    rawEvent?.URL
    || rawEvent?.Url
    || rawEvent?.url
    || rawEvent?.Link
    || rawEvent?.link
  );
  const fallbackSearch = `https://www.tradingeconomics.com/search/?q=${encodeURIComponent(`${country} ${event}`)}`;

  const importanceRaw = Number(rawEvent?.Importance);
  const importance = Number.isFinite(importanceRaw)
    ? Math.max(0, Math.min(3, Math.round(importanceRaw)))
    : 0;

  return {
    id: `te:${rawEvent?.CalendarId || `${index}:${event}:${dateMs}`}`,
    date: new Date(dateMs).toISOString(),
    country,
    category: String(rawEvent?.Category || "").trim(),
    event,
    actual: rawEvent?.Actual ?? null,
    forecast: rawEvent?.Forecast ?? null,
    previous: rawEvent?.Previous ?? null,
    importance,
    url: sourceUrl || fallbackSearch,
    source: "TradingEconomics"
  };
}

async function fetchEconomicCalendarEvents({ limit = 14 } = {}) {
  const safeLimit = Math.max(4, Math.min(30, Number(limit) || 14));
  const endpoint = "https://api.tradingeconomics.com/calendar?c=guest:guest&f=json";
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "application/json,*/*"
    }
  });
  if (!response.ok) {
    throw new Error(`Economic calendar HTTP ${response.status}`);
  }

  const raw = await response.json();
  const rows = Array.isArray(raw) ? raw : [];
  const normalized = rows
    .map((item, index) => normalizeEconomicCalendarEvent(item, index))
    .filter(Boolean);

  if (!normalized.length) {
    return [];
  }

  const nowMs = Date.now();
  const upcoming = normalized
    .filter(item => Date.parse(item.date) >= nowMs - 2 * 60 * 60 * 1000)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const recentPast = normalized
    .filter(item => Date.parse(item.date) < nowMs - 2 * 60 * 60 * 1000)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return [...upcoming, ...recentPast].slice(0, safeLimit);
}

function normalizeWeatherLocationPayload(payload) {
  const query = String(payload?.query || payload?.location || DEFAULT_WEATHER_LOCATION.query).trim();
  const label = String(payload?.label || payload?.locationLabel || query || DEFAULT_WEATHER_LOCATION.label).trim();
  return {
    query: query || DEFAULT_WEATHER_LOCATION.query,
    label: label || DEFAULT_WEATHER_LOCATION.label
  };
}

function mapWeatherCodeToSummary(code) {
  const value = Number(code);
  if (!Number.isFinite(value)) return "Unknown";
  if (value === 0) return "Clear sky";
  if (value === 1) return "Mainly clear";
  if (value === 2) return "Partly cloudy";
  if (value === 3) return "Overcast";
  if (value === 45 || value === 48) return "Fog";
  if (value === 51 || value === 53 || value === 55) return "Drizzle";
  if (value === 56 || value === 57) return "Freezing drizzle";
  if (value === 61 || value === 63 || value === 65) return "Rain";
  if (value === 66 || value === 67) return "Freezing rain";
  if (value === 71 || value === 73 || value === 75) return "Snow";
  if (value === 77) return "Snow grains";
  if (value === 80 || value === 81 || value === 82) return "Rain showers";
  if (value === 85 || value === 86) return "Snow showers";
  if (value === 95) return "Thunderstorm";
  if (value === 96 || value === 99) return "Thunderstorm + hail";
  return "Unknown";
}

async function fetchWeatherSnapshot(payload) {
  const location = normalizeWeatherLocationPayload(payload);
  const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location.query)}&count=1&language=en&format=json`;
  const geocodeResponse = await fetchWithTimeout(geocodeUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36" }
  }, 10000);
  if (!geocodeResponse.ok) {
    throw new Error(`Weather geocode HTTP ${geocodeResponse.status}`);
  }
  const geocodeJson = await geocodeResponse.json();
  const top = Array.isArray(geocodeJson?.results) ? geocodeJson.results[0] : null;
  if (!top || !Number.isFinite(Number(top.latitude)) || !Number.isFinite(Number(top.longitude))) {
    throw new Error(`Weather location not found for "${location.query}"`);
  }

  const latitude = Number(top.latitude);
  const longitude = Number(top.longitude);
  const timezone = String(top.timezone || "America/Detroit");
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=6&timezone=${encodeURIComponent(timezone)}`;
  const weatherResponse = await fetchWithTimeout(weatherUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36" }
  }, 10000);
  if (!weatherResponse.ok) {
    throw new Error(`Weather forecast HTTP ${weatherResponse.status}`);
  }
  const weatherJson = await weatherResponse.json();

  const current = weatherJson?.current || {};
  const daily = weatherJson?.daily || {};
  const highF = Array.isArray(daily?.temperature_2m_max) ? Number(daily.temperature_2m_max[0]) : NaN;
  const lowF = Array.isArray(daily?.temperature_2m_min) ? Number(daily.temperature_2m_min[0]) : NaN;
  const code = Number(current?.weather_code);

  const forecast = [];
  if (Array.isArray(daily?.time) && Array.isArray(daily?.temperature_2m_max) && Array.isArray(daily?.temperature_2m_min) && Array.isArray(daily?.weather_code)) {
    // skip today (index 0) if it's there
    const len = daily.time.length;
    for (let i = 1; i < len && i <= 5; i++) {
      forecast.push({
        date: daily.time[i],
        highF: Number(daily.temperature_2m_max[i]),
        lowF: Number(daily.temperature_2m_min[i]),
        weatherCode: Number(daily.weather_code[i])
      });
    }
  }

  return {
    location: {
      label: location.label,
      resolvedName: [top.name, top.admin1 || top.state, top.country_code].filter(Boolean).join(", "),
      latitude,
      longitude,
      timezone
    },
    current: {
      temperatureF: Number(current?.temperature_2m),
      apparentF: Number(current?.apparent_temperature),
      humidityPercent: Number(current?.relative_humidity_2m),
      windMph: Number(current?.wind_speed_10m),
      precipitationIn: Number(current?.precipitation),
      weatherCode: Number.isFinite(code) ? code : null,
      summary: mapWeatherCodeToSummary(code)
    },
    daily: {
      highF: Number.isFinite(highF) ? highF : null,
      lowF: Number.isFinite(lowF) ? lowF : null,
      forecast
    },
    updatedAt: new Date().toISOString()
  };
}

function normalizeTickerSymbol(rawValue) {
  return String(rawValue || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9.\-/:]/g, "");
}

function inferTickerKind(symbol) {
  const base = symbol.replace(/[-/]/g, "");
  if (base.endsWith("USD") && base.length > 3) {
    return "crypto";
  }
  const cryptoLike = new Set([
    "BTC", "ETH", "XRP", "SOL", "DOGE", "ADA", "BNB", "LTC", "BCH",
    "DOT", "AVAX", "LINK", "MATIC", "TRX", "XLM", "XMR", "ETC",
    "ATOM", "UNI", "AAVE", "NEAR", "FIL", "HBAR", "ICP", "SUI", "SHIB"
  ]);
  if (cryptoLike.has(base)) {
    return "crypto";
  }
  return "stock";
}

function sanitizeTickerEntry(entry) {
  let symbol = normalizeTickerSymbol(entry?.symbol || "");
  if (!symbol) {
    return null;
  }
  if (symbol.includes(":")) {
    const parts = symbol.split(":");
    symbol = parts[parts.length - 1] || symbol;
  }

  // Allow inputs like BTC-USD or BTC/USD and normalize to BTCUSD
  symbol = symbol.replace(/[-/]/g, "");

  let kind = entry?.kind === "crypto" || entry?.kind === "stock"
    ? entry.kind
    : inferTickerKind(symbol);

  if (kind === "crypto" && !symbol.endsWith("USD")) {
    symbol = `${symbol}USD`;
  }

  return {
    symbol,
    kind,
    exchange: String(entry?.exchange || (kind === "crypto" ? "CRYPTOCOMPARE" : "YAHOO")).trim()
  };
}

async function readTickersConfig() {
  try {
    const raw = await fs.readFile(tickersFile, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [];
    const normalized = items.map(sanitizeTickerEntry).filter(Boolean);
    if (normalized.length) {
      const seen = new Set();
      return normalized.filter(item => {
        if (seen.has(item.symbol)) return false;
        seen.add(item.symbol);
        return true;
      });
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("[CommandDesk] Failed to read tickers.json", err);
    }
  }

  return DEFAULT_TICKERS.map(item => ({ ...item }));
}

async function writeTickersConfig(tickers) {
  const sanitized = Array.isArray(tickers)
    ? tickers.map(sanitizeTickerEntry).filter(Boolean)
    : [];
  const deduped = [];
  const seen = new Set();
  for (const item of sanitized) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    deduped.push(item);
  }
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(tickersFile, JSON.stringify(deduped, null, 2), "utf8");
  return deduped;
}

async function fetchStockQuotesYahoo(stockSymbols) {
  const unique = [...new Set(stockSymbols.map(normalizeTickerSymbol).filter(Boolean))];
  if (!unique.length) {
    return [];
  }

  const endpoint = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(unique.join(","))}`;
  const response = await fetchWithTimeout(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "application/json,*/*"
    }
  }, 5000);
  if (!response.ok) {
    throw new Error(`Yahoo HTTP ${response.status}`);
  }

  const json = await response.json();
  const rows = Array.isArray(json?.quoteResponse?.result) ? json.quoteResponse.result : [];
  const toQuote = row => {
    const symbol = normalizeTickerSymbol(row?.symbol || "");
    const rawPrice = Number(row?.regularMarketPrice);
    const fallbackPrice = Number(row?.postMarketPrice);
    const preMarketPrice = Number(row?.preMarketPrice);
    const price = Number.isFinite(rawPrice)
      ? rawPrice
      : Number.isFinite(fallbackPrice)
        ? fallbackPrice
        : Number.isFinite(preMarketPrice)
          ? preMarketPrice
          : null;

    const rawChange = Number(row?.regularMarketChange);
    const rawChangePercent = Number(row?.regularMarketChangePercent);
    const previousClose = Number(row?.regularMarketPreviousClose);
    const derivedChange = Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : null;
    const derivedChangePercent = Number.isFinite(derivedChange) && Number.isFinite(previousClose) && previousClose !== 0
      ? (derivedChange / previousClose) * 100
      : null;

    return {
      symbol,
      kind: "stock",
      price: Number.isFinite(price) ? price : null,
      changePercent: Number.isFinite(rawChangePercent) ? rawChangePercent : (Number.isFinite(derivedChangePercent) ? derivedChangePercent : null),
      change: Number.isFinite(rawChange) ? rawChange : (Number.isFinite(derivedChange) ? derivedChange : null),
      source: "yahoo"
    };
  };

  const bySymbol = new Map(
    rows.map(row => {
      const quote = toQuote(row);
      return [quote.symbol, quote];
    })
  );

  return unique.map(symbol => bySymbol.get(symbol) || {
    symbol,
    kind: "stock",
    price: null,
    changePercent: null,
    change: null,
    source: "yahoo"
  });
}

async function fetchStockQuotesYahooChart(stockSymbols) {
  const unique = [...new Set(stockSymbols.map(normalizeTickerSymbol).filter(Boolean))];
  if (!unique.length) {
    return [];
  }

  const requests = unique.map(async symbol => {
    const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const response = await fetchWithTimeout(endpoint, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        Accept: "application/json,*/*"
      }
    }, 5000);
    if (!response.ok) {
      throw new Error(`Yahoo chart ${symbol} HTTP ${response.status}`);
    }
    const json = await response.json();
    const meta = json?.chart?.result?.[0]?.meta || {};
    const closeSeries = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    const latestClose = Array.isArray(closeSeries)
      ? [...closeSeries].reverse().find(value => Number.isFinite(Number(value)))
      : null;

    const regularMarketPrice = Number(meta?.regularMarketPrice);
    const chartPreviousClose = Number(meta?.chartPreviousClose);
    const previousClose = Number(meta?.previousClose);
    const price = Number.isFinite(regularMarketPrice)
      ? regularMarketPrice
      : Number.isFinite(Number(latestClose))
        ? Number(latestClose)
        : null;
    const base = Number.isFinite(chartPreviousClose)
      ? chartPreviousClose
      : Number.isFinite(previousClose)
        ? previousClose
        : null;
    const change = Number.isFinite(price) && Number.isFinite(base) ? price - base : null;
    const changePercent = Number.isFinite(change) && Number.isFinite(base) && base !== 0
      ? (change / base) * 100
      : null;

    return {
      symbol,
      kind: "stock",
      price: Number.isFinite(price) ? price : null,
      changePercent: Number.isFinite(changePercent) ? changePercent : null,
      change: Number.isFinite(change) ? change : null,
      source: "yahoo-chart"
    };
  });

  const settled = await Promise.allSettled(requests);
  const bySymbol = new Map();
  settled.forEach((result, index) => {
    const symbol = unique[index];
    if (result.status === "fulfilled") {
      bySymbol.set(symbol, result.value);
      return;
    }
    bySymbol.set(symbol, {
      symbol,
      kind: "stock",
      price: null,
      changePercent: null,
      change: null,
      source: "yahoo-chart"
    });
  });

  return unique.map(symbol => bySymbol.get(symbol));
}

async function fetchStockQuotesStooq(stockSymbols) {
  const unique = [...new Set(stockSymbols.map(normalizeTickerSymbol).filter(Boolean))];
  if (!unique.length) {
    return [];
  }

  const stooqSymbols = unique
    .map(symbol => `${symbol.toLowerCase()}.us`)
    .join("+");
  const endpoint = `https://stooq.com/q/l/?s=${stooqSymbols}&f=sd2t2ohlcvn&e=csv`;
  const response = await fetchWithTimeout(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "text/csv,*/*"
    }
  }, 5000);
  if (!response.ok) {
    throw new Error(`Stooq HTTP ${response.status}`);
  }

  const csv = await response.text();
  const lines = String(csv || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return unique.map(symbol => ({
      symbol,
      kind: "stock",
      price: null,
      changePercent: null,
      change: null,
      source: "stooq"
    }));
  }

  const bySymbol = new Map();
  lines.forEach(line => {
    const cols = line.split(",");
    const firstCol = String(cols[0] || "").trim().replace(/^"|"$/g, "");
    if (!firstCol || /^symbol$/i.test(firstCol)) {
      return;
    }

    const rawSymbol = String(cols[0] || "").trim().replace(/^"|"$/g, "");
    const normalizedSymbol = normalizeTickerSymbol(rawSymbol.replace(/\.US$/i, ""));
    const openRaw = String(cols[3] || "").trim().replace(/^"|"$/g, "");
    const closeRaw = String(cols[6] || "").trim().replace(/^"|"$/g, "");
    const open = Number(openRaw);
    const close = Number(closeRaw);
    const change = Number.isFinite(close) && Number.isFinite(open) ? close - open : null;
    const changePercent = Number.isFinite(change) && Number.isFinite(open) && open !== 0
      ? (change / open) * 100
      : null;

    bySymbol.set(normalizedSymbol, {
      symbol: normalizedSymbol,
      kind: "stock",
      price: Number.isFinite(close) ? close : null,
      changePercent,
      change,
      source: "stooq"
    });
  });

  return unique.map(symbol => bySymbol.get(symbol) || {
    symbol,
    kind: "stock",
    price: null,
    changePercent: null,
    change: null,
    source: "stooq"
  });
}

function normalizeTradingViewExchange(rawExchange, symbol) {
  const exchange = String(rawExchange || "").trim().toUpperCase();
  if (exchange === "NASDAQ" || exchange === "NYSE") {
    return exchange;
  }
  if (exchange === "AMEX" || exchange === "ARCA" || exchange === "NYSEARCA") {
    return "AMEX";
  }
  const upper = normalizeTickerSymbol(symbol);
  if (["SPY", "GLD", "SLV", "DIA", "IWM", "XLF", "XLE", "XLK"].includes(upper)) {
    return "AMEX";
  }
  if (["QQQ", "TQQQ", "SQQQ"].includes(upper)) {
    return "NASDAQ";
  }
  return "NYSE";
}

function normalizeGoogleFinanceExchange(rawExchange, symbol) {
  const exchange = String(rawExchange || "").trim().toUpperCase();
  if (exchange === "AMEX" || exchange === "ARCA" || exchange === "NYSEARCA") {
    return "NYSEARCA";
  }
  if (exchange === "NASDAQ" || exchange === "NYSE") {
    return exchange;
  }
  const upper = normalizeTickerSymbol(symbol);
  if (["SPY", "GLD", "SLV", "DIA", "IWM", "XLF", "XLE", "XLK"].includes(upper)) {
    return "NYSEARCA";
  }
  if (["QQQ", "TQQQ", "SQQQ"].includes(upper)) {
    return "NASDAQ";
  }
  return "NYSE";
}

function parseMoneyNumber(rawValue) {
  const normalized = String(rawValue || "").replace(/,/g, "").trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseGoogleFinanceQuotePage(rawText) {
  const text = String(rawText || "");

  const asOfMatch = text.match(/\$([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:As of|At close|Pre-market|After-hours)/i);
  const jsonPriceMatch = text.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i);
  const anyDollarMatches = [...text.matchAll(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/g)];
  const firstDollar = anyDollarMatches.length ? anyDollarMatches[0][1] : null;
  const previousCloseMatch = text.match(/Previous close[^$]{0,120}\$([0-9][0-9,]*(?:\.[0-9]+)?)/i);

  const priceCandidates = [
    parseMoneyNumber(asOfMatch?.[1]),
    parseMoneyNumber(jsonPriceMatch?.[1]),
    parseMoneyNumber(firstDollar)
  ].filter(value => Number.isFinite(Number(value)));

  const price = priceCandidates.length ? Number(priceCandidates[0]) : null;
  const previousClose = parseMoneyNumber(previousCloseMatch?.[1]);

  let change = null;
  let changePercent = null;
  if (Number.isFinite(price) && Number.isFinite(previousClose) && previousClose !== 0) {
    change = price - previousClose;
    changePercent = (change / previousClose) * 100;
  }

  return {
    price: Number.isFinite(price) ? price : null,
    change: Number.isFinite(change) ? change : null,
    changePercent: Number.isFinite(changePercent) ? changePercent : null
  };
}

async function fetchStockQuotesGoogleFinance(stockEntries) {
  const rows = Array.isArray(stockEntries) ? stockEntries : [];
  const unique = [];
  const seen = new Set();
  rows.forEach(entry => {
    const symbol = normalizeTickerSymbol(entry?.symbol || "");
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    unique.push({
      symbol,
      exchange: normalizeGoogleFinanceExchange(entry?.exchange, symbol)
    });
  });
  if (!unique.length) {
    return [];
  }

  const requests = unique.map(async item => {
    const candidateExchanges = [...new Set([
      item.exchange,
      "NASDAQ",
      "NYSE",
      "NYSEARCA"
    ])];

    for (const exchange of candidateExchanges) {
      try {
        const endpoint = `https://www.google.com/finance/quote/${encodeURIComponent(item.symbol)}:${encodeURIComponent(exchange)}`;
        const response = await fetchWithTimeout(endpoint, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        }, 7000);
        if (!response.ok) {
          continue;
        }
        const text = await response.text();
        const parsed = parseGoogleFinanceQuotePage(text);
        if (Number.isFinite(Number(parsed?.price))) {
          return {
            symbol: item.symbol,
            kind: "stock",
            price: Number(parsed.price),
            changePercent: Number.isFinite(Number(parsed?.changePercent)) ? Number(parsed.changePercent) : null,
            change: Number.isFinite(Number(parsed?.change)) ? Number(parsed.change) : null,
            source: "google-finance"
          };
        }
      } catch {
        // Continue to the next exchange candidate.
      }
    }

    return {
      symbol: item.symbol,
      kind: "stock",
      price: null,
      changePercent: null,
      change: null,
      source: "google-finance"
    };
  });

  const settled = await Promise.allSettled(requests);
  return settled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      symbol: unique[index].symbol,
      kind: "stock",
      price: null,
      changePercent: null,
      change: null,
      source: "google-finance"
    };
  });
}

async function fetchStockQuotesTradingView(stockEntries) {
  const rows = Array.isArray(stockEntries) ? stockEntries : [];
  const unique = [];
  const seen = new Set();
  rows.forEach(entry => {
    const symbol = normalizeTickerSymbol(entry?.symbol || "");
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    unique.push({
      symbol,
      exchange: normalizeTradingViewExchange(entry?.exchange, symbol)
    });
  });
  if (!unique.length) {
    return [];
  }

  const payload = {
    symbols: {
      tickers: unique.map(item => `${item.exchange}:${item.symbol}`),
      query: { types: [] }
    },
    columns: ["close", "change", "change_abs"]
  };

  const response = await fetchWithTimeout("https://scanner.tradingview.com/america/scan", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "application/json,*/*",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, 8000);
  if (!response.ok) {
    throw new Error(`TradingView HTTP ${response.status}`);
  }

  const json = await response.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  const bySymbol = new Map();
  data.forEach(row => {
    const full = String(row?.s || "").toUpperCase();
    const symbol = normalizeTickerSymbol(full.includes(":") ? full.split(":").pop() : full);
    const values = Array.isArray(row?.d) ? row.d : [];
    const price = Number(values[0]);
    const changePercent = Number(values[1]);
    const change = Number(values[2]);
    if (!symbol) return;

    bySymbol.set(symbol, {
      symbol,
      kind: "stock",
      price: Number.isFinite(price) ? price : null,
      changePercent: Number.isFinite(changePercent) ? changePercent : null,
      change: Number.isFinite(change) ? change : null,
      source: "tradingview"
    });
  });

  return unique.map(item => bySymbol.get(item.symbol) || {
    symbol: item.symbol,
    kind: "stock",
    price: null,
    changePercent: null,
    change: null,
    source: "tradingview"
  });
}

async function fetchCryptoQuotesCryptoCompare(cryptoSymbols) {
  const normalized = [...new Set(cryptoSymbols.map(normalizeTickerSymbol).filter(Boolean))];
  if (!normalized.length) {
    return [];
  }

  const baseSymbols = normalized.map(symbol => symbol.endsWith("USD") ? symbol.slice(0, -3) : symbol);
  const uniqueBase = [...new Set(baseSymbols.filter(Boolean))];
  if (!uniqueBase.length) {
    return [];
  }

  const endpoint = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${encodeURIComponent(uniqueBase.join(","))}&tsyms=USD`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`CryptoCompare HTTP ${response.status}`);
  }

  const json = await response.json();
  const raw = json?.RAW && typeof json.RAW === "object" ? json.RAW : {};
  const bySymbol = new Map();

  uniqueBase.forEach(base => {
    const usd = raw?.[base]?.USD || {};
    const symbol = `${base}USD`;
    bySymbol.set(symbol, {
      symbol,
      kind: "crypto",
      price: Number.isFinite(Number(usd.PRICE)) ? Number(usd.PRICE) : null,
      changePercent: Number.isFinite(Number(usd.CHANGEPCT24HOUR)) ? Number(usd.CHANGEPCT24HOUR) : null,
      change: Number.isFinite(Number(usd.CHANGE24HOUR)) ? Number(usd.CHANGE24HOUR) : null,
      source: "cryptocompare"
    });
  });

  return normalized.map(symbol => {
    const normalizedSymbol = symbol.endsWith("USD") ? symbol : `${symbol}USD`;
    return bySymbol.get(normalizedSymbol) || {
      symbol: normalizedSymbol,
      kind: "crypto",
      price: null,
      changePercent: null,
      change: null,
      source: "cryptocompare"
    };
  });
}

async function spawnDetachedCommand(executable, args = []) {
  await new Promise((resolve, reject) => {
    let settled = false;
    try {
      const child = spawn(executable, Array.isArray(args) ? args : [], {
        detached: true,
        stdio: "ignore",
        shell: false,
        windowsHide: true
      });
      child.once("error", err => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve();
      });
      setTimeout(() => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve();
      }, 200);
    } catch (err) {
      reject(err);
    }
  });
}

async function maybeAutoStartOpenClawGateway() {
  if (openClawBootstrapAttempted) {
    return;
  }
  openClawBootstrapAttempted = true;

  const autoStartEnabled = String(process.env.COMMANDDESK_AUTOSTART_OPENCLAW || "1").trim() !== "0";
  if (!autoStartEnabled) {
    return;
  }

  let status;
  try {
    status = await probeGatewayConnection({ timeoutMs: 1400 });
  } catch (err) {
    status = { connected: false, lastError: err?.message || String(err) };
  }

  if (status?.connected) {
    return;
  }

  const homeOpenClawBinary = path.join(os.homedir(), ".npm-global", "bin", "openclaw");
  const launchCandidates = [
    { executable: "openclaw", args: ["daemon", "start"], label: "openclaw daemon start" },
    { executable: homeOpenClawBinary, args: ["daemon", "start"], label: "home openclaw daemon start" },
    { executable: "openclaw", args: ["gateway"], label: "openclaw gateway" },
    { executable: homeOpenClawBinary, args: ["gateway"], label: "home openclaw gateway" }
  ];

  for (const candidate of launchCandidates) {
    try {
      await spawnDetachedCommand(candidate.executable, candidate.args);
    } catch (err) {
      console.warn("[CommandDesk] OpenClaw autostart command failed", candidate.label, err?.message || err);
      continue;
    }

    await new Promise(resolve => setTimeout(resolve, 1700));
    try {
      const probe = await probeGatewayConnection({ timeoutMs: 2000 });
      if (probe?.connected) {
        console.log("[CommandDesk] OpenClaw gateway auto-started via", candidate.label);
        return;
      }
    } catch (err) {
      console.warn("[CommandDesk] OpenClaw probe after autostart failed", candidate.label, err?.message || err);
    }
  }
}

app.on("ready", async () => {
  const shouldClearCache = String(process.env.COMMANDDESK_CLEAR_CACHE_ON_START || "").trim() === "1";
  if (shouldClearCache) {
    try {
      const defaultSession = session.defaultSession;
      if (defaultSession && defaultSession.clearCache) {
        await defaultSession.clearCache();
        console.log("[CommandDesk] Cleared Electron HTTP cache on startup");
      }
    } catch (err) {
      console.warn("[CommandDesk] Failed to clear cache", err);
    }
  }
  await restoreActiveAlarm();
  await maybeAutoStartOpenClawGateway();
  await createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

ipcMain.handle("memory:load", async () => loadMemory());

ipcMain.handle("memory:save", async (_event, updates) => saveMemory(updates));

ipcMain.handle("system:stats", async () => readSystemStats());

ipcMain.handle("openclaw:connectionStatus", async (_event, payload) => {
  const shouldProbe = payload?.probe !== false;
  const agentId = typeof payload?.agentId === "string" && payload.agentId.trim()
    ? payload.agentId.trim()
    : undefined;

  if (shouldProbe) {
    await probeGatewayConnection({ agentId });
  }

  return getGatewayConnectionStatus();
});

ipcMain.handle("tab:detach", async (_event, moduleName) => {
  if (!moduleName) {
    throw new Error("Module name is required to detach a tab.");
  }

  const detachedWindow = new BrowserWindow({
    width: 900,
    height: 650,
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      webviewTag: true
    }
  });

  await detachedWindow.loadFile(path.join(__dirname, "detached.html"), {
    query: { tab: moduleName }
  });

  return { success: true };
});

ipcMain.handle("transcript:export", async (_event, chatId = "default") => {
  try {
    const chats = await readMergedChats();
    await fs.mkdir(chatsDir, { recursive: true });

    const filename = `transcript_${chatId}_${Date.now()}.json`;
    const exportPath = path.join(chatsDir, filename);

    await fs.writeFile(exportPath, JSON.stringify(chats, null, 2), "utf8");

    return { file: exportPath };
  } catch (err) {
    console.error("Error exporting transcript:", err);
    throw new Error("Unable to export transcript. Check logs for details.");
  }
});

ipcMain.handle("history:load", async () => {
  try {
    return await readMergedChats();
  } catch (err) {
    console.error("Error loading chat history:", err);
    throw new Error("Unable to load chat history.");
  }
});

ipcMain.handle("history:delete", async (_event, payload) => {
  const id = payload?.id;
  if (!id) {
    throw new Error("Missing conversation id.");
  }
  try {
    const chats = await readMergedChats();
    const filtered = chats.filter(c => c.id !== id);
    await writeMergedChats(filtered);
    return { ok: true };
  } catch (err) {
    console.error("Error deleting chat history entry:", err);
    throw new Error("Unable to delete conversation from history.");
  }
});

ipcMain.handle("config:getOpenAIKey", async () => {
  try {
    return await getOpenAIKey();
  } catch (err) {
    console.error("Error retrieving OpenAI API key:", err);
    throw new Error("Unable to read stored OpenAI key.");
  }
});

ipcMain.handle("config:setOpenAIKey", async (_event, key) => {
  try {
    const storedKey = await setOpenAIKey(key);
    return { stored: Boolean(storedKey) };
  } catch (err) {
    console.error("Error saving OpenAI API key:", err);
    throw new Error("Unable to store OpenAI key.");
  }
});

ipcMain.handle("chat:send", async (_event, payload) => {
  const text = typeof payload === "string" ? payload.trim() : (payload?.text || "");
  const conversationId = typeof payload === "object" ? payload.conversationId || null : null;

  let modeId = "trading";
  if (typeof payload === "object") {
    if (payload.modeId) {
      modeId = payload.modeId;
    } else {
      const lower = (payload.text || text || "").toLowerCase();
      if (lower.includes("legal") || lower.includes("court")) {
        modeId = "court";
      } else if (lower.includes("code") || lower.includes("coding") || lower.includes("dev")) {
        modeId = "coding";
      } else if (lower.includes("trading") || lower.includes("trade") || lower.includes("crypto")) {
        modeId = "trading";
      }
    }
  }

  const mode = projectConfig[modeId] || projectConfig.trading;
  const agentId = mode.agentId || "main";

  if (!text) {
    return { error: "Message is empty." };
  }

  try {
    const { reply } = await sendChatThroughGateway({ text, conversationId, agentId });

    // Persist transcript locally so CommandDesk chat history survives restarts
    try {
      const chats = await readMergedChats();
      const id = conversationId || `conv-${Date.now()}`;
      let conv = chats.find(c => c.id === id);
      if (!conv) {
        conv = {
          id,
          title: payload?.title || "New chat",
          created_at: new Date().toISOString(),
          messages: []
        };
        chats.push(conv);
      }
      conv.messages = conv.messages || [];
      conv.messages.push({ role: "user", content: text });
      conv.messages.push({ role: "assistant", content: reply || "" });
      await writeMergedChats(chats);
    } catch (persistErr) {
      console.error("Error persisting chat transcript", persistErr);
    }

    return { reply };
  } catch (err) {
    console.error("Error handling chat:send via gateway", err);
    return { error: err.message || "Unexpected error from gateway." };
  }
});

ipcMain.handle("project:promoteConversation", async (_event, payload) => {
  const conversation = payload?.conversation;
  const modeId = payload?.modeId || "trading";
  const mode = projectConfig[modeId] || projectConfig.trading;

  if (!conversation) {
    throw new Error("Missing conversation payload.");
  }

  const notesPath = mode.notesPath;

  const title = conversation.title || "Chat session";
  const created = conversation.created_at || new Date().toISOString();
  const id = conversation.id || conversation.conversationId || "(no-id)";

  const lines = [];
  lines.push("\n\n---");
  lines.push(`\n## Promoted conversation – ${title}`);
  lines.push(`- Mode: ${mode.label} (${mode.id})`);
  lines.push(`- Promoted at: ${new Date().toISOString()}`);
  lines.push(`- Conversation id: ${id}`);
  lines.push(`- Started: ${created}`);

  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const slice = messages.slice(-10); // last 10 messages for context
  if (slice.length) {
    lines.push("\n### Recent context");
    slice.forEach(msg => {
      if (!msg || !msg.role || !msg.content) return;
      const role = msg.role === "assistant" ? "Assistant" : msg.role === "user" ? "Matt" : msg.role;
      lines.push(`- **${role}:** ${msg.content.replace(/\r?\n/g, " ")}`);
    });
  }

  const block = lines.join("\n");

  try {
    await fs.mkdir(path.dirname(notesPath), { recursive: true });
    await fs.appendFile(notesPath, block, "utf8");
    return { ok: true };
  } catch (err) {
    console.error("Error promoting conversation", err);
    throw new Error(`Unable to write to NOTES.md for ${mode.label}.`);
  }
});


ipcMain.handle("home:listTasks", async () => {
  const tasks = [];
  const home = process.env.HOME || process.env.USERPROFILE || "";

  try {
    const tradingPath = path.join(home, ".openclaw", "workspace", "crypto-engine", "NOTES.md");
    const legalPath = path.join(home, ".openclaw", "workspace", "projects", "legal_custody", "NOTES.md");
    const codingPath = path.join(home, ".openclaw", "workspace", "projects", "CODING_NOTES.md");

    const entries = [
      { mode: "trading", label: "TRADING", file: tradingPath },
      { mode: "court", label: "COURT", file: legalPath },
      { mode: "coding", label: "CODING", file: codingPath }
    ];

    for (const entry of entries) {
      try {
        const raw = await fs.readFile(entry.file, "utf8");
        const lines = raw.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [  ]")) {
            const text = trimmed.replace(/^-.*?\]\s*/, "").trim();
            if (text) {
              tasks.push({ mode: entry.mode, text });
            }
          }
        }
      } catch {
        // ignore missing file
      }
    }
  } catch (err) {
    console.error("home:listTasks error", err);
  }

  return { tasks };
});

// Mission Control state (Kanban + activity feed)
const missionControlStatePath = path.join(__dirname, "data", "mission-control.json");

async function readMissionControlState() {
  try {
    const raw = await fs.readFile(missionControlStatePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { tasks: [] };
  }
}

async function writeMissionControlState(state) {
  const safeState = state && typeof state === "object" ? state : { tasks: [] };
  const payload = JSON.stringify(safeState, null, 2);
  await fs.mkdir(path.dirname(missionControlStatePath), { recursive: true });
  await fs.writeFile(missionControlStatePath, payload, "utf8");
  return safeState;
}

async function findLatestOpenClawLogPath() {
  const candidates = [
    "/tmp/openclaw",
    path.join(process.env.HOME || process.env.USERPROFILE || "", ".openclaw", "logs")
  ];

  for (const dir of candidates) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files = entries
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => name.startsWith("openclaw-") && name.endsWith(".log"))
        .map(name => path.join(dir, name));

      if (!files.length) {
        continue;
      }

      let best = null;
      let bestMtime = 0;
      for (const file of files) {
        try {
          const stat = await fs.stat(file);
          const mtime = Number(stat.mtimeMs || 0);
          if (mtime > bestMtime) {
            bestMtime = mtime;
            best = file;
          }
        } catch {
          // ignore
        }
      }

      if (best) {
        return best;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

ipcMain.handle("mission:tasks:get", async () => {
  return await readMissionControlState();
});

ipcMain.handle("mission:tasks:set", async (_event, state) => {
  return await writeMissionControlState(state);
});

ipcMain.handle("mission:activity:tail", async (_event, payload) => {
  const offset = Math.max(0, Number(payload?.offset || 0));
  const limit = Math.max(1, Math.min(500, Number(payload?.limit || 100)));

  const logPath = await findLatestOpenClawLogPath();
  if (!logPath) {
    return { lines: ["(no OpenClaw log found)"], nextOffset: 0, logPath: null };
  }

  try {
    const raw = await fs.readFile(logPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const total = lines.length;

    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    const slice = lines.slice(start, end);

    return {
      lines: slice,
      nextOffset: offset + slice.length,
      logPath
    };
  } catch (err) {
    return { lines: [`(failed to read log: ${err?.message || "unknown"})`], nextOffset: offset, logPath };
  }
});

ipcMain.handle("mission:cron:list", async () => {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const cronDir = path.join(home, ".openclaw", "cron");
  try {
    const entries = await fs.readdir(cronDir, { withFileTypes: true });
    const files = entries
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => entry.name);

    const jobs = [];
    for (const name of files) {
      const file = path.join(cronDir, name);
      try {
        const raw = await fs.readFile(file, "utf8");
        const json = JSON.parse(raw);
        jobs.push({ file: name, ...json });
      } catch {
        jobs.push({ file: name, error: "unreadable" });
      }
    }

    return { dir: cronDir, jobs };
  } catch {
    return { dir: cronDir, jobs: [] };
  }
});

ipcMain.handle("ticker:listSymbols", async () => {
  try {
    return await readTickersConfig();
  } catch (err) {
    console.error("Error listing tickers", err);
    throw new Error("Unable to load tickers.");
  }
});

ipcMain.handle("ticker:addSymbol", async (_event, payload) => {
  const symbol = normalizeTickerSymbol(payload?.symbol || "");
  if (!symbol) {
    throw new Error("Ticker symbol is required.");
  }

  const current = await readTickersConfig();
  const candidate = sanitizeTickerEntry({
    symbol,
    kind: payload?.kind
  });
  if (!candidate) {
    throw new Error("Invalid ticker symbol.");
  }

  if (!current.some(item => item.symbol === candidate.symbol)) {
    current.push(candidate);
  }

  return await writeTickersConfig(current);
});

ipcMain.handle("ticker:removeSymbol", async (_event, payload) => {
  const candidate = sanitizeTickerEntry({ symbol: payload?.symbol });
  if (!candidate) {
    throw new Error("Ticker symbol is required.");
  }

  const current = await readTickersConfig();
  const next = current.filter(item => item.symbol !== candidate.symbol);
  return await writeTickersConfig(next);
});

ipcMain.handle("ticker:quotes", async (_event, payload) => {
  const symbolsInput = Array.isArray(payload?.symbols) ? payload.symbols : null;
  const configured = await readTickersConfig();
  const configuredBySymbol = new Map(configured.map(item => [item.symbol, item]));
  const desired = symbolsInput
    ? (() => {
      const seen = new Set();
      const entries = [];
      for (const input of symbolsInput) {
        const rawEntry = typeof input === "string" ? { symbol: input } : input;
        const sanitized = sanitizeTickerEntry(rawEntry);
        if (!sanitized || seen.has(sanitized.symbol)) continue;
        const fromConfig = configuredBySymbol.get(sanitized.symbol);
        const merged = sanitizeTickerEntry({
          symbol: sanitized.symbol,
          kind: rawEntry?.kind || fromConfig?.kind || sanitized.kind,
          exchange: rawEntry?.exchange || fromConfig?.exchange || sanitized.exchange
        });
        if (!merged || seen.has(merged.symbol)) continue;
        seen.add(merged.symbol);
        entries.push(merged);
      }
      return entries;
    })()
    : configured;

  const stockEntries = desired.filter(item => item.kind === "stock");
  const stockSymbols = stockEntries.map(item => item.symbol);
  const cryptoSymbols = desired.filter(item => item.kind === "crypto").map(item => item.symbol);

  let stockQuotes = [];
  let cryptoQuotes = [];
  const warnings = [];

  const stockMap = new Map(
    stockSymbols.map(symbol => [
      symbol,
      {
        symbol,
        kind: "stock",
        price: null,
        changePercent: null,
        change: null,
        source: "unknown"
      }
    ])
  );

  const mergeStockQuotes = quotes => {
    (Array.isArray(quotes) ? quotes : []).forEach(quote => {
      const symbol = normalizeTickerSymbol(quote?.symbol || "");
      if (!symbol || !stockMap.has(symbol)) return;
      if (!Number.isFinite(Number(quote?.price))) return;
      stockMap.set(symbol, {
        ...stockMap.get(symbol),
        ...quote,
        symbol
      });
    });
  };

  if (stockSymbols.length) {
    try {
      const yahooQuotes = await fetchStockQuotesYahoo(stockSymbols);
      mergeStockQuotes(yahooQuotes);
    } catch (err) {
      warnings.push(`stocks-yahoo: ${err.message || String(err)}`);
    }

    let missingStockSymbols = [...stockMap.values()]
      .filter(item => item.price === null || !Number.isFinite(Number(item.price)))
      .map(item => item.symbol);

    if (missingStockSymbols.length) {
      try {
        const yahooChartQuotes = await fetchStockQuotesYahooChart(missingStockSymbols);
        mergeStockQuotes(yahooChartQuotes);
        if (yahooChartQuotes.some(item => Number.isFinite(Number(item?.price)))) {
          warnings.push("stocks: using Yahoo chart fallback");
        }
      } catch (err) {
        warnings.push(`stocks-yahoo-chart: ${err.message || String(err)}`);
      }
    }

    missingStockSymbols = [...stockMap.values()]
      .filter(item => item.price === null || !Number.isFinite(Number(item.price)))
      .map(item => item.symbol);

    if (missingStockSymbols.length) {
      try {
        const stooqQuotes = await fetchStockQuotesStooq(missingStockSymbols);
        mergeStockQuotes(stooqQuotes);
        if (stooqQuotes.some(item => Number.isFinite(Number(item?.price)))) {
          warnings.push("stocks: using Stooq fallback");
        }
      } catch (err) {
        warnings.push(`stocks-stooq: ${err.message || String(err)}`);
      }
    }

    missingStockSymbols = [...stockMap.values()]
      .filter(item => item.price === null || !Number.isFinite(Number(item.price)))
      .map(item => item.symbol);

    if (missingStockSymbols.length) {
      try {
        const missingSet = new Set(missingStockSymbols);
        const tradingViewQuotes = await fetchStockQuotesTradingView(
          stockEntries.filter(item => missingSet.has(item.symbol))
        );
        mergeStockQuotes(tradingViewQuotes);
        if (tradingViewQuotes.some(item => Number.isFinite(Number(item?.price)))) {
          warnings.push("stocks: using TradingView fallback");
        }
      } catch (err) {
        warnings.push(`stocks-tradingview: ${err.message || String(err)}`);
      }
    }

    missingStockSymbols = [...stockMap.values()]
      .filter(item => item.price === null || !Number.isFinite(Number(item.price)))
      .map(item => item.symbol);

    if (missingStockSymbols.length) {
      try {
        const missingSet = new Set(missingStockSymbols);
        const googleFinanceQuotes = await fetchStockQuotesGoogleFinance(
          stockEntries.filter(item => missingSet.has(item.symbol))
        );
        mergeStockQuotes(googleFinanceQuotes);
        if (googleFinanceQuotes.some(item => Number.isFinite(Number(item?.price)))) {
          warnings.push("stocks: using Google Finance fallback");
        }
      } catch (err) {
        warnings.push(`stocks-google-finance: ${err.message || String(err)}`);
      }
    }
  }

  stockQuotes = stockSymbols.map(symbol => stockMap.get(symbol) || {
    symbol,
    kind: "stock",
    price: null,
    changePercent: null,
    change: null,
    source: "unknown"
  });

  try {
    cryptoQuotes = await fetchCryptoQuotesCryptoCompare(cryptoSymbols);
  } catch (err) {
    warnings.push(`crypto: ${err.message || String(err)}`);
  }

  const bySymbol = new Map();
  [...stockQuotes, ...cryptoQuotes].forEach(quote => {
    if (quote?.symbol) bySymbol.set(quote.symbol, quote);
  });

  const quotes = desired.map(item => bySymbol.get(item.symbol) || {
    symbol: item.symbol,
    kind: item.kind,
    price: null,
    changePercent: null,
    change: null,
    source: item.kind === "crypto" ? "cryptocompare" : "stooq"
  });

  return {
    quotes,
    warnings: warnings.length ? warnings : undefined,
    updatedAt: new Date().toISOString()
  };
});

ipcMain.handle("news:listFeeds", async () => {
  try {
    return await readNewsFeeds();
  } catch (err) {
    console.error("Error reading RSS feeds", err);
    throw new Error("Unable to load RSS feeds.");
  }
});

ipcMain.handle("news:addFeed", async (_event, payload) => {
  const nextFeed = sanitizeNewsFeedPayload(payload);
  const existing = await readNewsFeeds();
  const idx = existing.findIndex(feed => feed.id === nextFeed.id || feed.rss === nextFeed.rss);
  if (idx >= 0) {
    existing[idx] = nextFeed;
  } else {
    existing.push(nextFeed);
  }
  await writeNewsFeeds(existing);
  return existing;
});

ipcMain.handle("news:removeFeed", async (_event, id) => {
  const targetId = String(id || "").trim();
  if (!targetId) {
    throw new Error("Feed id is required.");
  }
  const existing = await readNewsFeeds();
  const next = existing.filter(feed => feed.id !== targetId);
  await writeNewsFeeds(next);
  return next;
});

ipcMain.handle("economy:calendar", async (_event, payload) => {
  try {
    const events = await fetchEconomicCalendarEvents({ limit: payload?.limit });
    return {
      events,
      updatedAt: new Date().toISOString()
    };
  } catch (err) {
    console.warn("Economic calendar fetch failed", err);
    return {
      events: [],
      error: err.message || String(err)
    };
  }
});

// News feed: CryptoCompare + configured RSS feeds
ipcMain.handle("news:topStories", async () => {
  const stories = [];
  const errors = [];

  try {
    const cryptoStories = await fetchCryptoCompareStories();
    stories.push(...cryptoStories);
  } catch (err) {
    errors.push(err.message || String(err));
    console.warn("CryptoCompare news fetch failed", err);
  }

  try {
    const feeds = await readNewsFeeds();
    const settled = await Promise.allSettled(feeds.map(feed => fetchRssStoriesForFeed(feed)));
    for (let i = 0; i < settled.length; i += 1) {
      const result = settled[i];
      if (result.status === "fulfilled") {
        stories.push(...result.value);
      } else {
        const name = feeds[i]?.name || feeds[i]?.id || "rss";
        errors.push(`${name}: ${result.reason?.message || String(result.reason)}`);
      }
    }
  } catch (err) {
    errors.push(err.message || String(err));
    console.warn("RSS feeds fetch failed", err);
  }

  const deduped = [];
  const seen = new Set();
  stories.forEach(item => {
    const key = `${item.url || ""}|${item.title || ""}`.toLowerCase();
    if (!item.title || seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(item);
  });

  deduped.sort((a, b) => {
    const at = a.published ? new Date(a.published).getTime() : 0;
    const bt = b.published ? new Date(b.published).getTime() : 0;
    return bt - at;
  });

  const top = deduped.slice(0, 18);
  if (!top.length && errors.length) {
    return { stories: [], error: errors.join(" | ") };
  }
  return { stories: top, warnings: errors.length ? errors : undefined };
});

// Dashboard / integrations
ipcMain.handle("google:gmailPrimarySnapshot", async () => {
  // TODO: replace with real Gmail API integration, filtered to PRIMARY only.
  // Temporary stub data so the dashboard shows something useful.
  return {
    unread: 0,
    messages: []
  };
});

ipcMain.handle("google:calendarSnapshot", async () => {
  try {
    const events = await listNextEvents();
    const today = [];
    let upcoming = null;

    if (Array.isArray(events) && events.length) {
      // For now, treat all as "upcoming" and show the first as next.
      upcoming = {
        when: events[0].time || "",
        title: events[0].title || "(untitled event)"
      };
    }

    return { today, upcoming };
  } catch (err) {
    console.error("Error in calendarSnapshot", err);
    throw new Error("Unable to load calendar snapshot.");
  }
});
ipcMain.handle("google:addCalendarEvent", async (_event, payload) => {
  const title = payload?.title;
  const date = payload?.date;
  const time = payload?.time || "09:00";

  if (!title || !date) {
    throw new Error("Event title and date are required.");
  }

  // TODO: Wire to real Google Calendar API to create an actual event.
  // For now, log and return success so the UI flow is demonstrable.
  console.log(`[CommandDesk] Add calendar event: "${title}" on ${date} at ${time}`);

  return { ok: true, event: { title, date, time } };
});

ipcMain.handle("weather:current", async (_event, payload) => {
  try {
    return await fetchWeatherSnapshot(payload || DEFAULT_WEATHER_LOCATION);
  } catch (err) {
    console.error("Error loading weather snapshot", err);
    throw new Error("Unable to load weather right now.");
  }
});

ipcMain.handle("config:listWebApps", async () => {
  try {
    return await readWebAppsWithPinnedState();
  } catch (err) {
    console.error("Error reading webapps config", err);
    throw new Error("Unable to load web apps configuration.");
  }
});

ipcMain.handle("apps:listInstalled", async (_event, payload) => {
  const search = String(payload?.search || "").trim().toLowerCase();
  const limit = Math.max(20, Math.min(500, Number(payload?.limit) || 220));
  const refresh = Boolean(payload?.refresh);

  try {
    const all = await collectInstalledDesktopApps({ forceRefresh: refresh });
    const filtered = search
      ? all.filter(item => {
        const haystack = `${item.name} ${item.desktopId} ${item.target} ${item.kind}`.toLowerCase();
        return haystack.includes(search);
      })
      : all;

    return {
      apps: filtered.slice(0, limit),
      total: filtered.length,
      updatedAt: new Date(installedAppsCacheLoadedAt || Date.now()).toISOString()
    };
  } catch (err) {
    console.error("Error listing installed apps", err);
    throw new Error("Unable to read installed apps.");
  }
});

ipcMain.handle("todayNotes:list", async () => {
  try {
    return await readTodayNotes();
  } catch (err) {
    console.error("Error reading today notes", err);
    throw new Error("Unable to load saved notes.");
  }
});

ipcMain.handle("todayNotes:save", async (_event, note) => {
  const title = (note && note.title ? String(note.title) : "").trim();
  const body = (note && note.body ? String(note.body) : "").trim();

  if (!title && !body) {
    throw new Error("Note is empty.");
  }

  try {
    const existing = await readTodayNotes();
    const id = note && note.id ? String(note.id) : String(Date.now());
    const stamped = {
      id,
      title: title || "Untitled",
      body,
      createdAt: note && note.createdAt ? note.createdAt : new Date().toISOString()
    };

    const remaining = existing.filter(n => n.id !== id);
    const next = [stamped, ...remaining].slice(0, 50); // keep last 50

    await writeTodayNotes(next);
    return { ok: true, notes: next };
  } catch (err) {
    console.error("Error saving today note", err);
    throw new Error("Unable to save note.");
  }
});

ipcMain.handle("todayNotes:delete", async (_event, payload) => {
  const id = payload?.id;
  if (!id) {
    throw new Error("Missing note id.");
  }

  try {
    const existing = await readTodayNotes();
    const next = existing.filter(n => n.id !== String(id));
    await writeTodayNotes(next);
    return { ok: true, notes: next };
  } catch (err) {
    console.error("Error deleting today note", err);
    throw new Error("Unable to delete note.");
  }
});

ipcMain.handle("alarm:get", async () => serializeAlarm(activeAlarm));

ipcMain.handle("alarm:set", async (_event, payload) => {
  const alarm = normalizeAlarmRecord({
    whenIso: payload?.whenIso || payload?.when,
    whenMs: payload?.whenMs,
    title: payload?.title,
    id: payload?.id,
    createdAt: payload?.createdAt
  });

  if (!alarm) {
    throw new Error("Invalid alarm time.");
  }
  if (getAlarmRemainingMs(alarm) <= 0) {
    throw new Error("Alarm time must be in the future.");
  }

  activeAlarm = alarm;
  scheduleActiveAlarmTimer();
  await writeAlarmState(alarm);
  return serializeAlarm(activeAlarm);
});

ipcMain.handle("alarm:clear", async () => {
  clearAlarmTimer();
  activeAlarm = null;
  await writeAlarmState(null);
  return { ok: true };
});

// Web app management
ipcMain.handle("config:addWebApp", async (_event, app) => {
  const nextApp = sanitizeWebAppPayload(app);
  const apps = await readWebAppsConfig();
  const existingIndex = apps.findIndex(item => item?.id === nextApp.id);

  if (existingIndex >= 0) {
    apps[existingIndex] = {
      ...apps[existingIndex],
      ...nextApp
    };
  } else {
    apps.push(nextApp);
  }

  await writeWebAppsConfig(sortWebAppsByName(apps));
  return await readWebAppsWithPinnedState();
});

ipcMain.handle("config:removeWebApp", async (_event, id) => {
  const input = typeof id === "string"
    ? { id }
    : (id && typeof id === "object" ? id : {});
  const rawId = String(input?.id || input?.query || input?.name || "").trim();
  if (!rawId) {
    throw new Error("Web app id is required.");
  }

  const apps = await readWebAppsConfig();
  const safeRawId = toSafeWebAppId(rawId);
  const lowerRawId = rawId.toLowerCase();
  const matched = apps.find(item => item?.id === rawId)
    || apps.find(item => item?.id === safeRawId)
    || apps.find(item => String(item?.name || "").trim().toLowerCase() === lowerRawId)
    || apps.find(item => toSafeWebAppId(item?.name || "") === safeRawId);

  if (!matched?.id) {
    throw new Error(`Web app not found: ${rawId}`);
  }

  const targetId = matched.id;
  const next = apps.filter(item => item?.id !== targetId);

  if (next.length === apps.length) {
    throw new Error(`Web app not found: ${rawId}`);
  }

  await writeWebAppsConfig(next);
  await prunePinnedAppIds(next.map(item => item.id));

  const state = await loadUiState();
  if (state?.webApps && typeof state.webApps === "object") {
    delete state.webApps[`app:${targetId}`];
    queueUiStateWrite();
  }

  const trackerKey = `app:${targetId}`;
  if (chromiumAppTrackers.has(trackerKey)) {
    clearInterval(chromiumAppTrackers.get(trackerKey));
    chromiumAppTrackers.delete(trackerKey);
  }

  const windowKey = `app:${targetId}`;
  const existing = webAppWindows.get(windowKey);
  if (existing && !existing.isDestroyed()) {
    existing.close();
  }

  return await readWebAppsWithPinnedState();
});

ipcMain.handle("config:reorderWebApps", async (_event, ids) => {
  const order = Array.isArray(ids) ? ids.map(id => String(id || "").trim()).filter(Boolean) : [];
  const apps = await readWebAppsConfig();
  const map = new Map(apps.map(item => [item.id, item]));
  const seen = new Set();
  const reordered = [];

  for (const appId of order) {
    const item = map.get(appId);
    if (item && !seen.has(appId)) {
      reordered.push(item);
      seen.add(appId);
    }
  }

  for (const item of apps) {
    if (!item?.id || seen.has(item.id)) {
      continue;
    }
    reordered.push(item);
  }

  await writeWebAppsConfig(reordered);
  return await readWebAppsWithPinnedState();
});

ipcMain.handle("config:setWebAppPinned", async (_event, payload) => {
  const id = String(payload?.id || "").trim();
  const pinned = Boolean(payload?.pinned);
  if (!id) {
    throw new Error("Web app id is required.");
  }

  const apps = await readWebAppsConfig();
  if (!apps.some(item => item?.id === id)) {
    throw new Error(`Web app not found: ${id}`);
  }

  await setWebAppPinned(id, pinned);
  return await readWebAppsWithPinnedState();
});

ipcMain.handle("webapp:pickFile", async (_event, payload) => {
  const purpose = String(payload?.purpose || "").trim().toLowerCase();
  const filters = purpose === "icon"
    ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"] }]
    : undefined;
  const title = purpose === "icon" ? "Pick icon image" : "Pick app or shortcut file";

  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title,
    properties: ["openFile"],
    filters
  });
  if (result.canceled || !result.filePaths?.length) {
    return null;
  }
  return { filePath: result.filePaths[0] };
});

ipcMain.handle("webapp:readIconDataUrl", async (_event, payload) => {
  const filePath = String(payload?.filePath || "").trim();
  if (!filePath) {
    throw new Error("Icon file path is required.");
  }
  return { dataUrl: await readIconFileAsDataUrl(filePath) };
});

ipcMain.handle("webapp:addDroppedPath", async (_event, payload) => {
  const filePath = String(payload?.filePath || "").trim();
  if (!filePath) {
    throw new Error("Dropped file path is required.");
  }

  const suggestion = await suggestLauncherFromDroppedPath(filePath);
  const apps = await readWebAppsConfig();
  const uniqueId = makeUniqueWebAppId(suggestion.id || suggestion.name, apps);
  const nextApp = {
    ...suggestion,
    id: uniqueId
  };
  apps.push(nextApp);
  await writeWebAppsConfig(sortWebAppsByName(apps));
  return {
    app: nextApp,
    apps: await readWebAppsWithPinnedState()
  };
});

ipcMain.handle("webapp:saveWindowState", async (_event, payload) => {
  const appId = String(payload?.id || "").trim();
  if (!appId) {
    throw new Error("Webapp id is required.");
  }

  const apps = await readWebAppsConfig();
  const appEntry = apps.find(item => item?.id === appId);
  if (!appEntry) {
    throw new Error(`Webapp not found: ${appId}`);
  }

  const launchType = normalizeLauncherType(appEntry.launchType) || "external-url";
  const stateKey = `app:${appEntry.id}`;

  if (launchType === "internal-url") {
    const windowKey = `app:${appEntry.id}`;
    const existing = webAppWindows.get(windowKey);
    if (!existing || existing.isDestroyed()) {
      throw new Error("Open the built-in window first, then save.");
    }
    const snapshot = captureWindowState(existing);
    await persistWebAppWindowState(stateKey, snapshot, { manual: true });
    return {
      ok: true,
      id: appEntry.id,
      launchType,
      stateKey,
      source: "electron-window",
      snapshot
    };
  }

  if (launchType === "app-command") {
    const target = resolveWebAppLaunchTarget(appEntry, null);
    const tokens = normalizeLaunchCommandTokens(splitCommandLine(String(target || "")));
    const args = tokens.slice(1);
    const commandAppId = parseCommandArgValue(args, "--app-id");
    const profileDir = parseCommandArgValue(args, "--profile-directory") || "Default";

    if (!commandAppId) {
      throw new Error("Save Window is available for Chromium web apps launched with --app-id.");
    }

    let snapshot = await readX11ChromiumAppWindowState({
      appId: commandAppId,
      appName: appEntry.name || appEntry.id
    });
    if (!snapshot?.bounds) {
      snapshot = await readChromiumAppPlacementFromProfile({ appId: commandAppId, profileDir });
    }
    if (!snapshot?.bounds) {
      throw new Error("No app window found. Open the app and keep it visible, then try Save Window.");
    }

    await persistWebAppWindowState(stateKey, snapshot, { manual: true });
    return {
      ok: true,
      id: appEntry.id,
      launchType,
      stateKey,
      source: snapshot?.windowId ? "x11-window" : "chromium-profile",
      snapshot
    };
  }

  throw new Error("Save Window is supported for Built-in Window and Chromium app-command launchers.");
});

ipcMain.handle("webapp:launch", async (_event, { id, urlOverride }) => {
  const appId = String(id || "").trim();
  if (!appId) {
    throw new Error("Webapp id is required.");
  }

  const apps = await readWebAppsConfig();
  const appEntry = apps.find(appItem => appItem.id === appId);

  if (!appEntry) {
    throw new Error(`Webapp not found: ${appId}`);
  }

  const launchType = normalizeLauncherType(appEntry.launchType) || "external-url";
  const target = resolveWebAppLaunchTarget(appEntry, urlOverride);
  if (!target) {
    throw new Error(`Webapp "${appId}" is missing a launch target.`);
  }

  if (launchType === "internal-url") {
    const result = await launchChromiumWindow({
      windowKey: `app:${appEntry.id}`,
      stateKey: `app:${appEntry.id}`,
      title: appEntry.name || appEntry.id,
      url: target
    });

    return {
      ...result,
      id: appEntry.id,
      url: target,
      launchType,
      engine: "electron-chromium"
    };
  }

  if (launchType === "external-url") {
    await shell.openExternal(target);
    return {
      launched: true,
      reused: false,
      id: appEntry.id,
      url: target,
      launchType,
      engine: "system-default-browser"
    };
  }

  if (launchType === "app-command") {
    await launchCommandTarget(target, {
      cwd: String(appEntry?.cwd || ""),
      stateKey: `app:${appEntry.id}`,
      appName: appEntry.name || appEntry.id
    });
    return {
      launched: true,
      reused: false,
      id: appEntry.id,
      target,
      launchType,
      engine: "system-shell-command"
    };
  }

  if (launchType === "file-path") {
    await launchFilePathTarget(target);
    return {
      launched: true,
      reused: false,
      id: appEntry.id,
      target,
      launchType,
      engine: "system-file-launcher"
    };
  }

  throw new Error(`Unsupported launch type: ${launchType}`);
});

ipcMain.handle("webapp:openUrl", async (_event, payload) => {
  const url = normalizeWebUrl(payload?.url);
  if (!url) {
    throw new Error("A valid URL is required.");
  }

  const title = String(payload?.title || "Browser").trim() || "Browser";
  const result = await launchChromiumWindow({
    windowKey: "external:browser",
    stateKey: "external:browser",
    title,
    url
  });

  return {
    ...result,
    url,
    engine: "electron-chromium"
  };
});
