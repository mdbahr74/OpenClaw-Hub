const listEl = document.getElementById("conversation-list");
const selectEl = document.getElementById("conversation-select");
const transcriptEl = document.getElementById("transcript");
const titleEl = document.getElementById("conversation-title");
const timeEl = document.getElementById("conversation-time");
const metaEl = document.getElementById("conversation-meta");
const inputEl = document.getElementById("history-input");
const sendEl = document.getElementById("history-send");
const agentSelectEl = document.getElementById("agent-select");
const newChatEl = document.getElementById("new-chat");
const deleteEl = document.getElementById("delete-chat");
const promoteEl = document.getElementById("promote-chat");

let conversations = [];
let filteredConversations = [];
let activeIndex = -1;
let pendingBubble = null;

function wrapObjectBridge(bridge) {
  if (!bridge) return null;
  return (channel, payload) => {
    switch (channel) {
      case "chat:send":
        if (bridge.chatSend) return bridge.chatSend(payload);
        break;
      case "history:load":
        if (bridge.loadChats) return bridge.loadChats(payload);
        break;
      case "history:delete":
        if (bridge.deleteChat) return bridge.deleteChat(payload);
        break;
      case "memory:save":
        if (bridge.saveMemory) return bridge.saveMemory(payload);
        if (bridge.memorySave) return bridge.memorySave(payload);
        break;
      case "memory:load":
        if (bridge.loadMemory) return bridge.loadMemory(payload);
        if (bridge.memoryLoad) return bridge.memoryLoad(payload);
        break;
      case "project:promoteConversation":
        if (bridge.promoteConversation) return bridge.promoteConversation(payload);
        break;
      default:
        break;
    }
    return Promise.reject(new Error(`Unsupported channel ${channel}`));
  };
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

const invokerCandidates = [
  () => (typeof window.commandDeskInvoke === "function" ? window.commandDeskInvoke : null),
  () => (window.commandDeskBridge ? wrapObjectBridge(window.commandDeskBridge) : null),
  () => (window.electronAPI ? wrapObjectBridge(window.electronAPI) : null),
  () => (window.api && typeof window.api.invoke === "function" ? window.api.invoke.bind(window.api) : null),
  () => (window.parent && typeof window.parent.commandDeskInvoke === "function" ? window.parent.commandDeskInvoke : null),
  () => (window.parent && window.parent.commandDeskBridge ? wrapObjectBridge(window.parent.commandDeskBridge) : null),
  () => (window.top && typeof window.top.commandDeskInvoke === "function" ? window.top.commandDeskInvoke : null),
  () => (window.top && window.top.commandDeskBridge ? wrapObjectBridge(window.top.commandDeskBridge) : null)
];

function resolveInvoker() {
  for (const factory of invokerCandidates) {
    try {
      const invoker = factory();
      if (typeof invoker === "function") {
        return invoker;
      }
    } catch (err) {
      console.warn("History bridge resolution failed", err);
    }
  }
  return null;
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const date = new Date(iso);
    return date.toLocaleString();
  } catch {
    return "";
  }
}

function createNewConversation() {
  const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const conversation = {
    id,
    title: "New chat",
    created_at: now,
    messages: []
  };

  conversations.unshift(conversation);
  filteredConversations = conversations.slice();
  activeIndex = 0;
  renderList(filteredConversations);
  selectConversation(0);
}

function renderList(items) {
  if (!selectEl) return;

  selectEl.innerHTML = "";

  if (!items.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No conversations";
    selectEl.appendChild(opt);
    selectEl.disabled = true;
    return;
  }

  selectEl.disabled = false;

  items.forEach((conversation, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = conversation.title || `Conversation ${index + 1}`;
    if (index === activeIndex) {
      opt.selected = true;
    }
    selectEl.appendChild(opt);
  });
}

function renderTranscript(conversation) {
  transcriptEl.innerHTML = "";

  if (!conversation) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Choose a conversation from the left to review the transcript and continue the discussion.";
    transcriptEl.appendChild(empty);
    return;
  }

  conversation.messages.forEach(message => {
    if (!message || !message.role || !message.content) return;
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role}`;
    renderRichText(bubble, message.content);
    transcriptEl.appendChild(bubble);
  });

  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function selectConversation(index) {
  activeIndex = index;
  const conversation = filteredConversations[index];

  titleEl.textContent = conversation?.title || "Conversation";
  timeEl.textContent = formatDate(conversation?.created_at);
  metaEl.innerHTML = "";

  if (conversation) {
    const countPill = document.createElement("span");
    countPill.className = "pill";
    countPill.textContent = `${conversation.messages?.length || 0} messages`;
    metaEl.appendChild(countPill);
  }

  renderList(filteredConversations);
  renderTranscript(conversation);

  if (selectEl && activeIndex >= 0 && activeIndex < filteredConversations.length) {
    selectEl.value = String(activeIndex);
  }
}

function applySearch(term) {
  const q = (term ?? "").trim().toLowerCase();
  filteredConversations = conversations.filter(conv => {
    const title = conv.title || "";
    return title.toLowerCase().includes(q);
  });
  activeIndex = filteredConversations.length ? 0 : -1;
  renderList(filteredConversations);
  selectConversation(activeIndex);
}

async function handleSend() {
  const text = inputEl.value.trim();
  if (!text) {
    inputEl.focus();
    return;
  }

  if (activeIndex < 0 || !filteredConversations[activeIndex]) {
    appendSystemMessage("Select a conversation first.");
    return;
  }

  const conversation = filteredConversations[activeIndex];
  const currentAgentId = agentSelectEl?.value || "main";

  const userBubble = document.createElement("div");
  userBubble.className = "bubble user";
  renderRichText(userBubble, text);
  transcriptEl.appendChild(userBubble);

  pendingBubble = document.createElement("div");
  pendingBubble.className = "bubble assistant pending";
  renderRichText(pendingBubble, "Thinking…");
  transcriptEl.appendChild(pendingBubble);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  inputEl.value = "";

  const invoker = resolveInvoker();
  if (!invoker) {
    finalizeAssistantBubble("Bridge unavailable. Try again later.");
    return;
  }

  try {
    const payload = {
      text,
      conversationId: conversation.id || conversation.conversationId || null,
      agentId: currentAgentId
    };
    const { reply, error } = await invoker("chat:send", payload);
    if (error) {
      finalizeAssistantBubble(error);
      return;
    }

    finalizeAssistantBubble(reply || "(No response.)");

    conversation.messages = conversation.messages || [];
    conversation.messages.push({ role: "user", content: text });
    conversation.messages.push({ role: "assistant", content: reply || "" });
  } catch (err) {
    finalizeAssistantBubble(err.message || "Unexpected error");
  }
}

async function handlePromote() {
  if (activeIndex < 0 || !filteredConversations[activeIndex]) {
    appendSystemMessage("Select a conversation to promote.");
    return;
  }

  const conversation = filteredConversations[activeIndex];
  const invoker = resolveInvoker();
  if (!invoker) {
    appendSystemMessage("Bridge unavailable; cannot promote.");
    return;
  }

  try {
    await invoker("project:promoteConversation", {
      conversation
    });
    appendSystemMessage("Conversation promoted to project notes.");
  } catch (err) {
    appendSystemMessage(err.message || "Failed to promote conversation.");
  }
}

function finalizeAssistantBubble(message) {
  if (!pendingBubble) return;
  pendingBubble.classList.remove("pending");
  pendingBubble.innerHTML = "";
  renderRichText(pendingBubble, message);
  pendingBubble = null;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function appendSystemMessage(message) {
  const bubble = document.createElement("div");
  bubble.className = "bubble assistant";
  renderRichText(bubble, message);
  transcriptEl.appendChild(bubble);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

async function loadConversations() {
  const invoker = resolveInvoker();
  if (!invoker) {
    appendSystemMessage("History bridge unavailable.");
    return;
  }

  try {
    conversations = await invoker("history:load");
    filteredConversations = conversations.slice();

    // Always start with a fresh "New chat" at the top, even if history exists
    const now = new Date().toISOString();
    const fresh = {
      id: `conv-${Date.now()}-new`,
      title: "New chat",
      created_at: now,
      messages: []
    };
    conversations.unshift(fresh);
    filteredConversations = conversations.slice();

    renderList(filteredConversations);
    selectConversation(0);
  } catch (err) {
    appendSystemMessage(err.message || "Unable to load history.");
  }
}

function init() {
  if (sendEl) {
    sendEl.addEventListener("click", handleSend);
  }

  if (inputEl) {
    inputEl.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    });
  }

  if (selectEl) {
    selectEl.addEventListener("change", event => {
      const idx = parseInt(event.target.value, 10);
      if (!Number.isNaN(idx)) {
        selectConversation(idx);
      }
    });
  }

  if (newChatEl) {
    newChatEl.addEventListener("click", () => {
      createNewConversation();
    });
  }

  if (deleteEl) {
    deleteEl.addEventListener("click", async () => {
      if (activeIndex < 0 || !filteredConversations[activeIndex]) {
        appendSystemMessage("Select a conversation to delete.");
        return;
      }
      const conv = filteredConversations[activeIndex];
      const invoker = resolveInvoker();
      if (!invoker) {
        appendSystemMessage("Bridge unavailable; cannot delete.");
        return;
      }
      try {
        await invoker("history:delete", { id: conv.id });
        conversations = conversations.filter(c => c.id !== conv.id);
        filteredConversations = filteredConversations.filter(c => c.id !== conv.id);
        activeIndex = filteredConversations.length ? 0 : -1;
        renderList(filteredConversations);
        selectConversation(activeIndex);
        appendSystemMessage("Conversation deleted from history.");
      } catch (err) {
        appendSystemMessage(err.message || "Failed to delete conversation.");
      }
    });
  }

  if (promoteEl) {
    promoteEl.addEventListener("click", () => {
      handlePromote();
    });
  }

  loadConversations();
}

init();
