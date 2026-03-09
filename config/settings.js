import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsFile = path.join(__dirname, "settings.json");
const legacyGoogleOAuthFile = path.join(path.dirname(__dirname), "google_oauth.json");

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

async function loadLegacyGoogleOAuthCredentials() {
  try {
    const raw = await fs.readFile(legacyGoogleOAuthFile, "utf8");
    const parsed = JSON.parse(raw);
    const installed = parsed && typeof parsed === "object" ? parsed.installed : null;
    return installed && typeof installed === "object" ? installed : null;
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("Error loading legacy google_oauth.json:", err);
    }
    return null;
  }
}

export async function getGoogleClientId() {
  const settings = await loadSettings();
  const fromSettings = typeof settings.googleClientId === "string" ? settings.googleClientId.trim() : "";
  const fromEnv = typeof process.env.GOOGLE_CLIENT_ID === "string" ? process.env.GOOGLE_CLIENT_ID.trim() : "";
  const legacy = await loadLegacyGoogleOAuthCredentials();
  const fromLegacy = typeof legacy?.client_id === "string" ? legacy.client_id.trim() : "";
  return fromSettings || fromEnv || fromLegacy || null;
}

export async function getGoogleClientSecret() {
  const settings = await loadSettings();
  const fromSettings = typeof settings.googleClientSecret === "string" ? settings.googleClientSecret.trim() : "";
  const fromEnv = typeof process.env.GOOGLE_CLIENT_SECRET === "string" ? process.env.GOOGLE_CLIENT_SECRET.trim() : "";
  const legacy = await loadLegacyGoogleOAuthCredentials();
  const fromLegacy = typeof legacy?.client_secret === "string" ? legacy.client_secret.trim() : "";
  return fromSettings || fromEnv || fromLegacy || null;
}

export async function setGoogleClientId(clientId) {
  const trimmed = typeof clientId === "string" ? clientId.trim() : "";
  const settings = await loadSettings();

  if (trimmed) {
    settings.googleClientId = trimmed;
  } else {
    delete settings.googleClientId;
  }

  await saveSettings(settings);
  return getGoogleClientId();
}

export async function getGoogleTokens() {
  const settings = await loadSettings();
  return settings.googleTokens && typeof settings.googleTokens === "object"
    ? settings.googleTokens
    : null;
}

export async function setGoogleTokens(tokens) {
  const settings = await loadSettings();

  if (tokens && typeof tokens === "object") {
    settings.googleTokens = tokens;
  } else {
    delete settings.googleTokens;
  }

  await saveSettings(settings);
  return getGoogleTokens();
}

export async function clearGoogleTokens() {
  const settings = await loadSettings();
  delete settings.googleTokens;
  await saveSettings(settings);
  return null;
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
