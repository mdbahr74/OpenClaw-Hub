import {
  clearGoogleTokens,
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleTokens,
  setGoogleTokens
} from "./config/settings.js";

const GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3/calendars/primary";
const GOOGLE_DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3";
const GOOGLE_DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_MEMORY_FILE_NAME = "openclaw-hub-memory.json";
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60 * 1000;

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.appdata"
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function toIsoOrNull(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function nowPlusSeconds(seconds) {
  return new Date(Date.now() + Math.max(0, Number(seconds) || 0) * 1000).toISOString();
}

function normalizeTokens(rawTokens, previousTokens = null) {
  const tokens = isPlainObject(rawTokens) ? rawTokens : {};
  const previous = isPlainObject(previousTokens) ? previousTokens : {};
  const idClaims = decodeJwtPayload(tokens.id_token || previous.idToken || previous.id_token);

  const normalized = {
    accessToken: typeof tokens.access_token === "string" && tokens.access_token.trim()
      ? tokens.access_token.trim()
      : (typeof previous.accessToken === "string" ? previous.accessToken : null),
    refreshToken: typeof tokens.refresh_token === "string" && tokens.refresh_token.trim()
      ? tokens.refresh_token.trim()
      : (typeof previous.refreshToken === "string" ? previous.refreshToken : null),
    scope: typeof tokens.scope === "string" && tokens.scope.trim()
      ? tokens.scope.trim()
      : (typeof previous.scope === "string" ? previous.scope : GOOGLE_OAUTH_SCOPES.join(" ")),
    tokenType: typeof tokens.token_type === "string" && tokens.token_type.trim()
      ? tokens.token_type.trim()
      : (typeof previous.tokenType === "string" ? previous.tokenType : "Bearer"),
    expiryDate: tokens.expires_in
      ? nowPlusSeconds(tokens.expires_in)
      : (toIsoOrNull(tokens.expiryDate) || toIsoOrNull(previous.expiryDate)),
    idToken: typeof tokens.id_token === "string" && tokens.id_token.trim()
      ? tokens.id_token.trim()
      : (typeof previous.idToken === "string" ? previous.idToken : null),
    accountEmail: typeof tokens.accountEmail === "string" && tokens.accountEmail.trim()
      ? tokens.accountEmail.trim()
      : (typeof previous.accountEmail === "string" ? previous.accountEmail : null),
    accountName: typeof tokens.accountName === "string" && tokens.accountName.trim()
      ? tokens.accountName.trim()
      : (typeof previous.accountName === "string" ? previous.accountName : null),
    picture: typeof tokens.picture === "string" && tokens.picture.trim()
      ? tokens.picture.trim()
      : (typeof previous.picture === "string" ? previous.picture : null),
    oauthClientId: typeof tokens.oauthClientId === "string" && tokens.oauthClientId.trim()
      ? tokens.oauthClientId.trim()
      : (typeof previous.oauthClientId === "string" ? previous.oauthClientId : null),
    redirectUri: typeof tokens.redirectUri === "string" && tokens.redirectUri.trim()
      ? tokens.redirectUri.trim()
      : (typeof previous.redirectUri === "string" ? previous.redirectUri : null),
    authFlow: typeof tokens.authFlow === "string" && tokens.authFlow.trim()
      ? tokens.authFlow.trim()
      : (typeof previous.authFlow === "string" ? previous.authFlow : null),
    updatedAt: new Date().toISOString()
  };

  if (idClaims?.email && !normalized.accountEmail) {
    normalized.accountEmail = idClaims.email;
  }
  if (idClaims?.name && !normalized.accountName) {
    normalized.accountName = idClaims.name;
  }
  if (idClaims?.picture && !normalized.picture) {
    normalized.picture = idClaims.picture;
  }

  return normalized;
}

function tokenExpiresSoon(tokens) {
  const expiryMs = Date.parse(String(tokens?.expiryDate || ""));
  if (!Number.isFinite(expiryMs)) {
    return true;
  }
  return expiryMs <= Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function createGoogleError({ status = 0, code = "", description = "", payload = null } = {}) {
  const detail = String(description || code || "Unknown Google API error").trim();
  const message = status ? `Google API ${status}: ${detail}` : detail;
  const error = new Error(message);
  error.googleStatus = Number(status) || 0;
  error.googleCode = String(code || "").trim();
  error.googleDescription = detail;
  error.googlePayload = payload;
  return error;
}

async function parseGoogleError(response) {
  const payload = await parseJsonResponse(response);
  const code = typeof payload?.error === "string"
    ? payload.error
    : (typeof payload?.error?.status === "string" ? payload.error.status : "");
  const detail = payload?.error_description
    || payload?.error?.message
    || payload?.raw
    || response.statusText
    || "Unknown Google API error";
  return createGoogleError({
    status: response.status,
    code,
    description: detail,
    payload
  });
}

export function getGoogleUserFacingError(error, { stage = "general" } = {}) {
  const code = String(error?.googleCode || "").toLowerCase();
  const description = String(error?.googleDescription || error?.message || "").toLowerCase();

  if (description.includes("client_secret is missing")) {
    return "Google token exchange still needs a client secret for this desktop credential. Import the full Google OAuth desktop credentials or configure the client secret in the app.";
  }

  if (code === "invalid_client" || description.includes("invalid_client") || description.includes("oauth client was not found")) {
    return "Google could not find that OAuth client ID. Verify the value exactly matches a live Desktop app Client ID ending in .apps.googleusercontent.com.";
  }

  if (
    code === "redirect_uri_mismatch"
    || description.includes("redirect_uri_mismatch")
    || description.includes("redirect uri mismatch")
  ) {
    return "Google rejected the redirect URI. This app uses a localhost loopback callback, so use a Desktop app OAuth client ID. A Web application client is the wrong credential type here.";
  }

  if (
    code === "access_denied"
    || description.includes("access_denied")
    || description.includes("access blocked")
    || description.includes("app is in testing")
    || description.includes("test user")
    || description.includes("not been verified")
  ) {
    return "Google sign-in is blocked for this account. If the OAuth app is still in testing, add your Google account as a test user on the Google OAuth consent screen.";
  }

  if (code === "invalid_grant" || description.includes("invalid_grant")) {
    return stage === "refresh"
      ? "The stored Google sign-in expired or was revoked. Disconnect Google and connect again."
      : "Google rejected the authorization grant. Try Connect Google again. If it keeps failing, recreate the credential as a Desktop app client.";
  }

  if (description.includes("code_verifier") || description.includes("pkce")) {
    return "Google rejected the PKCE verifier. Try Connect Google again. If it keeps failing, restart the app and retry.";
  }

  if (description.includes("client id is not configured")) {
    return "Save a Google OAuth Desktop Client ID in the API tab before connecting Google.";
  }

  if (description.includes("google account is not connected")) {
    return "Connect Google in the API tab before using Gmail, Calendar, or Drive sync.";
  }

  if (description.includes("different oauth client id")) {
    return "The saved Google sign-in belongs to a different OAuth client ID. Disconnect Google and connect again with the current Desktop app client.";
  }

  return error?.message || "Google sign-in failed.";
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw await parseGoogleError(response);
  }

  return await response.json();
}

export async function getGoogleAuthStatus() {
  const [clientId, tokens] = await Promise.all([getGoogleClientId(), getGoogleTokens()]);
  const scopeList = typeof tokens?.scope === "string"
    ? tokens.scope.split(/\s+/).filter(Boolean)
    : [];
  const expiresAt = toIsoOrNull(tokens?.expiryDate);
  const connected = Boolean(tokens?.refreshToken || (tokens?.accessToken && !tokenExpiresSoon(tokens)));

  return {
    configured: Boolean(clientId),
    clientIdConfigured: Boolean(clientId),
    clientId: clientId || "",
    connected,
    memoryBackend: connected ? "local+google-drive-appdata" : "local",
    accountEmail: tokens?.accountEmail || null,
    accountName: tokens?.accountName || null,
    picture: tokens?.picture || null,
    expiresAt,
    scopes: scopeList
  };
}

export async function buildGoogleAuthorizationUrl({ clientId: providedClientId = null, redirectUri, state, codeChallenge }) {
  const clientId = typeof providedClientId === "string" && providedClientId.trim()
    ? providedClientId.trim()
    : await getGoogleClientId();
  if (!clientId) {
    throw new Error("Google OAuth client ID is not configured.");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true"
  });

  return `${GOOGLE_AUTH_BASE_URL}?${params.toString()}`;
}

export async function exchangeGoogleAuthCode({ clientId: providedClientId = null, code, redirectUri, codeVerifier }) {
  const clientId = typeof providedClientId === "string" && providedClientId.trim()
    ? providedClientId.trim()
    : await getGoogleClientId();
  if (!clientId) {
    throw new Error("Google OAuth client ID is not configured.");
  }

  const clientSecret = await getGoogleClientSecret();
  const previousTokens = await getGoogleTokens();
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    throw await parseGoogleError(response);
  }

  const payload = await response.json();
  const normalized = normalizeTokens(payload, previousTokens);
  normalized.oauthClientId = clientId;
  normalized.redirectUri = redirectUri;
  normalized.authFlow = "desktop-pkce";

  if ((!normalized.accountEmail || !normalized.accountName) && normalized.accessToken) {
    try {
      const profile = await fetchGoogleProfile(normalized.accessToken);
      normalized.accountEmail = profile?.email || normalized.accountEmail;
      normalized.accountName = profile?.name || normalized.accountName;
      normalized.picture = profile?.picture || normalized.picture;
    } catch (err) {
      console.warn("[GoogleAPI] Failed to fetch profile after OAuth exchange", err?.message || err);
    }
  }

  await setGoogleTokens(normalized);
  return normalized;
}

export async function refreshGoogleAccessToken(force = false) {
  const clientId = await getGoogleClientId();
  const clientSecret = await getGoogleClientSecret();
  const currentTokens = await getGoogleTokens();

  if (!clientId) {
    throw new Error("Google OAuth client ID is not configured.");
  }

  if (!currentTokens?.refreshToken) {
    throw new Error("Google account is not connected.");
  }

  if (currentTokens?.oauthClientId && currentTokens.oauthClientId !== clientId) {
    await clearGoogleTokens();
    throw createGoogleError({
      code: "stale_client_id",
      description: "Stored Google tokens belong to a different OAuth client ID."
    });
  }

  if (!force && currentTokens.accessToken && !tokenExpiresSoon(currentTokens)) {
    return currentTokens;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: currentTokens.refreshToken,
    grant_type: "refresh_token"
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const error = await parseGoogleError(response);
    if (/invalid_grant/i.test(error.message)) {
      await clearGoogleTokens();
    }
    throw error;
  }

  const payload = await response.json();
  const normalized = normalizeTokens(payload, currentTokens);
  await setGoogleTokens(normalized);
  return normalized;
}

export async function ensureGoogleAccessToken(options = {}) {
  const tokens = await refreshGoogleAccessToken(Boolean(options.forceRefresh));
  if (!tokens?.accessToken) {
    throw new Error("Google access token is unavailable.");
  }
  return tokens.accessToken;
}

export async function disconnectGoogleAccount() {
  const tokens = await getGoogleTokens();
  const revokeToken = tokens?.refreshToken || tokens?.accessToken || null;

  if (revokeToken) {
    try {
      await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ token: revokeToken }).toString()
      });
    } catch (err) {
      console.warn("[GoogleAPI] Token revoke failed", err?.message || err);
    }
  }

  await clearGoogleTokens();
  return getGoogleAuthStatus();
}

async function googleApiFetch(resource, { method = "GET", body = null, headers = {}, retryOnAuth = true } = {}) {
  const accessToken = await ensureGoogleAccessToken();
  const response = await fetch(resource, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers
    },
    body
  });

  if ((response.status === 401 || response.status === 403) && retryOnAuth) {
    const refreshedAccessToken = await ensureGoogleAccessToken({ forceRefresh: true });
    return googleApiFetch(resource, {
      method,
      body,
      retryOnAuth: false,
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshedAccessToken}`
      }
    });
  }

  if (!response.ok) {
    throw await parseGoogleError(response);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  return await response.text();
}

function getHeaderValue(headers, name) {
  const target = String(name || "").toLowerCase();
  const header = Array.isArray(headers)
    ? headers.find(item => String(item?.name || "").toLowerCase() === target)
    : null;
  return header?.value || "";
}

function formatCalendarTime(isoDateTime) {
  const date = new Date(isoDateTime);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatCalendarWhen(rawStart) {
  const dateTime = rawStart?.dateTime || null;
  if (dateTime) {
    const date = new Date(dateTime);
    if (!Number.isFinite(date.getTime())) {
      return "";
    }

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  if (rawStart?.date) {
    const date = new Date(`${rawStart.date}T12:00:00`);
    if (!Number.isFinite(date.getTime())) {
      return rawStart.date;
    }
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric"
    });
  }

  return "";
}

function normalizeCalendarEvent(item) {
  const title = item?.summary || "(untitled event)";
  const isAllDay = Boolean(item?.start?.date && !item?.start?.dateTime);
  return {
    id: item?.id || null,
    title,
    time: isAllDay ? "All day" : formatCalendarTime(item?.start?.dateTime),
    when: formatCalendarWhen(item?.start),
    start: item?.start || null,
    end: item?.end || null,
    htmlLink: item?.htmlLink || null
  };
}

function dateAtLocalTime(date, hours = 0, minutes = 0, seconds = 0, ms = 0) {
  const copy = new Date(date);
  copy.setHours(hours, minutes, seconds, ms);
  return copy;
}

function nextDateString(dateString) {
  const base = new Date(`${dateString}T00:00:00`);
  if (!Number.isFinite(base.getTime())) {
    return dateString;
  }
  base.setDate(base.getDate() + 1);
  return base.toISOString().slice(0, 10);
}

export async function getGmailPrimarySnapshot({ maxMessages = 5 } = {}) {
  const unreadParams = new URLSearchParams({
    q: "category:primary is:unread",
    maxResults: "1"
  });
  const latestParams = new URLSearchParams({
    q: "category:primary",
    maxResults: String(Math.max(1, Number(maxMessages) || 5))
  });

  const [unreadResponse, latestResponse] = await Promise.all([
    googleApiFetch(`${GOOGLE_GMAIL_BASE_URL}/messages?${unreadParams.toString()}`),
    googleApiFetch(`${GOOGLE_GMAIL_BASE_URL}/messages?${latestParams.toString()}`)
  ]);

  const messageIds = Array.isArray(latestResponse?.messages) ? latestResponse.messages : [];
  const details = await Promise.all(
    messageIds.map(item =>
      googleApiFetch(
        `${GOOGLE_GMAIL_BASE_URL}/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
      )
    )
  );

  return {
    unread: Number(unreadResponse?.resultSizeEstimate) || 0,
    messages: details.map(message => ({
      id: message?.id || null,
      from: getHeaderValue(message?.payload?.headers, "From"),
      subject: getHeaderValue(message?.payload?.headers, "Subject") || "(no subject)",
      date: getHeaderValue(message?.payload?.headers, "Date") || "",
      snippet: message?.snippet || ""
    }))
  };
}

export async function getCalendarSnapshot({ todayLimit = 10 } = {}) {
  const now = new Date();
  const startOfDay = dateAtLocalTime(now, 0, 0, 0, 0);
  const endOfDay = dateAtLocalTime(now, 23, 59, 59, 999);

  const todayParams = new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(Math.max(1, Number(todayLimit) || 10))
  });

  const upcomingParams = new URLSearchParams({
    timeMin: now.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "1"
  });

  const [todayResponse, upcomingResponse] = await Promise.all([
    googleApiFetch(`${GOOGLE_CALENDAR_BASE_URL}/events?${todayParams.toString()}`),
    googleApiFetch(`${GOOGLE_CALENDAR_BASE_URL}/events?${upcomingParams.toString()}`)
  ]);

  const today = Array.isArray(todayResponse?.items)
    ? todayResponse.items.map(normalizeCalendarEvent)
    : [];
  const upcoming = Array.isArray(upcomingResponse?.items) && upcomingResponse.items.length
    ? normalizeCalendarEvent(upcomingResponse.items[0])
    : null;

  return { today, upcoming };
}

export async function listNextEvents(options = {}) {
  const snapshot = await getCalendarSnapshot(options);
  const events = [];

  if (Array.isArray(snapshot.today)) {
    snapshot.today.forEach(item => {
      events.push({
        title: item.title,
        time: item.when || item.time
      });
    });
  }

  if (snapshot.upcoming && !events.find(item => item.title === snapshot.upcoming.title && item.time === snapshot.upcoming.when)) {
    events.push({
      title: snapshot.upcoming.title,
      time: snapshot.upcoming.when || snapshot.upcoming.time
    });
  }

  return events;
}

export async function addCalendarEvent({ title, date, time = "09:00", durationMinutes = 60, description = "" }) {
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  const trimmedDate = typeof date === "string" ? date.trim() : "";
  const trimmedTime = typeof time === "string" ? time.trim() : "";

  if (!trimmedTitle || !trimmedDate) {
    throw new Error("Event title and date are required.");
  }

  const payload = {
    summary: trimmedTitle
  };

  if (description) {
    payload.description = String(description);
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const maybeStart = trimmedTime ? new Date(`${trimmedDate}T${trimmedTime}:00`) : null;

  if (maybeStart && Number.isFinite(maybeStart.getTime())) {
    const maybeEnd = new Date(maybeStart.getTime() + Math.max(15, Number(durationMinutes) || 60) * 60 * 1000);
    payload.start = {
      dateTime: maybeStart.toISOString(),
      timeZone
    };
    payload.end = {
      dateTime: maybeEnd.toISOString(),
      timeZone
    };
  } else {
    payload.start = { date: trimmedDate };
    payload.end = { date: nextDateString(trimmedDate) };
  }

  const created = await googleApiFetch(`${GOOGLE_CALENDAR_BASE_URL}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return normalizeCalendarEvent(created);
}

async function findGoogleMemoryFile() {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name='${GOOGLE_MEMORY_FILE_NAME.replace(/'/g, "\\'")}' and trashed=false`,
    fields: "files(id,name,modifiedTime)",
    pageSize: "10"
  });

  const response = await googleApiFetch(`${GOOGLE_DRIVE_BASE_URL}/files?${params.toString()}`);
  const files = Array.isArray(response?.files) ? response.files : [];
  return files[0] || null;
}

async function createGoogleMemoryFile() {
  return googleApiFetch(`${GOOGLE_DRIVE_BASE_URL}/files?fields=id,name,modifiedTime`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: GOOGLE_MEMORY_FILE_NAME,
      parents: ["appDataFolder"],
      mimeType: "application/json"
    })
  });
}

export async function loadGoogleMemory() {
  const existingFile = await findGoogleMemoryFile();
  if (!existingFile?.id) {
    return null;
  }

  const payload = await googleApiFetch(
    `${GOOGLE_DRIVE_BASE_URL}/files/${encodeURIComponent(existingFile.id)}?alt=media`
  );

  if (!isPlainObject(payload)) {
    return null;
  }

  return payload;
}

export async function saveGoogleMemory(memoryState) {
  const body = JSON.stringify(isPlainObject(memoryState) ? memoryState : {});
  let file = await findGoogleMemoryFile();

  if (!file?.id) {
    file = await createGoogleMemoryFile();
  }

  const response = await googleApiFetch(
    `${GOOGLE_DRIVE_UPLOAD_URL}/files/${encodeURIComponent(file.id)}?uploadType=media&fields=id,name,modifiedTime`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body
    }
  );

  return {
    id: response?.id || file.id,
    modifiedTime: response?.modifiedTime || file?.modifiedTime || null
  };
}
