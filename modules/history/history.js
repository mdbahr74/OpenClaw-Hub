const listEl = document.getElementById("conversation-list");
const selectEl = document.getElementById("conversation-select");
const transcriptEl = document.getElementById("transcript");
const titleEl = document.getElementById("conversation-title");
const titleInputEl = document.getElementById("conversation-title-input");
const saveTitleEl = document.getElementById("save-title");
const cancelTitleEl = document.getElementById("cancel-title");
const timeEl = document.getElementById("conversation-time");
const metaEl = document.getElementById("conversation-meta");
const statusEl = document.getElementById("conversation-status");
const attachmentStripEl = document.getElementById("attachment-strip");
const inputEl = document.getElementById("history-input");
const attachExistingFileEl = document.getElementById("attach-existing-file");
const dictateEl = document.getElementById("toggle-dictation");
const autoTtsEl = document.getElementById("toggle-auto-tts");
const sendEl = document.getElementById("history-send");
const agentSelectEl = document.getElementById("agent-select");
const projectSelectEl = document.getElementById("project-select");
const modelRouteEl = document.getElementById("model-route");
const refreshModelRouteEl = document.getElementById("refresh-model-route");
const newChatEl = document.getElementById("new-chat");
const newProjectChatEl = document.getElementById("new-project-chat");
const editTitleEl = document.getElementById("edit-title");
const renameEl = document.getElementById("rename-chat");
const deleteEl = document.getElementById("delete-chat");
const promoteEl = document.getElementById("promote-chat");

let conversations = [];
let filteredConversations = [];
let availableProjects = [];
let availableAgents = [];
let activeIndex = -1;
let pendingBubble = null;
let titleEditActive = false;
let pendingAttachments = [];
let autoSpeakReplies = false;
let dictationActive = false;
let recognition = null;

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
      case "history:update":
        if (bridge.updateChat) return bridge.updateChat(payload);
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
      case "project:list":
        if (bridge.listProjects) return bridge.listProjects(payload);
        break;
      case "agent:list":
        if (bridge.listAgents) return bridge.listAgents(payload);
        break;
      case "chat:pickExistingFile":
        if (bridge.pickExistingFile) return bridge.pickExistingFile(payload);
        break;
      case "openclaw:modelRoute":
        if (bridge.getOpenClawModelRoute) return bridge.getOpenClawModelRoute(payload);
        break;
      case "chat:ttsSynthesize":
        if (bridge.ttsSynthesize) return bridge.ttsSynthesize(payload);
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

async function refreshModelRouteStatus({ probe = true } = {}) {
  const invoker = resolveInvoker();
  if (!modelRouteEl) return;
  if (!invoker) {
    modelRouteEl.textContent = "bridge unavailable";
    return;
  }

  const agentId = agentSelectEl?.value || "main";
  modelRouteEl.textContent = probe ? "checking…" : (modelRouteEl.textContent || "unknown");

  try {
    const [status, route] = await Promise.all([
      invoker("openclaw:connectionStatus", { probe, agentId }),
      invoker("openclaw:modelRoute", { agentId })
    ]);
    const connected = Boolean(status?.connected);
    const primary = route?.primary || "unknown";
    const fallback = route?.fallback || "none";
    const routeText = connected
      ? `${primary} → ${fallback}`
      : `gateway offline · ${primary} → ${fallback}`;
    modelRouteEl.textContent = routeText;
    modelRouteEl.title = [
      `Connected: ${connected ? "yes" : "no"}`,
      `Agent: ${route?.agentId || status?.agentId || agentId}`,
      `Primary: ${primary}`,
      `First fallback: ${fallback}`,
      `Fallback count: ${route?.fallbackCount ?? 0}`,
      `Gateway: ${status?.gatewayUrl || "unknown"}`,
      `Checked: ${status?.checkedAt || "unknown"}`,
      `Last error: ${status?.lastError || "none"}`
    ].join("\n");
  } catch (err) {
    modelRouteEl.textContent = `route check failed: ${err?.message || err}`;
  }
}

function createNewConversation(options = {}) {
  const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const requestedProjectId = typeof options.projectId === "string" ? options.projectId : "";
  const conversation = {
    id,
    title: options.title || "New chat",
    created_at: now,
    updated_at: now,
    agentId: options.agentId || agentSelectEl?.value || "main",
    projectId: requestedProjectId || null,
    projectLabel: options.projectLabel || getProjectLabel(requestedProjectId),
    messages: []
  };

  conversations.unshift(conversation);
  filteredConversations = conversations.slice();
  activeIndex = 0;
  renderList(filteredConversations);
  selectConversation(0);
}

function deriveConversationTitle(conversation, fallbackIndex = 0) {
  const explicit = typeof conversation?.title === "string" ? conversation.title.trim() : "";
  if (explicit && explicit !== "New chat") {
    return explicit;
  }
  const firstUser = Array.isArray(conversation?.messages)
    ? conversation.messages.find(message => message?.role === "user" && typeof message?.content === "string" && message.content.trim())
    : null;
  if (firstUser?.content) {
    const compact = firstUser.content.replace(/\s+/g, " ").trim();
    return compact.length > 48 ? `${compact.slice(0, 45)}...` : compact;
  }
  return explicit || `Conversation ${fallbackIndex + 1}`;
}

async function persistConversationPatch(conversation, patch = {}) {
  const invoker = resolveInvoker();
  if (!invoker || !conversation?.id) return null;
  return invoker("history:update", {
    id: conversation.id,
    patch
  });
}

function setTitleEditMode(enabled) {
  titleEditActive = Boolean(enabled);
  if (titleEl) {
    titleEl.style.display = titleEditActive ? "none" : "";
  }
  if (titleInputEl) {
    titleInputEl.style.display = titleEditActive ? "" : "none";
  }
  if (editTitleEl) {
    editTitleEl.style.display = titleEditActive ? "none" : "";
  }
  if (saveTitleEl) {
    saveTitleEl.style.display = titleEditActive ? "" : "none";
  }
  if (cancelTitleEl) {
    cancelTitleEl.style.display = titleEditActive ? "" : "none";
  }
}

function openRenameDialog() {
  if (activeIndex < 0 || !filteredConversations[activeIndex]) {
    appendSystemMessage("Select a conversation to rename.");
    return;
  }
  const conv = filteredConversations[activeIndex];
  const currentTitle = deriveConversationTitle(conv, activeIndex);
  if (titleInputEl) {
    titleInputEl.value = currentTitle;
    setTitleEditMode(true);
    titleInputEl.focus();
    titleInputEl.select();
  }
}

async function saveEditedTitle() {
  if (activeIndex < 0 || !filteredConversations[activeIndex]) {
    setTitleEditMode(false);
    return;
  }
  const conv = filteredConversations[activeIndex];
  const trimmed = (titleInputEl?.value || "").trim();
  if (!trimmed) {
    appendSystemMessage("Chat title cannot be empty.");
    return;
  }
  const inferredProjectId = inferProjectIdFromText(trimmed);
  const previousProjectId = conv.projectId || null;
  conv.title = trimmed;
  if (inferredProjectId && inferredProjectId !== conv.projectId) {
    conv.projectId = inferredProjectId;
    conv.projectLabel = getProjectLabel(inferredProjectId);
    if (!conv.messages?.length || conv.agentId === "main" || conv.agentId === getProjectDefaultAgent(previousProjectId)) {
      conv.agentId = getProjectDefaultAgent(inferredProjectId);
    }
  }
  conv.updated_at = new Date().toISOString();
  try {
    await persistConversationPatch(conv, {
      title: trimmed,
      projectId: conv.projectId,
      projectLabel: conv.projectLabel,
      agentId: conv.agentId,
      updated_at: conv.updated_at
    });
    setTitleEditMode(false);
    renderList(filteredConversations);
    selectConversation(activeIndex);
    if (inferredProjectId && inferredProjectId !== previousProjectId) {
      appendSystemMessage(`Project auto-switched to ${conv.projectLabel || conv.projectId} based on the chat title.`);
    }
  } catch (err) {
    appendSystemMessage(err.message || "Failed to rename conversation.");
  }
}

function renderAgentOptions(selectedAgentId = "main") {
  if (!agentSelectEl) return;
  const current = typeof selectedAgentId === "string" && selectedAgentId ? selectedAgentId : "main";
  agentSelectEl.innerHTML = "";

  (availableAgents.length ? availableAgents : [{ id: "main", label: "Hex / Main", configured: true }]).forEach(agent => {
    const opt = document.createElement("option");
    opt.value = agent.id;
    const status = agent.configured ? "" : " (setup soon)";
    opt.textContent = `${agent.label || agent.id}${status}`;
    if (agent.id === current) {
      opt.selected = true;
    }
    agentSelectEl.appendChild(opt);
  });

  if (![...agentSelectEl.options].some(option => option.value === current)) {
    const fallback = document.createElement("option");
    fallback.value = current;
    fallback.textContent = current;
    fallback.selected = true;
    agentSelectEl.appendChild(fallback);
  }

  agentSelectEl.value = current;
}

function renderProjectOptions(selectedProjectId = "") {
  if (!projectSelectEl) return;
  const current = typeof selectedProjectId === "string" ? selectedProjectId : "";
  projectSelectEl.innerHTML = "";

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "No project";
  projectSelectEl.appendChild(empty);

  availableProjects.forEach(project => {
    const opt = document.createElement("option");
    opt.value = project.id;
    opt.textContent = project.label || project.id;
    if (project.id === current) {
      opt.selected = true;
    }
    projectSelectEl.appendChild(opt);
  });

  projectSelectEl.value = current;
}

function getProjectLabel(projectId) {
  if (!projectId) return null;
  const match = availableProjects.find(project => project.id === projectId);
  return match?.label || projectId;
}

function getProjectDefaultAgent(projectId) {
  if (!projectId) return "main";
  const match = availableProjects.find(project => project.id === projectId);
  return match?.agentId || "main";
}

function inferProjectIdFromText(text) {
  const value = String(text || "").toLowerCase();
  if (!value) return null;
  if (value.includes("custody") || value.includes("court") || value.includes("legal") || value.includes("motion") || value.includes("anton")) {
    return "court";
  }
  if (value.includes("trade") || value.includes("trading") || value.includes("crypto") || value.includes("btc") || value.includes("pine")) {
    return "trading";
  }
  if (value.includes("code") || value.includes("coding") || value.includes("dev") || value.includes("app") || value.includes("project")) {
    return "coding";
  }
  return null;
}

async function loadProjects() {
  const invoker = resolveInvoker();
  if (!invoker) return;
  try {
    const projects = await invoker("project:list");
    availableProjects = Array.isArray(projects) ? projects : [];
    const currentConversation = activeIndex >= 0 ? filteredConversations[activeIndex] : null;
    renderProjectOptions(currentConversation?.projectId || "");
    if (newProjectChatEl) {
      newProjectChatEl.disabled = !availableProjects.length;
    }
  } catch (err) {
    console.warn("Unable to load project list", err);
  }
}

async function loadAgents() {
  const invoker = resolveInvoker();
  if (!invoker) return;
  try {
    const agents = await invoker("agent:list");
    availableAgents = Array.isArray(agents) ? agents : [];
    const currentConversation = activeIndex >= 0 ? filteredConversations[activeIndex] : null;
    renderAgentOptions(currentConversation?.agentId || "main");
  } catch (err) {
    console.warn("Unable to load agent list", err);
  }
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
    const title = deriveConversationTitle(conversation, index);
    const projectSuffix = conversation.projectLabel || conversation.projectId ? ` · ${conversation.projectLabel || conversation.projectId}` : "";
    opt.textContent = `${title}${projectSuffix}`;
    if (index === activeIndex) {
      opt.selected = true;
    }
    selectEl.appendChild(opt);
  });
}

function renderPendingAttachments() {
  if (!attachmentStripEl) return;
  const items = Array.isArray(pendingAttachments) ? pendingAttachments : [];
  attachmentStripEl.innerHTML = "";
  attachmentStripEl.style.display = items.length ? "flex" : "none";
  if (!items.length) return;

  items.forEach((item, index) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = `File: ${item.name || item.filePath || `attachment ${index + 1}`}`;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.style.marginLeft = "8px";
    removeBtn.style.background = "transparent";
    removeBtn.style.border = "none";
    removeBtn.style.color = "inherit";
    removeBtn.style.cursor = "pointer";
    removeBtn.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
      renderPendingAttachments();
    });

    pill.appendChild(removeBtn);
    attachmentStripEl.appendChild(pill);
  });
}

function stopSpeaking() {
  try {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } catch (err) {
    console.warn("Failed to stop speech", err);
  }
}

function speakText(text) {
  const content = typeof text === "string" ? text.trim() : "";
  if (!content) return;
  if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
    appendSystemMessage("Text-to-speech is not available in this runtime.");
    return;
  }

  try {
    stopSpeaking();
    const utterance = new window.SpeechSynthesisUtterance(content);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn("Failed to speak text", err);
    appendSystemMessage("Could not start text-to-speech.");
  }
}

function updateVoiceControls() {
  if (autoTtsEl) {
    autoTtsEl.textContent = autoSpeakReplies ? "🔊 Auto voice on" : "🔊 Auto voice off";
  }
  if (dictateEl) {
    dictateEl.textContent = dictationActive ? "🛑 Stop dictation" : "🎤 Dictate";
  }
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function toggleDictation() {
  const SpeechRecognitionCtor = getSpeechRecognitionCtor();
  if (!SpeechRecognitionCtor) {
    appendSystemMessage("Voice dictation is not available in this runtime yet.");
    return;
  }

  if (dictationActive && recognition) {
    recognition.stop();
    return;
  }

  recognition = new SpeechRecognitionCtor();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    dictationActive = true;
    updateVoiceControls();
  };

  recognition.onend = () => {
    dictationActive = false;
    updateVoiceControls();
  };

  recognition.onerror = event => {
    dictationActive = false;
    updateVoiceControls();
    appendSystemMessage(`Voice dictation error: ${event?.error || "unknown error"}`);
  };

  recognition.onresult = event => {
    const transcript = Array.from(event.results || [])
      .map(result => result?.[0]?.transcript || "")
      .join(" ")
      .trim();
    if (!transcript) return;
    inputEl.value = transcript;
    inputEl.focus();
  };

  recognition.start();
}

async function generateVoiceForMessage(message, row, button) {
  const invoker = resolveInvoker();
  if (!invoker) {
    appendSystemMessage("Bridge unavailable; cannot generate voice.");
    return;
  }

  const originalLabel = button?.textContent || "🎧 Generate voice";
  if (button) {
    button.disabled = true;
    button.textContent = "Generating…";
  }

  try {
    const result = await invoker("chat:ttsSynthesize", {
      text: message.content,
      voice: "en-US-MichelleNeural"
    });

    const existing = row.querySelector("audio");
    if (existing) {
      existing.remove();
    }

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = `file://${result.filePath}`;
    audio.style.maxWidth = "360px";
    row.appendChild(audio);
    try {
      await audio.play();
    } catch {
      // ignore autoplay failures
    }

    if (button) {
      button.textContent = "🎧 Regenerate voice";
      button.disabled = false;
    }
  } catch (err) {
    if (button) {
      button.textContent = originalLabel;
      button.disabled = false;
    }
    appendSystemMessage(err?.message || "Voice generation failed.");
  }
}

function buildMessageBubble(message) {
  const row = document.createElement("div");
  row.className = `bubble-row ${message.role}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${message.role}`;
  renderRichText(bubble, message.content);
  row.appendChild(bubble);

  if (message.role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "bubble-actions";

    const speakBtn = document.createElement("button");
    speakBtn.className = "bubble-action";
    speakBtn.textContent = "🔊 Speak";
    speakBtn.addEventListener("click", () => speakText(message.content));
    actions.appendChild(speakBtn);

    const voiceBtn = document.createElement("button");
    voiceBtn.className = "bubble-action";
    voiceBtn.textContent = "🎧 Generate voice";
    voiceBtn.addEventListener("click", () => {
      generateVoiceForMessage(message, row, voiceBtn);
    });
    actions.appendChild(voiceBtn);

    const stopBtn = document.createElement("button");
    stopBtn.className = "bubble-action";
    stopBtn.textContent = "⏹ Stop";
    stopBtn.addEventListener("click", () => stopSpeaking());
    actions.appendChild(stopBtn);

    row.appendChild(actions);
  }

  return row;
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
    transcriptEl.appendChild(buildMessageBubble(message));
  });

  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function selectConversation(index) {
  activeIndex = index;
  const conversation = filteredConversations[index];

  titleEl.textContent = conversation ? deriveConversationTitle(conversation, index) : "Conversation";
  if (!titleEditActive && titleInputEl) {
    titleInputEl.value = conversation ? deriveConversationTitle(conversation, index) : "";
  }
  timeEl.textContent = formatDate(conversation?.updated_at || conversation?.created_at);
  if (statusEl) {
    statusEl.innerHTML = "";
  }

  if (conversation) {
    if (statusEl) {
      const countPill = document.createElement("span");
      countPill.className = "pill";
      countPill.textContent = `${conversation.messages?.length || 0} messages`;
      statusEl.appendChild(countPill);

      const agentPill = document.createElement("span");
      agentPill.className = "pill";
      agentPill.textContent = `Agent: ${conversation.agentId || "main"}`;
      statusEl.appendChild(agentPill);

      if (conversation.projectLabel || conversation.projectId) {
        const projectPill = document.createElement("span");
        projectPill.className = "pill";
        projectPill.textContent = `Project: ${conversation.projectLabel || conversation.projectId}`;
        statusEl.appendChild(projectPill);
      }
    }

    renderAgentOptions(conversation.agentId || "main");
    renderProjectOptions(conversation.projectId || "");
  } else {
    renderAgentOptions("main");
    renderProjectOptions("");
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

  const userBubble = buildMessageBubble({ role: "user", content: text });
  transcriptEl.appendChild(userBubble);

  pendingBubble = document.createElement("div");
  pendingBubble.className = "bubble assistant pending";
  renderRichText(pendingBubble, "Thinking…");

  const pendingRow = document.createElement("div");
  pendingRow.className = "bubble-row assistant";
  pendingRow.appendChild(pendingBubble);
  transcriptEl.appendChild(pendingRow);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;

  inputEl.value = "";

  const invoker = resolveInvoker();
  if (!invoker) {
    finalizeAssistantBubble("Bridge unavailable. Try again later.");
    return;
  }

  try {
    const attachmentContext = pendingAttachments.length
      ? pendingAttachments.map(item => `${item.name || item.filePath}: ${item.filePath}`).join("\n")
      : "";

    const payload = {
      text,
      conversationId: conversation.id || conversation.conversationId || null,
      agentId: currentAgentId,
      title: conversation.title,
      projectId: conversation.projectId || null,
      projectLabel: conversation.projectLabel || null,
      attachments: pendingAttachments,
      projectContext: [
        conversation.projectId === "court"
          ? "This is the persistent custody/legal workspace chat. Assume ongoing case continuity and prioritize custody-case context before answering."
          : "",
        attachmentContext ? `Attached workspace files:\n${attachmentContext}` : ""
      ].filter(Boolean).join("\n\n")
    };
    const { reply, error } = await invoker("chat:send", payload);
    if (error) {
      finalizeAssistantBubble(error);
      return;
    }

    finalizeAssistantBubble(reply || "(No response.)");

    const inferredTitle = conversation.title === "New chat"
      ? deriveConversationTitle({ messages: [{ role: "user", content: text }] }, 0)
      : conversation.title;

    conversation.messages = conversation.messages || [];
    const attachmentNote = pendingAttachments.length
      ? `\n\nAttached files for this request:\n${pendingAttachments.map(item => `- ${item.name || item.filePath} (${item.filePath})`).join("\n")}`
      : "";
    conversation.messages.push({ role: "user", content: `${text}${attachmentNote}`.trim() });
    conversation.messages.push({ role: "assistant", content: reply || "" });
    conversation.title = inferredTitle || conversation.title;
    conversation.agentId = currentAgentId;
    conversation.updated_at = new Date().toISOString();
    pendingAttachments = [];
    renderPendingAttachments();

    renderList(filteredConversations);
    selectConversation(activeIndex);
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
      conversation,
      modeId: conversation.projectId || undefined
    });
    appendSystemMessage(`Conversation promoted to ${conversation.projectLabel || conversation.projectId || "project"} notes.`);
  } catch (err) {
    appendSystemMessage(err.message || "Failed to promote conversation.");
  }
}

function finalizeAssistantBubble(message) {
  if (!pendingBubble) return;
  const row = pendingBubble.parentElement;
  pendingBubble.classList.remove("pending");
  pendingBubble.innerHTML = "";
  renderRichText(pendingBubble, message);

  if (row && !row.querySelector(".bubble-actions")) {
    const actions = document.createElement("div");
    actions.className = "bubble-actions";

    const speakBtn = document.createElement("button");
    speakBtn.className = "bubble-action";
    speakBtn.textContent = "🔊 Speak";
    speakBtn.addEventListener("click", () => speakText(message));
    actions.appendChild(speakBtn);

    const voiceBtn = document.createElement("button");
    voiceBtn.className = "bubble-action";
    voiceBtn.textContent = "🎧 Generate voice";
    voiceBtn.addEventListener("click", () => {
      generateVoiceForMessage({ role: "assistant", content: message }, row, voiceBtn);
    });
    actions.appendChild(voiceBtn);

    const stopBtn = document.createElement("button");
    stopBtn.className = "bubble-action";
    stopBtn.textContent = "⏹ Stop";
    stopBtn.addEventListener("click", () => stopSpeaking());
    actions.appendChild(stopBtn);

    row.appendChild(actions);
  }

  pendingBubble = null;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  if (autoSpeakReplies) {
    speakText(message);
  }
}

function appendSystemMessage(message) {
  transcriptEl.appendChild(buildMessageBubble({ role: "assistant", content: message }));
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
    conversations = (Array.isArray(conversations) ? conversations : []).map(conversation => ({
      ...conversation,
      title: typeof conversation?.title === "string" ? conversation.title : "New chat",
      created_at: conversation?.created_at || new Date().toISOString(),
      updated_at: conversation?.updated_at || conversation?.created_at || new Date().toISOString(),
      agentId: conversation?.agentId || "main",
      projectId: conversation?.projectId || null,
      projectLabel: conversation?.projectLabel || null,
      messages: Array.isArray(conversation?.messages) ? conversation.messages : []
    }));
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
      pendingAttachments = [];
      renderPendingAttachments();
      createNewConversation();
    });
  }

  if (newProjectChatEl) {
    newProjectChatEl.addEventListener("click", () => {
      pendingAttachments = [];
      renderPendingAttachments();
      const selectedProjectId = projectSelectEl?.value || (availableProjects[0]?.id || "");
      if (!selectedProjectId) {
        appendSystemMessage("No projects are available yet. Use Promote to project after choosing a project, or add project notes first.");
        return;
      }
      createNewConversation({
        title: `New ${getProjectLabel(selectedProjectId) || selectedProjectId} chat`,
        projectId: selectedProjectId,
        projectLabel: getProjectLabel(selectedProjectId),
        agentId: getProjectDefaultAgent(selectedProjectId)
      });
    });
  }

  if (renameEl) {
    renameEl.addEventListener("click", openRenameDialog);
  }

  if (editTitleEl) {
    editTitleEl.addEventListener("click", openRenameDialog);
  }

  if (saveTitleEl) {
    saveTitleEl.addEventListener("click", saveEditedTitle);
  }

  if (cancelTitleEl) {
    cancelTitleEl.addEventListener("click", () => {
      setTitleEditMode(false);
      if (activeIndex >= 0) {
        selectConversation(activeIndex);
      }
    });
  }

  if (titleInputEl) {
    titleInputEl.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveEditedTitle();
      } else if (event.key === "Escape") {
        event.preventDefault();
        setTitleEditMode(false);
        if (activeIndex >= 0) {
          selectConversation(activeIndex);
        }
      }
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

  if (agentSelectEl) {
    agentSelectEl.addEventListener("change", async event => {
      if (activeIndex < 0 || !filteredConversations[activeIndex]) return;
      const conv = filteredConversations[activeIndex];
      conv.agentId = event.target.value || "main";
      conv.updated_at = new Date().toISOString();
      try {
        await persistConversationPatch(conv, { agentId: conv.agentId, updated_at: conv.updated_at });
        selectConversation(activeIndex);
        refreshModelRouteStatus();
      } catch (err) {
        appendSystemMessage(err.message || "Failed to update chat agent.");
      }
    });
  }

  if (projectSelectEl) {
    projectSelectEl.addEventListener("change", async event => {
      if (activeIndex < 0 || !filteredConversations[activeIndex]) return;
      const conv = filteredConversations[activeIndex];
      conv.projectId = event.target.value || null;
      conv.projectLabel = getProjectLabel(conv.projectId);
      if (!conv.messages?.length || conv.agentId === "main" || !conv.agentId) {
        conv.agentId = getProjectDefaultAgent(conv.projectId);
      }
      conv.updated_at = new Date().toISOString();
      try {
        await persistConversationPatch(conv, {
          projectId: conv.projectId,
          projectLabel: conv.projectLabel,
          agentId: conv.agentId,
          updated_at: conv.updated_at
        });
        renderList(filteredConversations);
        selectConversation(activeIndex);
      } catch (err) {
        appendSystemMessage(err.message || "Failed to update chat project.");
      }
    });
  }

  if (attachExistingFileEl) {
    attachExistingFileEl.addEventListener("click", async () => {
      const invoker = resolveInvoker();
      if (!invoker) {
        appendSystemMessage("Bridge unavailable; cannot attach file.");
        return;
      }
      try {
        const result = await invoker("chat:pickExistingFile", {
          projectId: activeIndex >= 0 && filteredConversations[activeIndex]
            ? filteredConversations[activeIndex].projectId
            : null
        });
        if (result?.filePath) {
          pendingAttachments.push({
            filePath: result.filePath,
            name: result.name || result.filePath.split(/[\\/]/).pop()
          });
          renderPendingAttachments();
        }
      } catch (err) {
        appendSystemMessage(err.message || "Unable to attach existing file.");
      }
    });
  }

  if (dictateEl) {
    dictateEl.addEventListener("click", () => {
      toggleDictation();
    });
  }

  if (autoTtsEl) {
    autoTtsEl.addEventListener("click", () => {
      autoSpeakReplies = !autoSpeakReplies;
      updateVoiceControls();
      if (!autoSpeakReplies) {
        stopSpeaking();
      }
    });
  }

  if (refreshModelRouteEl) {
    refreshModelRouteEl.addEventListener("click", () => {
      refreshModelRouteStatus();
    });
  }

  if (promoteEl) {
    promoteEl.addEventListener("click", () => {
      handlePromote();
    });
  }

  updateVoiceControls();
  refreshModelRouteStatus();
  loadAgents();
  loadProjects();
  loadConversations();
}

init();
