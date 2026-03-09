const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const sendButton = document.getElementById("send-btn");
const clearButton = document.getElementById("clear-chat");
const detachButton = document.getElementById("detach-tab");
const quickNoteButton = document.getElementById("quick-note");
const statusLabel = document.getElementById("chat-status");
const sessionMemory = document.getElementById("session-memory");
const sessionActions = document.getElementById("session-actions");
const sessionDetach = document.getElementById("session-detach");
const quickLaunchButtons = document.querySelectorAll("[data-launch]");

// Dashboard elements
const focusList = document.getElementById("focus-list");
const gmailUnread = document.getElementById("gmail-unread");
const gmailList = document.getElementById("gmail-list");
const btnOpenGmail = document.getElementById("btn-open-gmail");
const calendarToday = document.getElementById("calendar-today");
const calendarNext = document.getElementById("calendar-next");
const btnOpenCalendar = document.getElementById("btn-open-calendar");
const webappsList = document.getElementById("webapps-list");

let memoryNotes = 0;
let actionCount = 0;
let detachedWindows = 0;

const bridgeCandidates = [
  () => (typeof window.commandDeskInvoke === "function" ? window.commandDeskInvoke : null),
  () => (window.commandDeskBridge ? wrapObjectBridge(window.commandDeskBridge) : null),
  () => (window.electronAPI ? wrapObjectBridge(window.electronAPI) : null),
  () => (window.api && typeof window.api.invoke === "function" ? window.api.invoke.bind(window.api) : null),
  () => (window.parent && typeof window.parent.commandDeskInvoke === "function" ? window.parent.commandDeskInvoke : null),
  () => (window.parent && window.parent.commandDeskBridge ? wrapObjectBridge(window.parent.commandDeskBridge) : null),
  () => (window.top && typeof window.top.commandDeskInvoke === "function" ? window.top.commandDeskInvoke : null),
  () => (window.top && window.top.commandDeskBridge ? wrapObjectBridge(window.top.commandDeskBridge) : null)
];

function wrapObjectBridge(bridge) {
  if (!bridge) return null;
  return (channel, payload) => {
    switch (channel) {
      case "chat:send":
        if (bridge.chatSend) return bridge.chatSend(payload);
        break;
      case "memory:save":
        if (bridge.memorySave) return bridge.memorySave(payload);
        if (bridge.saveMemory) return bridge.saveMemory(payload);
        break;
      case "memory:load":
        if (bridge.memoryLoad) return bridge.memoryLoad(payload);
        if (bridge.loadMemory) return bridge.loadMemory(payload);
        break;
      case "history:load":
        if (bridge.loadChats) return bridge.loadChats(payload);
        break;
      case "tab:detach":
        if (bridge.detachTab) return bridge.detachTab(payload);
        break;
      case "config:getOpenAIKey":
        if (bridge.getOpenAIKey) return bridge.getOpenAIKey(payload);
        break;
      case "config:setOpenAIKey":
        if (bridge.setOpenAIKey) return bridge.setOpenAIKey(payload);
        break;
      default:
        break;
    }
    return Promise.reject(new Error(`Unsupported channel ${channel}`));
  };
}

function resolveInvoker() {
  for (const factory of bridgeCandidates) {
    try {
      const invoker = factory();
      if (typeof invoker === "function") {
        return invoker;
      }
    } catch (err) {
      console.warn("Bridge resolution failed", err);
    }
  }
  return null;
}

function appendTextWithLineBreaks(container, text) {
  const parts = text.split(/\n/);
  parts.forEach((part, index) => {
    container.appendChild(document.createTextNode(part));
    if (index < parts.length - 1) {
      container.appendChild(document.createElement("br"));
    }
  });
}

function renderRichText(element, text) {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    const preceding = text.slice(lastIndex, match.index);
    if (preceding) {
      appendTextWithLineBreaks(element, preceding);
    }

    const anchor = document.createElement("a");
    anchor.href = match[0];
    anchor.textContent = match[0];
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    element.appendChild(anchor);

    lastIndex = urlRegex.lastIndex;
  }

  const tail = text.slice(lastIndex);
  if (tail) {
    appendTextWithLineBreaks(element, tail);
  }
}

function appendMessage(role, content, { pending = false } = {}) {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}${pending ? " pending" : ""}`;
  renderRichText(bubble, content);
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
  return bubble;
}

function setBubbleContent(bubble, content) {
  if (!bubble) return;
  bubble.innerHTML = "";
  renderRichText(bubble, content);
}

function updateStatus(message, tone = "info") {
  if (!statusLabel) return;
  statusLabel.textContent = message;
  statusLabel.style.color = tone === "error" ? "#ff8888" : tone === "success" ? "#8de46e" : "var(--text-secondary)";
}

async function handleSend() {
  const text = chatInput.value.trim();
  if (!text) {
    updateStatus("Nothing to send yet.");
    chatInput.focus();
    return;
  }

  appendMessage("user", text);
  chatInput.value = "";
  chatInput.style.height = "auto";
  updateStatus("Contacting OpenAI…");

  const placeholder = appendMessage("assistant", "Thinking…", { pending: true });

  const invoker = resolveInvoker();
  if (!invoker) {
    placeholder.classList.remove("pending");
    setBubbleContent(placeholder, "Bridge unavailable. Check API tab or restart.");
    updateStatus("Unable to reach main process.", "error");
    return;
  }

  try {
    const { reply, error } = await invoker("chat:send", { text });
    placeholder.classList.remove("pending");

    if (error) {
      setBubbleContent(placeholder, error);
      updateStatus("OpenAI error", "error");
      return;
    }

    setBubbleContent(placeholder, reply || "(No response received)");
    updateStatus("Response received.", "success");
  } catch (err) {
    placeholder.classList.remove("pending");
    setBubbleContent(placeholder, err.message || "Unexpected error");
    updateStatus("IPC failure", "error");
  }
}

function handleClear() {
  chatLog.innerHTML = "";
  appendMessage("assistant", "Conversation cleared. What should we tackle next?");
  updateStatus("Chat emptied.");
}

function autoResizeTextarea() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 220)}px`;
}

async function handleDetach() {
  if (window.top && window.top.tabsAPI && typeof window.top.tabsAPI.detachTab === "function") {
    window.top.tabsAPI.detachTab("home");
    detachedWindows += 1;
    sessionDetach.textContent = `Detached windows: ${detachedWindows}`;
    updateStatus("Chat detached.", "success");
    return;
  }

  const invoker = resolveInvoker();
  if (!invoker) {
    updateStatus("Detach unavailable.", "error");
    return;
  }

  try {
    await invoker("tab:detach", "home");
    detachedWindows += 1;
    sessionDetach.textContent = `Detached windows: ${detachedWindows}`;
    updateStatus("Chat detached.", "success");
  } catch (err) {
    updateStatus("Detach failed.", "error");
  }
}

function handleQuickNote() {
  const text = chatInput.value.trim();
  if (!text) {
    updateStatus("Write a note before saving.");
    chatInput.focus();
    return;
  }

  appendMessage("assistant", `Noted: ${text}`);
  chatInput.value = "";
  autoResizeTextarea();

  const invoker = resolveInvoker();
  if (invoker) {
    invoker("memory:save", { last_note: text, noted_at: new Date().toISOString() });
  }

  memoryNotes += 1;
  sessionMemory.textContent = `Memory notes: ${memoryNotes}`;
  updateStatus("Note captured.", "success");
}

// Dashboard loaders
async function loadTodayFocus() {
  if (!focusList) return;
  focusList.innerHTML = "";
  // TODO: load from data/today_focus.json via bridge
  const items = [
    "Review inbox and calendar for today",
    "Check ongoing projects in OpenClaw Hub",
    "Plan next actions for the day"
  ];
  items.forEach(text => {
    const li = document.createElement("li");
    li.textContent = text;
    focusList.appendChild(li);
  });
}

async function loadGmailSnapshot() {
  if (!gmailList || !gmailUnread) return;
  gmailList.innerHTML = "";

  const invoker = resolveInvoker();
  if (!invoker) {
    gmailUnread.textContent = "Unread: --";
    const li = document.createElement("li");
    li.textContent = "Email snapshot unavailable (no bridge).";
    gmailList.appendChild(li);
    return;
  }

  try {
    const snapshot = await invoker("google:gmailPrimarySnapshot", null);
    const { unread = 0, messages = [], authRequired = false, message = "" } = snapshot || {};

    if (authRequired) {
      gmailUnread.textContent = "Unread: --";
      const li = document.createElement("li");
      li.textContent = message || "Connect Google in the API tab.";
      gmailList.appendChild(li);
      return;
    }

    gmailUnread.textContent = `Unread: ${unread}`;

    if (!messages.length) {
      const li = document.createElement("li");
      li.textContent = "Primary inbox looks clear.";
      gmailList.appendChild(li);
      return;
    }

    messages.slice(0, 5).forEach(msg => {
      const li = document.createElement("li");
      li.textContent = `${msg.from || "Unknown"} — ${msg.subject || "(no subject)"}`;
      gmailList.appendChild(li);
    });
  } catch (err) {
    gmailUnread.textContent = "Unread: --";
    const li = document.createElement("li");
    li.textContent = `Error loading Gmail: ${err.message || err}`;
    gmailList.appendChild(li);
  }
}

async function loadCalendarSnapshot() {
  if (!calendarToday || !calendarNext) return;
  calendarToday.innerHTML = "";

  const invoker = resolveInvoker();
  if (!invoker) {
    const li = document.createElement("li");
    li.textContent = "Calendar unavailable (no bridge).";
    calendarToday.appendChild(li);
    calendarNext.textContent = "Next: --";
    return;
  }

  try {
    const snapshot = await invoker("google:calendarSnapshot", null);
    const { today = [], upcoming = null, authRequired = false, message = "" } = snapshot || {};

    if (authRequired) {
      const li = document.createElement("li");
      li.textContent = message || "Connect Google in the API tab.";
      calendarToday.appendChild(li);
      calendarNext.textContent = "Next: --";
      return;
    }

    if (!today.length) {
      const li = document.createElement("li");
      li.textContent = "No events on the calendar today.";
      calendarToday.appendChild(li);
    } else {
      today.forEach(ev => {
        const li = document.createElement("li");
        li.textContent = `${ev.time || ""} — ${ev.title || "(untitled event)"}`;
        calendarToday.appendChild(li);
      });
    }

    if (upcoming) {
      calendarNext.textContent = `Next: ${upcoming.when || ""} — ${upcoming.title || "(untitled)"}`;
    } else {
      calendarNext.textContent = "Next: --";
    }
  } catch (err) {
    const li = document.createElement("li");
    li.textContent = `Error loading calendar: ${err.message || err}`;
    calendarToday.appendChild(li);
    calendarNext.textContent = "Next: --";
  }
}

async function loadWebApps() {
  if (!webappsList) return;
  webappsList.innerHTML = "";

  const invoker = resolveInvoker();
  if (!invoker) {
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.disabled = true;
    btn.textContent = "Webapps unavailable (no bridge).";
    webappsList.appendChild(btn);
    return;
  }

  try {
    const apps = await invoker("config:listWebApps", null);
    if (!apps || !apps.length) {
      const btn = document.createElement("button");
      btn.className = "secondary";
      btn.disabled = true;
      btn.textContent = "No web apps configured yet.";
      webappsList.appendChild(btn);
      return;
    }

    apps.forEach(app => {
      const btn = document.createElement("button");
      btn.className = "secondary";
      btn.textContent = app.name || app.id || "App";
      btn.addEventListener("click", () => {
        invoker("webapp:launch", { id: app.id });
        actionCount += 1;
        sessionActions.textContent = `Actions queued: ${actionCount}`;
        updateStatus(`Launching ${app.name || app.id}…`);
      });
      webappsList.appendChild(btn);
    });
  } catch (err) {
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.disabled = true;
    btn.textContent = `Error loading web apps: ${err.message || err}`;
    webappsList.appendChild(btn);
  }
}

function attachEvents() {
  sendButton.addEventListener("click", handleSend);
  clearButton.addEventListener("click", handleClear);
  detachButton.addEventListener("click", handleDetach);
  quickNoteButton.addEventListener("click", handleQuickNote);

  chatInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  });

  chatInput.addEventListener("input", autoResizeTextarea);
  autoResizeTextarea();

  quickLaunchButtons.forEach(button => {
    button.addEventListener("click", () => {
      const url = button.dataset.launch;
      if (url) {
        window.open(url, "_blank", "noopener");
        actionCount += 1;
        sessionActions.textContent = `Actions queued: ${actionCount}`;
        updateStatus(`Opened ${new URL(url).hostname}.`);
      }
    });
  });

  // New dashboard buttons
  if (btnOpenGmail) {
    btnOpenGmail.addEventListener("click", async () => {
      const invoker = resolveInvoker();
      if (!invoker) {
        window.open("https://mail.google.com", "_blank", "noopener");
        updateStatus("Opened Gmail in default browser.");
        return;
      }
      await invoker("webapp:launch", { id: "gmail" });
      actionCount += 1;
      sessionActions.textContent = `Actions queued: ${actionCount}`;
      updateStatus("Launching Gmail…");
    });
  }

  if (btnOpenCalendar) {
    btnOpenCalendar.addEventListener("click", async () => {
      const invoker = resolveInvoker();
      if (!invoker) {
        window.open("https://calendar.google.com", "_blank", "noopener");
        updateStatus("Opened Calendar in default browser.");
        return;
      }
      await invoker("webapp:launch", { id: "calendar" });
      actionCount += 1;
      sessionActions.textContent = `Actions queued: ${actionCount}`;
      updateStatus("Launching Calendar…");
    });
  }

  // Initial dashboard loads
  loadTodayFocus();
  loadGmailSnapshot();
  loadCalendarSnapshot();
  loadWebApps();
}

attachEvents();
updateStatus("Ready to assist.");




