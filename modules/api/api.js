const keyInput = document.getElementById("openai-key-input");
const toggleButton = document.getElementById("toggle-openai-key");
const saveButton = document.getElementById("save-openai-key");
const clearButton = document.getElementById("clear-openai-key");
const openAIStatusText = document.getElementById("openai-status");

const googleClientIdInput = document.getElementById("google-client-id-input");
const saveGoogleClientIdButton = document.getElementById("save-google-client-id");
const clearGoogleClientIdButton = document.getElementById("clear-google-client-id");
const connectGoogleButton = document.getElementById("connect-google");
const disconnectGoogleButton = document.getElementById("disconnect-google");
const googleStatusText = document.getElementById("google-status");
const googleMemoryModeText = document.getElementById("google-memory-mode");

const CHANNEL = "commanddesk:bridge";
const REQUEST_TIMEOUT = 4000;

let revealSecret = false;
let bridgeSource = "none";
let messengerBridge = null;

const candidateFactories = [
  {
    label: "window.commandDeskInvoke",
    factory: () =>
      typeof window.commandDeskInvoke === "function"
        ? {
            source: "window.commandDeskInvoke",
            invoke: (channel, payload) => window.commandDeskInvoke(channel, payload)
          }
        : null
  },
  {
    label: "window.api",
    factory: () =>
      window.api && typeof window.api.invoke === "function"
        ? {
            source: "window.api",
            invoke: (channel, payload) => window.api.invoke(channel, payload)
          }
        : null
  },
  {
    label: "window.commandDeskBridge",
    factory: () =>
      window.commandDeskBridge && typeof window.commandDeskBridge.invoke === "function"
        ? {
            source: "window.commandDeskBridge",
            invoke: (channel, payload) => window.commandDeskBridge.invoke(channel, payload)
          }
        : null
  },
  {
    label: "window.electronAPI",
    factory: () =>
      window.electronAPI && typeof window.electronAPI.invoke === "function"
        ? {
            source: "window.electronAPI",
            invoke: (channel, payload) => window.electronAPI.invoke(channel, payload)
          }
        : null
  },
  {
    label: "parent.commandDeskInvoke",
    factory: () =>
      window.parent && window.parent !== window && typeof window.parent.commandDeskInvoke === "function"
        ? {
            source: "parent.commandDeskInvoke",
            invoke: (channel, payload) => window.parent.commandDeskInvoke(channel, payload)
          }
        : null
  },
  {
    label: "parent.api",
    factory: () =>
      window.parent && window.parent !== window && window.parent.api && typeof window.parent.api.invoke === "function"
        ? {
            source: "parent.api",
            invoke: (channel, payload) => window.parent.api.invoke(channel, payload)
          }
        : null
  },
  {
    label: "top.commandDeskInvoke",
    factory: () =>
      window.top && window.top !== window && typeof window.top.commandDeskInvoke === "function"
        ? {
            source: "top.commandDeskInvoke",
            invoke: (channel, payload) => window.top.commandDeskInvoke(channel, payload)
          }
        : null
  },
  {
    label: "top.api",
    factory: () =>
      window.top && window.top !== window && window.top.api && typeof window.top.api.invoke === "function"
        ? {
            source: "top.api",
            invoke: (channel, payload) => window.top.api.invoke(channel, payload)
          }
        : null
  }
];

function withBridgeSuffix(message, variant) {
  if (bridgeSource === "none" || variant === "error") {
    return message;
  }
  return `${message} (bridge: ${bridgeSource})`;
}

function setStatus(element, message, variant = "info") {
  if (!element) {
    return;
  }

  element.textContent = withBridgeSuffix(message, variant);
  element.classList.remove("success", "error", "warn");
  if (variant !== "info") {
    element.classList.add(variant);
  }
}

function resolveBridge() {
  for (const candidate of candidateFactories) {
    try {
      const bridge = candidate.factory();
      if (bridge && typeof bridge.invoke === "function") {
        bridgeSource = candidate.label;
        return bridge;
      }
    } catch (err) {
      console.warn("Bridge candidate failed", candidate.label, err);
    }
  }

  if (!messengerBridge) {
    messengerBridge = createMessenger();
  }

  return messengerBridge;
}

function createMessenger() {
  if (!window.parent || window.parent === window) {
    return null;
  }

  const parentWindow = window.parent;
  bridgeSource = "messenger";

  return {
    source: bridgeSource,
    invoke(channel, payload) {
      return new Promise((resolve, reject) => {
        const requestId = `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        let timeoutId;

        const listener = event => {
          const data = event.data;
          if (!data || data.channel !== CHANNEL || data.requestId !== requestId) {
            return;
          }

          cleanup();
          if (data.success) {
            resolve(data.result);
          } else {
            reject(new Error(data.error || "Bridge error"));
          }
        };

        const cleanup = () => {
          window.removeEventListener("message", listener);
          if (typeof timeoutId === "number") {
            clearTimeout(timeoutId);
          }
        };

        window.addEventListener("message", listener);

        try {
          parentWindow.postMessage(
            {
              channel: CHANNEL,
              method: channel,
              payload,
              requestId
            },
            "*"
          );
        } catch (err) {
          cleanup();
          reject(err);
          return;
        }

        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("Timeout waiting for parent bridge"));
        }, REQUEST_TIMEOUT);
      });
    }
  };
}

async function invokeBridge(channel, payload) {
  bridgeSource = "none";
  const bridge = resolveBridge();
  if (!bridge || typeof bridge.invoke !== "function") {
    throw new Error("Settings bridge unavailable.");
  }
  return await bridge.invoke(channel, payload);
}

function toggleVisibility() {
  if (!keyInput || !toggleButton) {
    return;
  }

  revealSecret = !revealSecret;
  keyInput.type = revealSecret ? "text" : "password";
  toggleButton.textContent = revealSecret ? "Hide" : "Show";
}

function isPlausibleGoogleClientId(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^[0-9]+-[a-z0-9._-]+\.apps\.googleusercontent\.com$/i.test(trimmed);
}

async function loadStoredKey() {
  try {
    const key = await invokeBridge("config:getOpenAIKey");
    if (key && keyInput) {
      keyInput.value = key;
      setStatus(openAIStatusText, "Stored key loaded. Keep it safe!", "success");
    } else {
      setStatus(openAIStatusText, "No key saved yet. Paste one above to get started.");
    }
  } catch (err) {
    setStatus(openAIStatusText, `Unable to load key: ${err.message}`, "error");
  }
}

async function saveKey() {
  if (!keyInput) {
    return;
  }

  const value = keyInput.value.trim();
  if (!value) {
    setStatus(openAIStatusText, "Enter a key before saving.", "warn");
    return;
  }

  try {
    await invokeBridge("config:setOpenAIKey", value);
    setStatus(openAIStatusText, "OpenAI key saved locally.", "success");
  } catch (err) {
    setStatus(openAIStatusText, `Could not save key: ${err.message}`, "error");
  }
}

async function clearKey() {
  try {
    await invokeBridge("config:setOpenAIKey", "");
    if (keyInput) {
      keyInput.value = "";
      keyInput.type = "password";
    }
    revealSecret = false;
    if (toggleButton) {
      toggleButton.textContent = "Show";
    }
    setStatus(openAIStatusText, "OpenAI key removed.", "success");
  } catch (err) {
    setStatus(openAIStatusText, `Could not remove key: ${err.message}`, "error");
  }
}

function renderGoogleStatus(status) {
  if (googleClientIdInput && typeof status?.clientId === "string") {
    googleClientIdInput.value = status.clientId;
  }

  if (!status?.configured) {
    setStatus(googleStatusText, "Save a Google OAuth desktop client ID to enable Google integrations.", "warn");
  } else if (status.connected) {
    const label = status.accountEmail || status.accountName || "Google account connected";
    const expires = status.expiresAt ? ` Token refresh ready until ${new Date(status.expiresAt).toLocaleString()}.` : "";
    setStatus(googleStatusText, `${label} connected.${expires}`, "success");
  } else {
    setStatus(googleStatusText, "Client ID saved. Connect Google to enable Gmail, Calendar, and memory sync.", "warn");
  }

  if (googleMemoryModeText) {
    const label = status?.memoryBackend === "local+google-drive-appdata"
      ? "Memory backend: local + Google Drive appData sync"
      : "Memory backend: local";
    googleMemoryModeText.textContent = label;
  }

  if (connectGoogleButton) {
    connectGoogleButton.disabled = !status?.configured;
  }

  if (disconnectGoogleButton) {
    disconnectGoogleButton.disabled = !status?.connected;
  }
}

async function loadGoogleStatus() {
  try {
    const status = await invokeBridge("config:getGoogleAuthStatus");
    renderGoogleStatus(status || {});
  } catch (err) {
    setStatus(googleStatusText, `Unable to load Google status: ${err.message}`, "error");
  }
}

async function saveGoogleClientId() {
  if (!googleClientIdInput) {
    return;
  }

  const value = googleClientIdInput.value.trim();
  if (!value) {
    setStatus(googleStatusText, "Enter a Google OAuth client ID before saving.", "warn");
    return;
  }

  if (!isPlausibleGoogleClientId(value)) {
    setStatus(googleStatusText, "That does not look like a Google OAuth Desktop client ID. It should end with .apps.googleusercontent.com.", "error");
    return;
  }

  try {
    const result = await invokeBridge("config:setGoogleClientId", value);
    renderGoogleStatus(result?.status || {});
  } catch (err) {
    setStatus(googleStatusText, `Could not save client ID: ${err.message}`, "error");
  }
}

async function clearGoogleClientId() {
  try {
    const result = await invokeBridge("config:setGoogleClientId", "");
    renderGoogleStatus(result?.status || {});
  } catch (err) {
    setStatus(googleStatusText, `Could not remove client ID: ${err.message}`, "error");
  }
}

async function connectGoogle() {
  const currentValue = googleClientIdInput?.value?.trim() || "";
  if (!isPlausibleGoogleClientId(currentValue)) {
    setStatus(googleStatusText, "Save a valid Google OAuth Desktop client ID before connecting.", "error");
    return;
  }

  try {
    await invokeBridge("config:setGoogleClientId", currentValue);
    setStatus(googleStatusText, "Opening Google sign-in…");
    const status = await invokeBridge("google:connect");
    renderGoogleStatus(status || {});
  } catch (err) {
    setStatus(googleStatusText, `Google connect failed: ${err.message}`, "error");
  }
}

async function disconnectGoogle() {
  try {
    const status = await invokeBridge("google:disconnect");
    renderGoogleStatus(status || {});
  } catch (err) {
    setStatus(googleStatusText, `Google disconnect failed: ${err.message}`, "error");
  }
}

if (toggleButton) {
  toggleButton.addEventListener("click", toggleVisibility);
}

if (saveButton) {
  saveButton.addEventListener("click", saveKey);
}

if (clearButton) {
  clearButton.addEventListener("click", clearKey);
}

if (keyInput) {
  keyInput.addEventListener("keyup", event => {
    if (event.key === "Enter") {
      saveKey();
    }
  });
}

if (saveGoogleClientIdButton) {
  saveGoogleClientIdButton.addEventListener("click", saveGoogleClientId);
}

if (clearGoogleClientIdButton) {
  clearGoogleClientIdButton.addEventListener("click", clearGoogleClientId);
}

if (connectGoogleButton) {
  connectGoogleButton.addEventListener("click", connectGoogle);
}

if (disconnectGoogleButton) {
  disconnectGoogleButton.addEventListener("click", disconnectGoogle);
}

if (googleClientIdInput) {
  googleClientIdInput.addEventListener("keyup", event => {
    if (event.key === "Enter") {
      saveGoogleClientId();
    }
  });
}

loadStoredKey();
loadGoogleStatus();

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || data.channel !== CHANNEL || !data.bridgeReady) {
    return;
  }

  setTimeout(() => {
    loadStoredKey();
    loadGoogleStatus();
  }, 100);
});
