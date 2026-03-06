const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, data) => ipcRenderer.invoke(channel, data);

const bridge = {
  invoke(channel, data) {
    return invoke(channel, data);
  },
  exportTranscript(chatId) {
    return invoke("transcript:export", chatId);
  },
  loadChats() {
    return invoke("history:load");
  },
  getOpenAIKey() {
    return invoke("config:getOpenAIKey");
  },
  setOpenAIKey(value) {
    return invoke("config:setOpenAIKey", value);
  },
  chatSend(message) {
    return invoke("chat:send", message);
  },
  memorySave(updates) {
    return invoke("memory:save", updates);
  },
  memoryLoad() {
    return invoke("memory:load");
  },
  promoteConversation(payload) {
    return invoke("project:promoteConversation", payload);
  },
  deleteChat(payload) {
    return invoke("history:delete", payload);
  },
  newsTopStories() {
    return invoke("news:topStories");
  },
  todayNotesList() {
    return invoke("todayNotes:list");
  },
  todayNotesSave(note) {
    return invoke("todayNotes:save", note);
  },
  todayNotesDelete(id) {
    return invoke("todayNotes:delete", { id });
  },
  appsListInstalled(payload) {
    return invoke("apps:listInstalled", payload);
  },
  webappPickFile(payload) {
    return invoke("webapp:pickFile", payload);
  },
  webappReadIconDataUrl(payload) {
    return invoke("webapp:readIconDataUrl", payload);
  },
  webappAddDroppedPath(payload) {
    return invoke("webapp:addDroppedPath", payload);
  },
  alarmGet() {
    return invoke("alarm:get");
  },
  alarmSet(payload) {
    return invoke("alarm:set", payload);
  },
  alarmClear() {
    return invoke("alarm:clear");
  },
  addCalendarEvent(event) {
    return invoke("google:addCalendarEvent", event);
  }
};

const tabsBridge = {
  detachTab(moduleName) {
    return invoke("tab:detach", moduleName);
  }
};

contextBridge.exposeInMainWorld("commandDeskInvoke", invoke);
contextBridge.exposeInMainWorld("commandDeskBridge", bridge);
contextBridge.exposeInMainWorld("electronAPI", bridge);
contextBridge.exposeInMainWorld("api", { invoke });
contextBridge.exposeInMainWorld("tabsAPI", tabsBridge);
