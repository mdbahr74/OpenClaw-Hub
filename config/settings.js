import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsFile = path.join(__dirname, "settings.json");

async function ensureDirectory() {
  await fs.mkdir(__dirname, { recursive: true });
}

export async function loadSettings() {
  try {
    const raw = await fs.readFile(settingsFile, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return {};
    }
    console.error("Error loading settings:", err);
    return {};
  }
}

export async function saveSettings(settings) {
  const safeSettings = settings && typeof settings === "object" ? settings : {};
  await ensureDirectory();
  await fs.writeFile(settingsFile, JSON.stringify(safeSettings, null, 2), "utf8");
  return safeSettings;
}

export async function getOpenAIKey() {
  const settings = await loadSettings();
  return typeof settings.openaiKey === "string" ? settings.openaiKey : null;
}

export async function getChromiumConfig() {
  const settings = await loadSettings();

  // Support both traditional Chromium binary and Flatpak-based Chromium
  // If "chromiumFlatpakId" is set, we'll assume binary=/usr/bin/flatpak and
  // launch via: flatpak run <chromiumFlatpakId> ...
  const isFlatpak = Boolean(settings.chromiumFlatpakId);

  return {
    binary: settings.chromiumBinary || (isFlatpak ? "/usr/bin/flatpak" : "/usr/bin/google-chrome"),
    profile: settings.chromiumProfile || null,
    flatpakId: settings.chromiumFlatpakId || null
  };
}

export async function setOpenAIKey(key) {
  const trimmed = typeof key === "string" ? key.trim() : "";
  const settings = await loadSettings();

  if (trimmed) {
    settings.openaiKey = trimmed;
  } else {
    delete settings.openaiKey;
  }

  await saveSettings(settings);
  return getOpenAIKey();
}
