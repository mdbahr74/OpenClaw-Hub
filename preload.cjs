// === CommandDesk Preload Bridge (CJS) ===
const { contextBridge, ipcRenderer } = require("electron");

// Helper: safely call IPC
async function safeInvoke(channel, data) {
  try {
    const result = await ipcRenderer.invoke(channel, data);
    console.log(`[Preload] ${channel} ->`, result);
    return result;
  } catch (err) {
    console.error(`[Preload] IPC failed: ${channel}`, err);
    return null;
  }
}

// --- Expose bridge to renderer ---
contextBridge.exposeInMainWorld("CommandDeskAPI", {
  // ========== API KEY ==========
  loadAPIKey: () => safeInvoke("loadAPIKey"),
  saveAPIKey: (key) => safeInvoke("saveAPIKey", key),
  removeAPIKey: () => safeInvoke("removeAPIKey"),

  // ========== MEMORY ==========
  loadMemory: () => safeInvoke("loadMemory"),
  saveMemory: (data) => safeInvoke("saveMemory", data),

  // ========== HISTORY ==========
  loadHistory: () => safeInvoke("loadHistory"),
  saveHistory: (data) => safeInvoke("saveHistory", data),

  // ========== PING TEST ==========
  ping: () => safeInvoke("ping"),
});

// Optional: quick preload sanity check
console.log("[Preload] Bridge initialized successfully (CJS).");

// Listen for ping replies (debug only)
ipcRenderer.on("pong", (_event, msg) => {
  console.log("[Preload] Pong received:", msg);
});
