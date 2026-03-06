const keyInput = document.getElementById("openai-key-input");
const toggleButton = document.getElementById("toggle-openai-key");
const saveButton = document.getElementById("save-openai-key");
const clearButton = document.getElementById("clear-openai-key");
const statusText = document.getElementById("openai-status");

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
            getOpenAIKey: () => window.commandDeskInvoke("config:getOpenAIKey"),
            setOpenAIKey: value => window.commandDeskInvoke("config:setOpenAIKey", value)
          }
        : null
  },
  {
    label: "window.api",
    factory: () =>
      window.api && typeof window.api.invoke === "function"
        ? {
            source: "window.api",
            getOpenAIKey: () => window.api.invoke("config:getOpenAIKey"),
            setOpenAIKey: value => window.api.invoke("config:setOpenAIKey", value)
          }
        : null
  },
  {
    label: "window.commandDeskBridge",
    factory: () =>
      window.commandDeskBridge && typeof window.commandDeskBridge.getOpenAIKey === "function"
        ? {
            source: "window.commandDeskBridge",
            getOpenAIKey: () => window.commandDeskBridge.getOpenAIKey(),
            setOpenAIKey: value => window.commandDeskBridge.setOpenAIKey(value)
          }
        : null
  },
  {
    label: "window.electronAPI",
    factory: () =>
      window.electronAPI && typeof window.electronAPI.getOpenAIKey === "function"
        ? {
            source: "window.electronAPI",
            getOpenAIKey: () => window.electronAPI.getOpenAIKey(),
            setOpenAIKey: value => window.electronAPI.setOpenAIKey(value)
          }
        : null
  },
  {
    label: "parent.commandDeskInvoke",
    factory: () =>
      window.parent && window.parent !== window && typeof window.parent.commandDeskInvoke === "function"
        ? {
            source: "parent.commandDeskInvoke",
            getOpenAIKey: () => window.parent.commandDeskInvoke("config:getOpenAIKey"),
            setOpenAIKey: value => window.parent.commandDeskInvoke("config:setOpenAIKey", value)
          }
        : null
  },
  {
    label: "parent.api",
    factory: () =>
      window.parent && window.parent !== window && window.parent.api && typeof window.parent.api.invoke === "function"
        ? {
            source: "parent.api",
            getOpenAIKey: () => window.parent.api.invoke("config:getOpenAIKey"),
            setOpenAIKey: value => window.parent.api.invoke("config:setOpenAIKey", value)
          }
        : null
  },
  {
    label: "top.commandDeskInvoke",
    factory: () =>
      window.top && window.top !== window && typeof window.top.commandDeskInvoke === "function"
        ? {
            source: "top.commandDeskInvoke",
            getOpenAIKey: () => window.top.commandDeskInvoke("config:getOpenAIKey"),
            setOpenAIKey: value => window.top.commandDeskInvoke("config:setOpenAIKey", value)
          }
        : null
  },
  {
    label: "top.api",
    factory: () =>
      window.top && window.top !== window && window.top.api && typeof window.top.api.invoke === "function"
        ? {
            source: "top.api",
            getOpenAIKey: () => window.top.api.invoke("config:getOpenAIKey"),
            setOpenAIKey: value => window.top.api.invoke("config:setOpenAIKey", value)
          }
        : null
  }
];

function setStatus(message, variant = "info") {
  if (!statusText) {
    return;
  }

  const suffix = bridgeSource !== "none" && variant !== "error"
    ? ` (bridge: ${bridgeSource})`
    : "";

  statusText.textContent = `${message}${suffix}`;
  statusText.classList.remove("success", "error", "warn");

  if (variant !== "info") {
    statusText.classList.add(variant);
  }
}

function resolveBridge() {
  for (const candidate of candidateFactories) {
    try {
      const bridge = candidate.factory();
      if (bridge) {
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
  const callParent = (method, payload) =>
    new Promise((resolve, reject) => {
      const requestId = `cmd-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;

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
            method,
            payload,
            requestId
          },
          "*"
        );

        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("Timeout waiting for parent bridge"));
        }, REQUEST_TIMEOUT);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

  bridgeSource = "messenger";
  return {
    source: bridgeSource,
    getOpenAIKey: () => callParent("config:getOpenAIKey"),
    setOpenAIKey: value => callParent("config:setOpenAIKey", value)
  };
}

function toggleVisibility() {
  if (!keyInput || !toggleButton) {
    return;
  }

  revealSecret = !revealSecret;
  keyInput.type = revealSecret ? "text" : "password";
  toggleButton.textContent = revealSecret ? "Hide" : "Show";
}

async function loadStoredKey() {
  bridgeSource = "none";
  const bridge = resolveBridge();

  if (!bridge || typeof bridge.getOpenAIKey !== "function") {
    setStatus("Waiting for settings bridge…", "warn");
    setTimeout(loadStoredKey, 1000);
    return;
  }

  try {
    const key = await bridge.getOpenAIKey();
    if (key && keyInput) {
      keyInput.value = key;
      setStatus("Stored key loaded. Keep it safe!", "success");
    } else {
      setStatus("No key saved yet. Paste one above to get started.");
    }
  } catch (err) {
    setStatus(`Unable to load key: ${err.message}`, "error");
  }
}

async function saveKey() {
  if (!keyInput) {
    return;
  }

  const value = keyInput.value.trim();
  if (!value) {
    setStatus("Enter a key before saving.", "warn");
    return;
  }

  try {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.setOpenAIKey !== "function") {
      throw new Error("Settings bridge unavailable.");
    }

    await bridge.setOpenAIKey(value);
    setStatus("OpenAI key saved locally.", "success");
  } catch (err) {
    setStatus(`Could not save key: ${err.message}`, "error");
  }
}

async function clearKey() {
  try {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.setOpenAIKey !== "function") {
      throw new Error("Settings bridge unavailable.");
    }

    await bridge.setOpenAIKey("");

    if (keyInput) {
      keyInput.value = "";
      revealSecret = false;
      keyInput.type = "password";
    }

    if (toggleButton) {
      toggleButton.textContent = "Show";
    }

    setStatus("OpenAI key removed.", "success");
  } catch (err) {
    setStatus(`Could not remove key: ${err.message}`, "error");
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

loadStoredKey();

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || data.channel !== CHANNEL || !data.bridgeReady) {
    return;
  }

  setTimeout(loadStoredKey, 100);
});
