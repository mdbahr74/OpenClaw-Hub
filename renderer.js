const COMMAND_DESK_CHANNEL = "commanddesk:bridge";
const COMMAND_DESK_READY_EVENT = { channel: COMMAND_DESK_CHANNEL, bridgeReady: true };
let commandDeskBridgeRegistered = false;
let bridgeRetryScheduled = false;
const TOPBAR_QUOTES = [
  "Discipline beats intensity.",
  "One clean execution at a time.",
  "Small edges compound.",
  "Protect capital first.",
  "Trade the plan, not emotion.",
  "Consistency creates momentum.",
  "Focus on process, not noise.",
  "Keep risk defined.",
  "Patience is a position.",
  "Clarity over speed."
];

function registerCommandDeskBridge() {
  if (typeof window === "undefined") {
    return;
  }

  if (commandDeskBridgeRegistered) {
    return;
  }

  if (!window.electronAPI) {
    if (!bridgeRetryScheduled) {
      bridgeRetryScheduled = true;
      setTimeout(() => {
        bridgeRetryScheduled = false;
        registerCommandDeskBridge();
      }, 500);
    }
    return;
  }

  const electronBridge = {
    invoke(channel, data) {
      if (window.api && typeof window.api.invoke === "function") {
        return window.api.invoke(channel, data);
      }
      return Promise.reject(new Error("IPC invoke unavailable"));
    },
    commandDeskInvoke(channel, data) {
      return electronBridge.invoke(channel, data);
    },
    exportTranscript(chatId) {
      return window.electronAPI.exportTranscript(chatId);
    },
    loadChats() {
      return window.electronAPI.loadChats();
    },
    getOpenAIKey() {
      return window.electronAPI.getOpenAIKey();
    },
    setOpenAIKey(value) {
      return window.electronAPI.setOpenAIKey(value);
    }
  };

  window.commandDeskBridge = electronBridge;
  window.top.commandDeskBridge = electronBridge;

  if (window.api && typeof window.api.invoke === "function") {
    window.commandDeskInvoke = (channel, data) => window.api.invoke(channel, data);
  } else if (window.electronAPI && typeof window.electronAPI.invoke === "function") {
    window.commandDeskInvoke = (channel, data) => window.electronAPI.invoke(channel, data);
  } else {
    window.commandDeskInvoke = (channel, data) =>
      Promise.reject(new Error("IPC invoke unavailable"));
  }

  window.top.commandDeskInvoke = window.commandDeskInvoke;

  const requestHandlers = {
    "transcript:export": electronBridge.exportTranscript,
    "history:load": electronBridge.loadChats,
    "config:getOpenAIKey": electronBridge.getOpenAIKey,
    "config:setOpenAIKey": electronBridge.setOpenAIKey
  };

  window.addEventListener("message", async event => {
    const data = event.data;
    if (
      !data ||
      data.channel !== COMMAND_DESK_CHANNEL ||
      !data.requestId ||
      !data.method
    ) {
      return;
    }

    console.log("[CommandDeskBridge] request", data.method);

    const sendReply = payload => {
      try {
        event.source?.postMessage(
          {
            channel: COMMAND_DESK_CHANNEL,
            requestId: data.requestId,
            ...payload
          },
          event.origin || "*"
        );
      } catch (err) {
        console.warn("Failed to respond to iframe request:", err);
      }
    };

    const handler = requestHandlers[data.method];
    if (!handler) {
      sendReply({ success: false, error: `Unknown method: ${data.method}` });
      return;
    }

    try {
      const result = await handler(data.payload);
      console.log("[CommandDeskBridge] response", data.method);
      sendReply({ success: true, result });
    } catch (err) {
      console.error("[CommandDeskBridge] error", data.method, err);
      sendReply({
        success: false,
        error: err?.message ?? "Unexpected error"
      });
    }
  });

  commandDeskBridgeRegistered = true;
}

if (typeof window !== "undefined") {
  registerCommandDeskBridge();
}

function wireIframesToBridge() {
  if (typeof window === "undefined") {
    return;
  }

  const frames = document.querySelectorAll("#content iframe");

  frames.forEach(frame => {
    const assignBridge = () => {
      registerCommandDeskBridge();

      const bridge = window.commandDeskBridge;
      if (!bridge) {
        setTimeout(assignBridge, 400);
        return;
      }

      try {
        if (frame.contentWindow) {
          frame.contentWindow.commandDeskBridge = bridge;
          frame.contentWindow.commandDeskBridgeReady = true;
          if (typeof window.commandDeskInvoke === "function") {
            frame.contentWindow.commandDeskInvoke = window.commandDeskInvoke;
          } else if (window.api && typeof window.api.invoke === "function") {
            frame.contentWindow.commandDeskInvoke = (channel, data) => window.api.invoke(channel, data);
          }
          frame.contentWindow.postMessage(COMMAND_DESK_READY_EVENT, "*");
        }
      } catch (err) {
        console.warn("Unable to inject bridge into iframe:", err);
      }
    };

    frame.addEventListener("load", assignBridge);
    assignBridge();
  });
}

async function fetchMemory() {
  const output = document.getElementById("memory-output");

  if (!window.api || typeof window.api.invoke !== "function") {
    if (output) {
      output.innerText = "Memory bridge unavailable.";
    }
    return;
  }

  const state = await window.api.invoke("memory:load");
  if (output) {
    output.innerText = JSON.stringify(state, null, 2);
  }
}

async function updateMemory(newNotes) {
  const output = document.getElementById("memory-output");

  if (!window.api || typeof window.api.invoke !== "function") {
    if (output) {
      output.innerText = "Memory bridge unavailable.";
    }
    return;
  }

  const state = await window.api.invoke("memory:save", {
    notes: newNotes
  });

  if (output) {
    output.innerText = JSON.stringify(state, null, 2);
  }
}

function activateTab(moduleName) {
  document.querySelectorAll("#tab-bar li").forEach(li => {
    li.classList.toggle("active", li.dataset.module === moduleName);
  });

  document.querySelectorAll("#content iframe").forEach(iframe => {
    iframe.classList.toggle(
      "active",
      iframe.id === `tab-${moduleName}`
    );
  });
}

function initTabs() {
  const tabItems = document.querySelectorAll("#tab-bar li");
  if (!tabItems.length) {
    return;
  }

  tabItems.forEach(item => {
    const moduleName = item.dataset.module;
    if (!moduleName) {
      return;
    }

    item.addEventListener("click", () => activateTab(moduleName));

    item.addEventListener("dblclick", () => {
      if (window.tabsAPI && typeof window.tabsAPI.detachTab === "function") {
        window.tabsAPI.detachTab(moduleName);
      }
    });
  });
}

function initStatusBar() {
  const gmailStatus = document.getElementById("gmail-status");
  const calendarStatus = document.getElementById("calendar-status");
  const sysStats = document.getElementById("sys-stats");

  if (gmailStatus) {
    gmailStatus.textContent = "Unread Emails: syncing...";
    setTimeout(() => {
      gmailStatus.textContent = "Unread Emails: 0";
    }, 1200);
  }

  if (calendarStatus) {
    calendarStatus.textContent = "Next Event: none scheduled";
  }

  if (sysStats) {
    sysStats.textContent = "CPU: --% | MEM: --";
  }
}

function initTopbarQuoteRotator() {
  const quoteEl = document.getElementById("topbar-quote");
  if (!quoteEl) {
    return;
  }

  let index = Math.floor(Math.random() * TOPBAR_QUOTES.length);
  const render = () => {
    quoteEl.textContent = `"${TOPBAR_QUOTES[index]}"`;
  };

  render();
  setInterval(() => {
    index = (index + 1) % TOPBAR_QUOTES.length;
    render();
  }, 12000);
}

function resolveInvokeBridge() {
  if (typeof window.commandDeskInvoke === "function") {
    return window.commandDeskInvoke;
  }
  if (window.api && typeof window.api.invoke === "function") {
    return window.api.invoke.bind(window.api);
  }
  if (window.electronAPI && typeof window.electronAPI.invoke === "function") {
    return window.electronAPI.invoke.bind(window.electronAPI);
  }
  return null;
}

function renderTopbarSystemStats(stats) {
  const sysStats = document.getElementById("sys-stats");
  if (!sysStats) {
    return;
  }

  const cpuValue = Number(stats?.cpuPercent);
  const memValue = Number(stats?.memory?.percent);
  const cpuText = Number.isFinite(cpuValue) ? `${Math.round(cpuValue)}%` : "--%";
  const memText = Number.isFinite(memValue) ? `${Math.round(memValue)}%` : "--";
  sysStats.textContent = `CPU: ${cpuText} | MEM: ${memText}`;
}

async function refreshTopbarSystemStats() {
  const invoker = resolveInvokeBridge();
  if (!invoker) {
    return;
  }

  try {
    const stats = await invoker("system:stats", null);
    renderTopbarSystemStats(stats);
  } catch {
    renderTopbarSystemStats(null);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initStatusBar();
  initTopbarQuoteRotator();
  registerCommandDeskBridge();
  wireIframesToBridge();
  void refreshTopbarSystemStats();
  setInterval(refreshTopbarSystemStats, 2500);

  // Ensure the default active tab is visible on load.
  const activeTab = document.querySelector("#tab-bar li.active");
  if (activeTab) {
    activateTab(activeTab.dataset.module);
  }
});

// Expose functions for inline handlers used by index.html
window.fetchMemory = fetchMemory;
window.updateMemory = updateMemory;
