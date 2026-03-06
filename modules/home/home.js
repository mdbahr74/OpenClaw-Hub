console.log("[Home] OpenClaw Hub dashboard loaded", import.meta.url);

/* ─── Element references ─── */
const clockStrip = document.getElementById("clock-strip");
const marketClockStrip = document.getElementById("market-clock-strip");
const openclawStatus = document.getElementById("openclaw-status");
const homeSysStats = document.getElementById("home-sys-stats");
const densityToggle = document.getElementById("density-toggle");
const focusModeToggle = document.getElementById("focus-mode-toggle");
const rightRailToggle = document.getElementById("right-rail-toggle");
const tickerTrack = document.getElementById("ticker-track");
const tickerManageToggle = document.getElementById("ticker-manage-toggle");
const tickerManagePanel = document.getElementById("ticker-manage-panel");
const tickerSymbolInput = document.getElementById("ticker-symbol-input");
const btnAddTicker = document.getElementById("btn-add-ticker");
const btnRemoveTicker = document.getElementById("btn-remove-ticker");
const tickerManageStatus = document.getElementById("ticker-manage-status");
const newsAllList = document.getElementById("news-all-list");
const newsUsList = document.getElementById("news-us-list");
const newsWorldList = document.getElementById("news-world-list");
const newsCryptoList = document.getElementById("news-crypto-list");
const newsFeedStatus = document.getElementById("news-feed-status");
const newsFeedsToggle = document.getElementById("news-feeds-toggle");
const newsFeedsPanel = document.getElementById("news-feeds-panel");
const newsFeedNameInput = document.getElementById("news-feed-name");
const newsFeedUrlInput = document.getElementById("news-feed-url");
const newsFeedSelect = document.getElementById("news-feed-select");
const btnAddNewsFeed = document.getElementById("btn-add-news-feed");
const btnRemoveNewsFeed = document.getElementById("btn-remove-news-feed");
const newsFeedManageStatus = document.getElementById("news-feed-manage-status");
const newsTabButtons = Array.from(document.querySelectorAll("[data-news-tab]"));
const newsPanes = Array.from(document.querySelectorAll(".news-pane"));
const economyStatus = document.getElementById("economy-status");
const economyCalendarList = document.getElementById("economy-calendar-list");
const economyFilterButtons = Array.from(document.querySelectorAll("[data-impact-filter]"));

const weatherLocation = document.getElementById("weather-location");
const weatherTemp = document.getElementById("weather-temp");
const weatherSummary = document.getElementById("weather-summary");
const weatherExtra = document.getElementById("weather-extra");

const gmailUnread = document.getElementById("gmail-unread");
const gmailList = document.getElementById("gmail-list");
const calendarList = document.getElementById("calendar-list");
const calendarNext = document.getElementById("calendar-next");
const webappsList = document.getElementById("webapps-list");
const webappsDock = document.getElementById("webapps-dock");
const webappsCount = document.getElementById("webapps-count");
const webappFilterInput = document.getElementById("webapp-filter");
const webappsManageStatus = document.getElementById("webapp-manage-status");

const noteTitle = document.getElementById("note-title");
const noteBody = document.getElementById("note-body");
const btnSaveNote = document.getElementById("btn-save-note");
const btnNewNote = document.getElementById("btn-new-note");
const noteSaveStatus = document.getElementById("note-save-status");
const savedNotesList = document.getElementById("saved-notes-list");
const alarmDateTimeInput = document.getElementById("alarm-datetime");
const alarmLabelInput = document.getElementById("alarm-label");
const btnSetAlarm = document.getElementById("btn-set-alarm");
const btnClearAlarm = document.getElementById("btn-clear-alarm");
const alarmVolumeToggle = document.getElementById("alarm-volume-toggle");
const alarmStatus = document.getElementById("alarm-status");
const alarmNext = document.getElementById("alarm-next");
let webAppsCache = [];
let newsFeedsCache = [];
let tickerSymbolsCache = [];
let tickerEntryCache = new Map();
let newsTabState = "all";
let economyImpactFilter = "all";
let economyEventsCache = [];
let pendingQuickRemoveAppId = "";
let pendingQuickRemoveLabel = "";
let pendingQuickRemoveTimeout = null;
const QUICK_REMOVE_CONFIRM_WINDOW_MS = 4000;

/* ─── Markets ─── */
const MARKETS = [
  { id: "NY", name: "New York", tz: "America/New_York", open: "09:30", close: "16:00" },
  { id: "LDN", name: "London", tz: "Europe/London", open: "08:00", close: "16:30" },
  { id: "FRK", name: "Frankfurt", tz: "Europe/Berlin", open: "09:00", close: "17:30" },
  { id: "TKO", name: "Tokyo", tz: "Asia/Tokyo", open: "09:00", close: "15:00" },
  { id: "SYD", name: "Sydney", tz: "Australia/Sydney", open: "10:00", close: "16:00" }
];
const HOME_WEATHER_LOCATION = "48225";
const HOME_DENSITY_KEY = "commanddesk:home-density";
const HOME_FOCUS_KEY = "commanddesk:home-focus-mode";
const HOME_RIGHT_RAIL_KEY = "commanddesk:home-right-rail";
const HOME_NEWS_TAB_KEY = "commanddesk:home-news-tab";
const HOME_ECON_FILTER_KEY = "commanddesk:home-econ-filter";
const HOME_ALARM_VOLUME_KEY = "commanddesk:alarm-volume";
const ALARM_VOLUME_STEPS = [0.25, 0.5, 0.75, 1];

/* ─── Bridge resolution ─── */
const bridgeCandidates = [
  () => (typeof window.commandDeskInvoke === "function" ? window.commandDeskInvoke : null),
  () => (window.commandDeskBridge ? wrapObjectBridge(window.commandDeskBridge) : null),
  () => (window.electronAPI ? wrapObjectBridge(window.electronAPI) : null),
  () => (window.api && typeof window.api.invoke === "function" ? window.api.invoke.bind(window.api) : null),
  () => (window.parent && window.parent.api && typeof window.parent.api.invoke === "function" ? window.parent.api.invoke.bind(window.parent.api) : null),
  () => (window.parent && typeof window.parent.commandDeskInvoke === "function" ? window.parent.commandDeskInvoke : null),
  () => (window.parent && window.parent.commandDeskBridge ? wrapObjectBridge(window.parent.commandDeskBridge) : null),
  () => (window.top && window.top.api && typeof window.top.api.invoke === "function" ? window.top.api.invoke.bind(window.top.api) : null),
  () => (window.top && typeof window.top.commandDeskInvoke === "function" ? window.top.commandDeskInvoke : null),
  () => (window.top && window.top.commandDeskBridge ? wrapObjectBridge(window.top.commandDeskBridge) : null)
];

function wrapObjectBridge(bridge) {
  if (!bridge) return null;
  return (channel, payload) => {
    const directChannels = [
      "google:gmailPrimarySnapshot", "google:calendarSnapshot", "google:addCalendarEvent",
      "weather:current",
      "system:stats", "openclaw:connectionStatus",
      "ticker:listSymbols", "ticker:addSymbol", "ticker:removeSymbol", "ticker:quotes",
      "news:topStories", "news:listFeeds", "news:addFeed", "news:removeFeed",
      "economy:calendar",
      "apps:listInstalled",
      "config:listWebApps", "webapp:launch", "config:addWebApp", "config:removeWebApp",
      "config:reorderWebApps", "config:setWebAppPinned", "webapp:openUrl",
      "webapp:saveWindowState",
      "webapp:pickFile", "webapp:readIconDataUrl", "webapp:addDroppedPath",
      "home:listTasks", "todayNotes:list", "todayNotes:save", "todayNotes:delete",
      "alarm:get", "alarm:set", "alarm:clear"
    ];
    if (directChannels.includes(channel)) {
      if (bridge.commandDeskInvoke) return bridge.commandDeskInvoke(channel, payload);
      if (bridge.invoke) return bridge.invoke(channel, payload);
    }
    return Promise.reject(new Error(`Unsupported channel ${channel}`));
  };
}

function resolveInvoker() {
  for (const factory of bridgeCandidates) {
    try {
      const invoker = factory();
      if (typeof invoker === "function") return invoker;
    } catch (err) { console.warn("[home] Bridge resolution failed", err); }
  }
  return null;
}

/* ─── Utility ─── */
function fadeIn(el) {
  el.classList.remove("fade-in");
  void el.offsetWidth;
  el.classList.add("fade-in");
}

function parseTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

function isSessionOpen(now, openStr, closeStr) {
  const { h: oh, m: om } = parseTime(openStr);
  const { h: ch, m: cm } = parseTime(closeStr);
  const open = new Date(now); open.setHours(oh, om, 0, 0);
  const close = new Date(now); close.setHours(ch, cm, 0, 0);
  return now >= open && now <= close;
}

function openExternalUrl(url) {
  if (!url) return;
  const invoker = resolveInvoker();
  if (invoker) {
    void invoker("webapp:openUrl", { url, title: "Browser" }).catch(err => {
      console.warn("[home] external launch failed", err);
      window.open(url, "_blank", "noopener");
    });
    return;
  }
  window.open(url, "_blank", "noopener");
}

function relativeTime(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function toSafeWebAppId(rawValue) {
  return String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toLocalDateTimeInput(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalDateTimeValue(value) {
  const match = String(value || "").trim().match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return NaN;
  const [, year, month, day, hours, minutes, seconds = "0"] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
    0
  );
  return parsed.getTime();
}

function readStoredSetting(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallbackValue;
    return String(raw);
  } catch {
    return fallbackValue;
  }
}

function writeStoredSetting(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Ignore write errors in restricted storage environments.
  }
}

function isEditableElement(node) {
  if (!node || !(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

function validDensity(value) {
  return value === "compact" ? "compact" : "comfortable";
}

function validNewsTab(value) {
  return ["all", "us", "world", "crypto"].includes(value) ? value : "all";
}

function validImpactFilter(value) {
  return ["all", "high", "medium", "low"].includes(value) ? value : "all";
}

function setDensityMode(nextDensity) {
  const density = validDensity(nextDensity);
  document.body.dataset.density = density;
  if (densityToggle) {
    const compact = density === "compact";
    densityToggle.setAttribute("aria-pressed", compact ? "true" : "false");
    densityToggle.textContent = `Density: ${compact ? "Compact" : "Comfortable"}`;
  }
  writeStoredSetting(HOME_DENSITY_KEY, density);
}

function setFocusMode(enabled) {
  const isEnabled = Boolean(enabled);
  document.body.dataset.focus = isEnabled ? "on" : "off";
  if (focusModeToggle) {
    focusModeToggle.setAttribute("aria-pressed", isEnabled ? "true" : "false");
    focusModeToggle.textContent = `Focus: ${isEnabled ? "On" : "Off"}`;
  }
  writeStoredSetting(HOME_FOCUS_KEY, isEnabled ? "on" : "off");
}

function setRightRailCollapsed(collapsed) {
  const isCollapsed = Boolean(collapsed);
  document.body.dataset.rightRail = isCollapsed ? "collapsed" : "open";
  if (rightRailToggle) {
    rightRailToggle.setAttribute("aria-pressed", isCollapsed ? "true" : "false");
    rightRailToggle.textContent = isCollapsed ? "Right Rail: Hidden" : "Right Rail";
  }
  writeStoredSetting(HOME_RIGHT_RAIL_KEY, isCollapsed ? "collapsed" : "open");
}

function setActiveNewsTab(nextTab, { persist = true } = {}) {
  newsTabState = validNewsTab(nextTab);
  newsTabButtons.forEach(btn => {
    const active = btn.dataset.newsTab === newsTabState;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.tabIndex = active ? 0 : -1;
  });
  newsPanes.forEach(pane => {
    pane.classList.toggle("active", pane.id === `news-pane-${newsTabState}`);
  });
  if (persist) {
    writeStoredSetting(HOME_NEWS_TAB_KEY, newsTabState);
  }
}

function setEconomyImpactFilter(nextFilter, { persist = true } = {}) {
  economyImpactFilter = validImpactFilter(nextFilter);
  economyFilterButtons.forEach(btn => {
    const active = btn.dataset.impactFilter === economyImpactFilter;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (persist) {
    writeStoredSetting(HOME_ECON_FILTER_KEY, economyImpactFilter);
  }
}

function focusRegionById(regionId) {
  const target = document.getElementById(regionId);
  if (!target) return;
  target.focus({ preventScroll: false });
}

/* ─── Clock ─── */
function formatClockStrip() {
  try {
    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const timeStr = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (clockStrip) {
      clockStrip.innerHTML = `<div class="clock-date">${dateStr} · ${timeStr}</div>`;
    }
  } catch (err) { console.warn("Clock error", err); }
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return `${Math.round(Number(value))}%`;
}

function setHomeSystemStats(stats) {
  if (!homeSysStats) return;
  const cpu = formatPercent(stats?.cpuPercent);
  const mem = formatPercent(stats?.memory?.percent);
  homeSysStats.textContent = `CPU ${cpu} · MEM ${mem}`;
}

function setOpenClawStatus(status) {
  if (!openclawStatus) return;

  const connected = Boolean(status?.connected);
  const hasError = Boolean(status?.lastError);
  const label = connected ? "OpenClaw: Live" : "OpenClaw: Offline";

  openclawStatus.innerHTML = `<span class="dot"></span> ${escapeHtml(label)}`;
  openclawStatus.className = "status-pill";

  if (connected) {
    openclawStatus.classList.add("live");
  } else if (hasError) {
    openclawStatus.classList.add("offline");
  } else {
    openclawStatus.classList.add("warn");
  }

  const details = [];
  if (status?.gatewayUrl) details.push(status.gatewayUrl);
  if (status?.checkedAt) details.push(`checked ${relativeTime(status.checkedAt)}`);
  if (status?.lastError) details.push(`error: ${status.lastError}`);
  openclawStatus.title = details.join(" | ");
}

async function refreshSystemAndConnectionStatus() {
  const invoker = resolveInvoker();
  if (!invoker) {
    setHomeSystemStats(null);
    setOpenClawStatus({ connected: false, lastError: "Bridge unavailable" });
    return;
  }

  const [statsResult, connectionResult] = await Promise.allSettled([
    invoker("system:stats", null),
    invoker("openclaw:connectionStatus", { probe: true })
  ]);

  if (statsResult.status === "fulfilled") {
    setHomeSystemStats(statsResult.value);
  } else {
    setHomeSystemStats(null);
  }

  if (connectionResult.status === "fulfilled") {
    setOpenClawStatus(connectionResult.value);
  } else {
    setOpenClawStatus({ connected: false, lastError: connectionResult.reason?.message || String(connectionResult.reason) });
  }
}

function attachLayoutAndNavigationHandlers() {
  setDensityMode(readStoredSetting(HOME_DENSITY_KEY, "comfortable"));
  setFocusMode(readStoredSetting(HOME_FOCUS_KEY, "off") === "on");
  setRightRailCollapsed(readStoredSetting(HOME_RIGHT_RAIL_KEY, "open") === "collapsed");
  setActiveNewsTab(readStoredSetting(HOME_NEWS_TAB_KEY, "all"), { persist: false });
  setEconomyImpactFilter(readStoredSetting(HOME_ECON_FILTER_KEY, "all"), { persist: false });

  if (densityToggle) {
    densityToggle.addEventListener("click", () => {
      setDensityMode(document.body.dataset.density === "compact" ? "comfortable" : "compact");
    });
  }

  if (focusModeToggle) {
    focusModeToggle.addEventListener("click", () => {
      setFocusMode(document.body.dataset.focus !== "on");
    });
  }

  if (rightRailToggle) {
    rightRailToggle.addEventListener("click", () => {
      setRightRailCollapsed(document.body.dataset.rightRail !== "collapsed");
    });
  }

  newsTabButtons.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      setActiveNewsTab(btn.dataset.newsTab || "us");
    });
    btn.addEventListener("keydown", event => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (index + direction + newsTabButtons.length) % newsTabButtons.length;
      const nextBtn = newsTabButtons[nextIndex];
      if (!nextBtn) return;
      setActiveNewsTab(nextBtn.dataset.newsTab || "us");
      nextBtn.focus();
    });
  });

  economyFilterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      setEconomyImpactFilter(btn.dataset.impactFilter || "all");
      renderEconomicCalendarRows();
    });
  });

  document.addEventListener("keydown", event => {
    if (isEditableElement(event.target)) {
      return;
    }

    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
      const key = String(event.key || "").toLowerCase();
      if (key === "d") {
        event.preventDefault();
        setDensityMode(document.body.dataset.density === "compact" ? "comfortable" : "compact");
      } else if (key === "f") {
        event.preventDefault();
        setFocusMode(document.body.dataset.focus !== "on");
      } else if (key === "r") {
        event.preventDefault();
        setRightRailCollapsed(document.body.dataset.rightRail !== "collapsed");
      }
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      if (event.key === "1") {
        event.preventDefault();
        const launchSearch = document.getElementById("webapp-filter");
        if (launchSearch) {
          launchSearch.focus();
        } else {
          focusRegionById("launchers-panel");
        }
      } else if (event.key === "2") {
        event.preventDefault();
        focusRegionById("news-panel");
      } else if (event.key === "3") {
        event.preventDefault();
        focusRegionById("notifications-panel");
      }
    }
  });
}

/* ─── Scrolling Ticker Tape ─── */
const DEFAULT_TICKERS = ["BTCUSD", "ETHUSD", "XRPUSD", "SPY", "QQQ"];
const TICKERS_KEY = "commanddesk:tickers-symbols";
const KNOWN_CRYPTO_BASES = new Set([
  "BTC", "ETH", "XRP", "SOL", "DOGE", "ADA", "BNB", "LTC", "BCH",
  "DOT", "AVAX", "LINK", "MATIC", "TRX", "XLM", "XMR", "ETC",
  "ATOM", "UNI", "AAVE", "NEAR", "FIL", "HBAR", "ICP", "SUI", "SHIB"
]);
const TRADINGVIEW_AMEX_SYMBOLS = new Set(["SPY", "GLD", "SLV", "DIA", "IWM", "XLF", "XLE", "XLK"]);
const TRADINGVIEW_NASDAQ_SYMBOLS = new Set(["QQQ", "TQQQ", "SQQQ"]);

function loadTickerSymbolsFromStorage() {
  try {
    const raw = localStorage.getItem(TICKERS_KEY);
    if (!raw) return DEFAULT_TICKERS;
    const list = raw.split(",").map(s => s.trim()).filter(Boolean);
    return list.length ? list : DEFAULT_TICKERS;
  } catch { return DEFAULT_TICKERS; }
}

function saveTickerSymbolsToStorage(symbols) {
  try { localStorage.setItem(TICKERS_KEY, symbols.join(", ")); } catch { }
}

function normalizeTickerInput(rawValue) {
  return String(rawValue || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9.\-/:]/g, "")
    .replace(/[-/]/g, "");
}

function setTickerManageStatus(message, isError = false) {
  if (!tickerManageStatus) return;
  tickerManageStatus.textContent = message || "";
  tickerManageStatus.classList.toggle("error", isError);
}

function isMissingTickerHandlerError(err, channel) {
  const message = String(err?.message || err || "");
  return message.includes(`No handler registered for '${channel}'`);
}

function inferTickerKind(symbol) {
  const normalized = normalizeTickerInput(symbol);
  if (!normalized) return "stock";
  if (normalized.endsWith("USD")) return "crypto";
  return KNOWN_CRYPTO_BASES.has(normalized) ? "crypto" : "stock";
}

function normalizeTradingViewExchange(rawExchange, symbol, kind) {
  const upper = normalizeTickerInput(symbol);
  const resolvedKind = kind === "crypto" || kind === "stock" ? kind : inferTickerKind(upper);
  const exchange = String(rawExchange || "").trim().toUpperCase();

  if (resolvedKind === "crypto") {
    if (["COINBASE", "BINANCE", "KRAKEN", "BITSTAMP", "BYBIT"].includes(exchange)) {
      return exchange;
    }
    return "COINBASE";
  }

  if (exchange === "AMEX" || exchange === "ARCA" || exchange === "NYSEARCA") {
    return "AMEX";
  }
  if (exchange === "NASDAQ" || exchange === "NYSE") {
    return exchange;
  }
  if (TRADINGVIEW_AMEX_SYMBOLS.has(upper)) {
    return "AMEX";
  }
  if (TRADINGVIEW_NASDAQ_SYMBOLS.has(upper)) {
    return "NASDAQ";
  }
  return "NYSE";
}

function setTickerSymbols(nextSymbols, { allowEmpty = false } = {}) {
  const unique = [];
  const seen = new Set();
  nextSymbols.forEach(value => {
    const symbol = normalizeTickerInput(value);
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    unique.push(symbol);
  });

  tickerSymbolsCache = unique.length ? unique : (allowEmpty ? [] : [...DEFAULT_TICKERS]);

  const nextEntries = new Map();
  tickerSymbolsCache.forEach(symbol => {
    const existing = tickerEntryCache.get(symbol);
    const kind = existing?.kind === "crypto" || existing?.kind === "stock"
      ? existing.kind
      : inferTickerKind(symbol);
    const exchange = normalizeTradingViewExchange(existing?.exchange, symbol, kind);
    nextEntries.set(symbol, { symbol, kind, exchange });
  });
  tickerEntryCache = nextEntries;
  saveTickerSymbolsToStorage(tickerSymbolsCache);
}

function applyTickerEntries(entries, options = {}) {
  const normalized = [];
  const seen = new Set();
  (Array.isArray(entries) ? entries : []).forEach(item => {
    const symbol = normalizeTickerInput(item?.symbol || item);
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    const kind = item?.kind === "crypto" || item?.kind === "stock"
      ? item.kind
      : inferTickerKind(symbol);
    const exchange = normalizeTradingViewExchange(item?.exchange, symbol, kind);
    normalized.push({ symbol, kind, exchange });
  });
  tickerEntryCache = new Map(normalized.map(entry => [entry.symbol, entry]));
  setTickerSymbols(normalized.map(entry => entry.symbol), options);
}

function tickerQuotePayload() {
  return tickerSymbolsCache.map(symbol => {
    const entry = tickerEntryCache.get(symbol);
    if (entry) {
      return {
        symbol: entry.symbol,
        kind: entry.kind,
        exchange: entry.exchange
      };
    }
    return { symbol };
  });
}

async function loadTickerSymbols() {
  const invoker = resolveInvoker();
  if (invoker) {
    try {
      const tickers = await invoker("ticker:listSymbols", null);
      if (Array.isArray(tickers)) {
        applyTickerEntries(tickers, { allowEmpty: true });
        return tickerSymbolsCache;
      }
    } catch (err) {
      console.warn("load tickers error", err);
      if (isMissingTickerHandlerError(err, "ticker:listSymbols")) {
        setTickerManageStatus("Restart OpenClaw Hub to enable ticker API", true);
      }
    }
  }

  setTickerSymbols(loadTickerSymbolsFromStorage());
  return tickerSymbolsCache;
}

function tickerToTradingViewUrl(sym) {
  const symbol = normalizeTickerInput(sym);
  const entry = tickerEntryCache.get(symbol);
  const kind = entry?.kind === "crypto" || entry?.kind === "stock"
    ? entry.kind
    : inferTickerKind(symbol);
  const exchange = normalizeTradingViewExchange(entry?.exchange, symbol, kind);
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`${exchange}:${symbol}`)}`;
}

function formatTickerPrice(symbol, price) {
  if (!Number.isFinite(Number(price))) {
    return "--";
  }
  const value = Number(price);
  const isCrypto = String(symbol || "").toUpperCase().endsWith("USD");
  if (value >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (isCrypto && value < 1) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTickerChangePercent(changePercent) {
  if (!Number.isFinite(Number(changePercent))) {
    return "--";
  }
  const value = Number(changePercent);
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function applyTickerQuotes(quotes) {
  const bySymbol = new Map(
    (Array.isArray(quotes) ? quotes : []).map(item => [normalizeTickerInput(item?.symbol), item])
  );

  tickerTrack?.querySelectorAll(".ticker-item").forEach(item => {
    const sym = normalizeTickerInput(item.dataset.sym || "");
    const quote = bySymbol.get(sym);
    const priceEl = item.querySelector(".ticker-price");
    const chgEl = item.querySelector(".ticker-chg");
    if (priceEl) priceEl.textContent = formatTickerPrice(sym, quote?.price);
    if (chgEl) {
      chgEl.classList.remove("pos", "neg");
      chgEl.textContent = formatTickerChangePercent(quote?.changePercent);
      if (Number.isFinite(Number(quote?.changePercent))) {
        if (Number(quote.changePercent) > 0) chgEl.classList.add("pos");
        if (Number(quote.changePercent) < 0) chgEl.classList.add("neg");
      }
    }
  });
}

async function refreshTickerQuotes() {
  const invoker = resolveInvoker();
  if (!invoker || !tickerSymbolsCache.length) return;
  try {
    const result = await invoker("ticker:quotes", { symbols: tickerQuotePayload() });
    applyTickerQuotes(result?.quotes || []);
    if (result?.warnings?.length) {
      setTickerManageStatus(result.warnings.join(" | "), true);
    } else if (tickerManageStatus?.classList.contains("error")) {
      setTickerManageStatus("");
    }
  } catch (err) {
    console.warn("ticker quotes error", err);
    if (isMissingTickerHandlerError(err, "ticker:quotes")) {
      setTickerManageStatus("Restart OpenClaw Hub to enable live quotes", true);
      return;
    }
    setTickerManageStatus(`Quotes unavailable: ${err.message || err}`, true);
  }
}

async function removeTickerSymbol(rawSymbol) {
  const symbol = normalizeTickerInput(rawSymbol);
  if (!symbol) {
    setTickerManageStatus("Enter a symbol", true);
    return;
  }

  const invoker = resolveInvoker();
  if (invoker) {
    try {
      setTickerManageStatus(`Removing ${symbol}…`);
      const list = await invoker("ticker:removeSymbol", { symbol });
      if (Array.isArray(list)) {
        applyTickerEntries(list, { allowEmpty: true });
      } else {
        setTickerSymbols(tickerSymbolsCache.filter(item => item !== symbol), { allowEmpty: true });
      }
      renderTickerTape();
      await refreshTickerQuotes();
      if (tickerSymbolInput && normalizeTickerInput(tickerSymbolInput.value) === symbol) {
        tickerSymbolInput.value = "";
      }
      setTickerManageStatus(`Removed ${symbol}`);
    } catch (err) {
      console.warn("remove ticker error", err);
      if (isMissingTickerHandlerError(err, "ticker:removeSymbol")) {
        setTickerManageStatus("Restart OpenClaw Hub to enable ticker API", true);
        return;
      }
      setTickerManageStatus(`Remove failed: ${err.message || err}`, true);
    }
    return;
  }

  setTickerSymbols(tickerSymbolsCache.filter(item => item !== symbol), { allowEmpty: true });
  renderTickerTape();
  setTickerManageStatus(`Removed ${symbol}`);
}

function renderTickerTape() {
  if (!tickerTrack) return;
  const symbols = [...tickerSymbolsCache];
  if (!symbols.length) {
    tickerTrack.innerHTML = "";
    return;
  }

  // Build items HTML — duplicate for seamless loop
  const buildItems = () => symbols.map(sym => {
    const upper = normalizeTickerInput(sym);
    const entry = tickerEntryCache.get(upper);
    const kind = entry?.kind === "crypto" || entry?.kind === "stock"
      ? entry.kind
      : inferTickerKind(upper);
    const exchange = normalizeTradingViewExchange(entry?.exchange, upper, kind);
    return `<span class="ticker-item" data-sym="${upper}" data-kind="${escapeHtml(kind)}" data-exchange="${escapeHtml(exchange)}" title="Click to open chart | Right-click to remove">
      <span class="ticker-sym">${upper}</span>
      <span class="ticker-price">--</span>
      <span class="ticker-chg">--</span>
    </span><span class="ticker-sep">·</span>`;
  }).join("");

  // Duplicate content for seamless scrolling
  tickerTrack.innerHTML = buildItems() + buildItems();

  // Click handler
  tickerTrack.querySelectorAll(".ticker-item").forEach(item => {
    item.addEventListener("click", () => {
      openExternalUrl(tickerToTradingViewUrl(item.dataset.sym));
    });
    item.addEventListener("contextmenu", event => {
      event.preventDefault();
      void removeTickerSymbol(item.dataset.sym);
    });
  });
}

async function reloadTickerTape() {
  await loadTickerSymbols();
  renderTickerTape();
  await refreshTickerQuotes();
}

function attachTickerHandlers() {
  if (tickerManageToggle && tickerManagePanel) {
    tickerManageToggle.addEventListener("click", () => {
      tickerManagePanel.classList.toggle("open");
      tickerManageToggle.textContent = tickerManagePanel.classList.contains("open") ? "✕ Ticker" : "+ Ticker";
    });
  }

  const addTicker = async () => {
    const symbol = normalizeTickerInput(tickerSymbolInput?.value || "");
    if (!symbol) {
      setTickerManageStatus("Enter a symbol", true);
      return;
    }
    const invoker = resolveInvoker();
    if (invoker) {
      try {
        setTickerManageStatus("Adding…");
        const list = await invoker("ticker:addSymbol", { symbol });
        if (Array.isArray(list)) {
          applyTickerEntries(list, { allowEmpty: true });
        } else {
          setTickerSymbols([...tickerSymbolsCache, symbol], { allowEmpty: true });
        }
        renderTickerTape();
        await refreshTickerQuotes();
        if (tickerSymbolInput) tickerSymbolInput.value = "";
        setTickerManageStatus(`Added ${symbol}`);
      } catch (err) {
        console.warn("add ticker error", err);
        if (isMissingTickerHandlerError(err, "ticker:addSymbol")) {
          setTickerManageStatus("Restart OpenClaw Hub to enable ticker API", true);
          return;
        }
        setTickerManageStatus(`Add failed: ${err.message || err}`, true);
      }
      return;
    }

    setTickerSymbols([...tickerSymbolsCache, symbol], { allowEmpty: true });
    renderTickerTape();
    if (tickerSymbolInput) tickerSymbolInput.value = "";
    setTickerManageStatus(`Added ${symbol}`);
  };

  const removeTicker = async () => {
    const symbol = normalizeTickerInput(tickerSymbolInput?.value || "");
    if (!symbol) {
      setTickerManageStatus("Enter a symbol", true);
      return;
    }
    await removeTickerSymbol(symbol);
  };

  if (btnAddTicker) btnAddTicker.addEventListener("click", addTicker);
  if (btnRemoveTicker) btnRemoveTicker.addEventListener("click", removeTicker);
  if (tickerSymbolInput) {
    tickerSymbolInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        void addTicker();
      }
    });
  }
}

/* ─── Markets ─── */
function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function nextMarketOpen(nowInTz, market) {
  const { h: oh, m: om } = parseTime(market.open);
  const next = new Date(nowInTz);
  const day = next.getDay();
  if (day === 6) {
    next.setDate(next.getDate() + 2);
  } else if (day === 0) {
    next.setDate(next.getDate() + 1);
  } else if (nowInTz >= new Date(nowInTz.getFullYear(), nowInTz.getMonth(), nowInTz.getDate(), parseTime(market.close).h, parseTime(market.close).m, 0, 0)) {
    next.setDate(next.getDate() + 1);
    if (next.getDay() === 6) next.setDate(next.getDate() + 2);
    if (next.getDay() === 0) next.setDate(next.getDate() + 1);
  }
  next.setHours(oh, om, 0, 0);
  return next;
}

function renderMarkets() {
  if (!marketClockStrip) return;
  const now = new Date();
  const chips = [];

  MARKETS.forEach(market => {
    try {
      const nowInTz = new Date(now.toLocaleString("en-US", { timeZone: market.tz }));
      const { h: oh, m: om } = parseTime(market.open);
      const { h: ch, m: cm } = parseTime(market.close);
      const openAt = new Date(nowInTz); openAt.setHours(oh, om, 0, 0);
      const closeAt = new Date(nowInTz); closeAt.setHours(ch, cm, 0, 0);
      const weekday = nowInTz.getDay();

      let status = "closed";
      let action = "opens in";
      let countdownTarget = nextMarketOpen(nowInTz, market);

      if (weekday >= 1 && weekday <= 5 && nowInTz >= openAt && nowInTz <= closeAt) {
        status = "open";
        action = "closes in";
        countdownTarget = closeAt;
      }

      const countdown = formatCountdown(countdownTarget.getTime() - nowInTz.getTime());
      chips.push(
        `<div class="market-chip ${status}"><span class="market-chip-name">${escapeHtml(market.name)}</span><span class="market-chip-state">${status === "open" ? "Open" : "Closed"}</span><span class="market-chip-time">${action} ${countdown}</span></div>`
      );
    } catch {
      chips.push(
        `<div class="market-chip closed"><span class="market-chip-name">${escapeHtml(market.name)}</span><span class="market-chip-state">Closed</span><span class="market-chip-time">opens in --:--:--</span></div>`
      );
    }
  });

  marketClockStrip.innerHTML = chips.join("");
}

function setEconomyStatus(message, mode = "") {
  if (!economyStatus) return;
  economyStatus.innerHTML = `<span class="dot"></span> ${escapeHtml(message || "")}`;
  economyStatus.className = "status-pill";
  if (mode === "live") {
    economyStatus.classList.add("live");
  }
}

function formatEconomyWhen(isoDate) {
  const ms = Date.parse(String(isoDate || ""));
  if (!Number.isFinite(ms)) {
    return "--";
  }
  const date = new Date(ms);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const day = sameDay
    ? "Today"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

function impactLevel(importance) {
  const numeric = Number(importance);
  if (!Number.isFinite(numeric)) {
    return { label: "Low", className: "", key: "low" };
  }
  if (numeric >= 3) {
    return { label: "High", className: "high", key: "high" };
  }
  if (numeric >= 2) {
    return { label: "Medium", className: "medium", key: "medium" };
  }
  return { label: "Low", className: "", key: "low" };
}

function economyEventUrl(item) {
  const direct = String(item?.url || "").trim();
  if (/^https?:\/\//i.test(direct)) {
    return direct;
  }
  const country = String(item?.country || "").trim();
  const event = String(item?.event || "").trim();
  if (!country && !event) {
    return "";
  }
  return `https://www.tradingeconomics.com/search/?q=${encodeURIComponent(`${country} ${event}`.trim())}`;
}

function renderEconomicCalendarRows() {
  if (!economyCalendarList) return;
  economyCalendarList.innerHTML = "";

  const filtered = economyImpactFilter === "all"
    ? [...economyEventsCache]
    : economyEventsCache.filter(item => impactLevel(item?.importance).key === economyImpactFilter);

  if (!filtered.length) {
    const label = economyImpactFilter === "all"
      ? "No economic events right now"
      : `No ${economyImpactFilter} impact events`;
    economyCalendarList.innerHTML = `<li class="notif-empty">${escapeHtml(label)}</li>`;
    return;
  }

  filtered.slice(0, 12).forEach((item, index) => {
    const row = document.createElement("li");
    const impact = impactLevel(item?.importance);
    const url = economyEventUrl(item);
    row.className = "econ-item fade-in";
    row.style.animationDelay = `${index * 20}ms`;
    row.innerHTML = `
      <span class="econ-when">${escapeHtml(formatEconomyWhen(item?.date))}</span>
      <span class="econ-main">
        <span class="econ-country">${escapeHtml(item?.country || "Global")}</span>
        <a class="econ-event-link" href="${escapeHtml(url || "#")}" ${url ? "" : "aria-disabled=\"true\" tabindex=\"-1\""}>${escapeHtml(item?.event || "Event")}</a>
      </span>
      <span class="econ-impact ${impact.className}">${impact.label}</span>
    `;
    if (url) {
      row.classList.add("clickable");
      row.tabIndex = 0;
      row.setAttribute("role", "link");
      row.title = "Open source";
      const eventLink = row.querySelector(".econ-event-link");
      eventLink?.addEventListener("click", event => {
        event.preventDefault();
        openExternalUrl(url);
      });
      row.addEventListener("dblclick", () => openExternalUrl(url));
      row.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openExternalUrl(url);
        }
      });
    }
    economyCalendarList.appendChild(row);
  });
}

async function renderEconomicCalendar() {
  if (!economyCalendarList) return;
  economyCalendarList.innerHTML = "";
  setEconomyStatus("Loading");

  const invoker = resolveInvoker();
  if (!invoker) {
    economyCalendarList.innerHTML = `<li class="notif-empty">Economic calendar unavailable</li>`;
    setEconomyStatus("Offline");
    return;
  }

  try {
    const result = await invoker("economy:calendar", { limit: 14 });
    const events = Array.isArray(result?.events) ? result.events : [];

    if (result?.error) {
      economyCalendarList.innerHTML = `<li class="notif-empty">Error: ${escapeHtml(result.error)}</li>`;
      setEconomyStatus("Offline");
      return;
    }

    if (!events.length) {
      economyEventsCache = [];
      renderEconomicCalendarRows();
      setEconomyStatus("Empty");
      return;
    }

    economyEventsCache = events;
    renderEconomicCalendarRows();

    setEconomyStatus("Live", "live");
  } catch (err) {
    economyEventsCache = [];
    economyCalendarList.innerHTML = `<li class="notif-empty">Error: ${escapeHtml(err?.message || String(err))}</li>`;
    setEconomyStatus("Offline");
  }
}

/* ─── News ─── */
async function fetchTopStories() {
  try {
    const invoker = resolveInvoker();
    if (!invoker) return { stories: [], error: "No bridge" };
    if (window.commandDeskBridge?.newsTopStories) return await window.commandDeskBridge.newsTopStories();
    return await invoker("news:topStories", null);
  } catch (err) { return { stories: [], error: err.message || String(err) }; }
}

function classifyStoryBucket(item) {
  const title = String(item?.title || "").toLowerCase();
  const source = String(item?.source || "").toLowerCase();
  const tags = Array.isArray(item?.tags) ? item.tags.join(" ").toLowerCase() : "";
  const body = String(item?.body || "").toLowerCase();
  const url = String(item?.url || "").toLowerCase();
  const haystack = `${title} ${source} ${tags} ${body} ${url}`;

  const cryptoSignals = [
    /\bbitcoin\b/,
    /\beth(?:ereum)?\b/,
    /\bxrp\b/,
    /\bsolana\b/,
    /\bcrypto\b/,
    /\bblockchain\b/,
    /\bstablecoin\b/,
    /\btoken\b/,
    /\bdefi\b/,
    /\bnft\b/,
    /\bcoinbase\b/,
    /\bbinance\b/,
    /\bkraken\b/
  ];
  if (cryptoSignals.some(pattern => pattern.test(haystack))) {
    return "crypto";
  }

  const usSignals = [
    /\bunited states\b/,
    /\bu\.s\./,
    /\busa\b/,
    /\bfederal reserve\b/,
    /\bwall street\b/,
    /\bwashington\b/,
    /\bnasdaq\b/,
    /\bnyse\b/,
    /\bdow\b/,
    /\bs&p\b/,
    /\btreasury\b/,
    /\/us\//
  ];
  if (usSignals.some(pattern => pattern.test(haystack))) {
    return "us";
  }

  return "world";
}

function renderHeadlineList(listEl, stories, emptyText) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!stories.length) {
    listEl.innerHTML = `<li class="notif-empty">${escapeHtml(emptyText)}</li>`;
    return;
  }

  stories.forEach((item, i) => {
    const safeSource = escapeHtml(item?.source || "News");
    const safeTitle = escapeHtml(item?.title || "Untitled");
    const safeTag = escapeHtml((item?.tags?.[0] || "").toUpperCase());
    const li = document.createElement("li");
    li.className = "news-item fade-in";
    li.style.animationDelay = `${i * 25}ms`;
    li.innerHTML = `<span class="news-source">${safeSource}</span><span class="news-title">${safeTitle}</span><span class="news-tag">${safeTag}</span>`;
    if (item.url) li.addEventListener("click", () => openExternalUrl(item.url));
    listEl.appendChild(li);
  });
}

async function renderNews() {
  if (!newsAllList || !newsUsList || !newsWorldList || !newsCryptoList || !newsFeedStatus) return;
  newsAllList.innerHTML = "";
  newsUsList.innerHTML = "";
  newsWorldList.innerHTML = "";
  newsCryptoList.innerHTML = "";
  newsFeedStatus.innerHTML = `<span class="dot"></span> Loading`;
  newsFeedStatus.className = "status-pill";

  const { stories, error } = await fetchTopStories();

  if (error) {
    renderHeadlineList(newsAllList, [], `Error: ${error}`);
    renderHeadlineList(newsUsList, [], `Error: ${error}`);
    renderHeadlineList(newsWorldList, [], "No stories");
    renderHeadlineList(newsCryptoList, [], "No stories");
    newsFeedStatus.innerHTML = `<span class="dot"></span> Offline`;
    return;
  }
  if (!stories || !stories.length) {
    renderHeadlineList(newsAllList, [], "No headlines");
    renderHeadlineList(newsUsList, [], "No US headlines");
    renderHeadlineList(newsWorldList, [], "No world headlines");
    renderHeadlineList(newsCryptoList, [], "No crypto headlines");
    newsFeedStatus.innerHTML = `<span class="dot"></span> Empty`;
    return;
  }

  const usStories = [];
  const worldStories = [];
  const cryptoStories = [];
  stories.forEach(item => {
    const bucket = classifyStoryBucket(item);
    if (bucket === "us") {
      usStories.push(item);
    } else if (bucket === "crypto") {
      cryptoStories.push(item);
    } else {
      worldStories.push(item);
    }
  });

  const usHeadlineCount = 10;
  const worldHeadlineCount = 10;
  const cryptoHeadlineCount = 10;
  const allHeadlineCount = 14;
  const allHeadlines = stories.slice(0, allHeadlineCount);
  const usHeadlines = usStories.slice(0, usHeadlineCount);
  const worldHeadlines = worldStories.slice(0, worldHeadlineCount);
  const cryptoHeadlines = cryptoStories.slice(0, cryptoHeadlineCount);

  if (usHeadlines.length < usHeadlineCount) {
    const needed = usHeadlineCount - usHeadlines.length;
    usHeadlines.push(...worldStories.slice(0, needed));
  }
  if (worldHeadlines.length < worldHeadlineCount) {
    const needed = worldHeadlineCount - worldHeadlines.length;
    worldHeadlines.push(...usStories.slice(0, needed));
  }
  if (cryptoHeadlines.length < cryptoHeadlineCount) {
    const needed = cryptoHeadlineCount - cryptoHeadlines.length;
    const backfill = [...usStories, ...worldStories].slice(0, needed);
    cryptoHeadlines.push(...backfill);
  }

  renderHeadlineList(newsAllList, allHeadlines, "No headlines");
  renderHeadlineList(newsUsList, usHeadlines, "No US headlines");
  renderHeadlineList(newsWorldList, worldHeadlines, "No world headlines");
  renderHeadlineList(newsCryptoList, cryptoHeadlines, "No crypto headlines");

  newsFeedStatus.innerHTML = `<span class="dot"></span> Live`;
  newsFeedStatus.classList.add("live");
  setActiveNewsTab(newsTabState, { persist: false });
}

function setNewsFeedManageStatus(message, isError = false) {
  if (!newsFeedManageStatus) return;
  newsFeedManageStatus.textContent = message || "";
  newsFeedManageStatus.classList.toggle("error", isError);
}

function renderNewsFeedOptions() {
  if (!newsFeedSelect) return;
  if (!newsFeedsCache.length) {
    newsFeedSelect.innerHTML = `<option value="">No RSS feeds configured</option>`;
    newsFeedSelect.disabled = true;
    return;
  }
  newsFeedSelect.disabled = false;
  newsFeedSelect.innerHTML = newsFeedsCache
    .map(feed => `<option value="${escapeHtml(feed.id)}">${escapeHtml(feed.name || feed.id)}</option>`)
    .join("");
}

async function loadNewsFeeds() {
  const invoker = resolveInvoker();
  if (!invoker) return;
  try {
    const feeds = await invoker("news:listFeeds", null);
    newsFeedsCache = Array.isArray(feeds) ? feeds : [];
    renderNewsFeedOptions();
  } catch (err) {
    console.warn("load rss feeds error", err);
    setNewsFeedManageStatus(`RSS unavailable: ${err.message || err}`, true);
  }
}

function attachNewsFeedHandlers() {
  const invoker = resolveInvoker();
  if (!invoker) return;

  if (newsFeedsToggle && newsFeedsPanel) {
    newsFeedsToggle.addEventListener("click", () => {
      const isOpen = newsFeedsPanel.classList.toggle("open");
      newsFeedsToggle.textContent = isOpen ? "✕ RSS" : "RSS";
      if (isOpen) {
        requestAnimationFrame(() => {
          newsFeedsPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
          newsFeedNameInput?.focus({ preventScroll: true });
        });
      }
    });
  }

  if (btnAddNewsFeed) {
    btnAddNewsFeed.addEventListener("click", async () => {
      const name = (newsFeedNameInput?.value || "").trim();
      const rss = (newsFeedUrlInput?.value || "").trim();
      if (!rss) {
        setNewsFeedManageStatus("RSS URL is required", true);
        return;
      }
      try {
        setNewsFeedManageStatus("Saving RSS feed…");
        const feeds = await invoker("news:addFeed", { name, rss });
        newsFeedsCache = Array.isArray(feeds) ? feeds : [];
        renderNewsFeedOptions();
        if (newsFeedNameInput) newsFeedNameInput.value = "";
        if (newsFeedUrlInput) newsFeedUrlInput.value = "";
        setNewsFeedManageStatus("RSS feed saved");
        await renderNews();
      } catch (err) {
        console.warn("add rss feed error", err);
        setNewsFeedManageStatus(`Add failed: ${err.message || err}`, true);
      }
    });
  }

  if (btnRemoveNewsFeed) {
    btnRemoveNewsFeed.addEventListener("click", async () => {
      const id = (newsFeedSelect?.value || "").trim();
      if (!id) {
        setNewsFeedManageStatus("Select a feed to remove", true);
        return;
      }
      try {
        setNewsFeedManageStatus("Removing RSS feed…");
        const feeds = await invoker("news:removeFeed", id);
        newsFeedsCache = Array.isArray(feeds) ? feeds : [];
        renderNewsFeedOptions();
        setNewsFeedManageStatus("RSS feed removed");
        await renderNews();
      } catch (err) {
        console.warn("remove rss feed error", err);
        setNewsFeedManageStatus(`Remove failed: ${err.message || err}`, true);
      }
    });
  }
}

/* ─── Weather ─── */
const weatherForecast = document.getElementById("weather-forecast");

function mapWeatherCodeToEmoji(code) {
  if (code === 0) return "☀️";
  if (code === 1 || code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code >= 45 && code <= 48) return "🌫️";
  if (code >= 51 && code <= 55) return "🌧️";
  if (code >= 56 && code <= 57) return "🌨️";
  if (code >= 61 && code <= 65) return "🌧️";
  if (code >= 66 && code <= 67) return "🌨️";
  if (code >= 71 && code <= 75) return "❄️";
  if (code === 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code >= 85 && code <= 86) return "❄️";
  if (code >= 95 && code <= 99) return "⛈️";
  return "☁️";
}

function renderWeatherPlaceholder() {
  if (weatherTemp) weatherTemp.textContent = "--°";
  if (weatherSummary) weatherSummary.textContent = "Loading weather…";
  if (weatherExtra) weatherExtra.textContent = "";
  if (weatherLocation) weatherLocation.textContent = "Harper Woods, MI";
  if (weatherForecast) weatherForecast.innerHTML = "";
}

function formatNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

async function loadWeatherSnapshot() {
  const invoker = resolveInvoker();
  if (!invoker) {
    renderWeatherPlaceholder();
    if (weatherSummary) weatherSummary.textContent = "Weather unavailable";
    return;
  }

  try {
    const snapshot = await invoker("weather:current", {
      query: HOME_WEATHER_LOCATION,
      label: "Harper Woods, MI 48225"
    });

    const temp = Number(snapshot?.current?.temperatureF);
    const summary = String(snapshot?.current?.summary || "Weather");
    const apparent = Number(snapshot?.current?.apparentF);
    const humidity = Number(snapshot?.current?.humidityPercent);
    const wind = Number(snapshot?.current?.windMph);
    const high = Number(snapshot?.daily?.highF);
    const low = Number(snapshot?.daily?.lowF);
    const precip = Number(snapshot?.current?.precipitationIn);

    if (weatherLocation) {
      weatherLocation.textContent = String(snapshot?.location?.label || "Harper Woods, MI");
      weatherLocation.title = String(snapshot?.location?.resolvedName || "");
    }
    if (weatherTemp) {
      weatherTemp.textContent = Number.isFinite(temp)
        ? `${Math.round(temp)}°`
        : "--°";
    }
    if (weatherSummary) {
      weatherSummary.textContent = summary;
    }
    if (weatherExtra) {
      weatherExtra.textContent = [
        `Feels ${Number.isFinite(apparent) ? `${Math.round(apparent)}°` : "--"}`,
        `H:${Number.isFinite(high) ? `${Math.round(high)}°` : "--"} / L:${Number.isFinite(low) ? `${Math.round(low)}°` : "--"}`,
        `Wind ${Number.isFinite(wind) ? `${formatNumber(wind, 0)} mph` : "--"}`
      ].join(" · ");
    }

    if (weatherForecast && Array.isArray(snapshot?.daily?.forecast)) {
      weatherForecast.innerHTML = "";
      snapshot.daily.forecast.forEach(day => {
        const dateObj = new Date(day.date + "T12:00:00Z"); // approximate noon to avoid timezone shift
        const weekday = dateObj.toLocaleDateString(undefined, { weekday: "short" });
        const icon = mapWeatherCodeToEmoji(day.weatherCode);
        const highT = Number.isFinite(day.highF) ? Math.round(day.highF) : "--";
        const lowT = Number.isFinite(day.lowF) ? Math.round(day.lowF) : "--";

        const div = document.createElement("div");
        div.className = "weather-forecast-day fade-in";
        div.innerHTML = `
          <span class="forecast-day-label">${weekday}</span>
          <span class="forecast-icon">${icon}</span>
          <span class="forecast-temps">
            <span class="forecast-high">${highT}°</span>
            <span class="forecast-low">${lowT}°</span>
          </span>
        `;
        weatherForecast.appendChild(div);
      });
    }

  } catch (err) {
    renderWeatherPlaceholder();
    if (weatherSummary) weatherSummary.textContent = "Weather unavailable";
    if (weatherExtra) weatherExtra.textContent = String(err?.message || err || "");
  }
}

/* ─── Gmail ─── */
async function loadGmailSnapshot() {
  if (!gmailList || !gmailUnread) return;
  gmailList.innerHTML = "";
  const invoker = resolveInvoker();
  if (!invoker) {
    gmailUnread.textContent = "–";
    gmailList.innerHTML = `<li class="notif-empty">Unavailable</li>`;
    return;
  }
  try {
    const snap = await invoker("google:gmailPrimarySnapshot", null);
    const { unread = 0, messages = [] } = snap || {};
    gmailUnread.textContent = unread;
    if (!messages.length) {
      gmailList.innerHTML = `<li class="notif-empty">Inbox clear ✓</li>`;
      return;
    }
    messages.slice(0, 3).forEach(msg => {
      const li = document.createElement("li");
      li.className = "notif-item email fade-in";
      li.innerHTML = `<span class="notif-from">${msg.from || "Unknown"}</span> <span class="notif-subject">— ${msg.subject || "(no subject)"}</span>`;
      gmailList.appendChild(li);
    });
  } catch (err) {
    gmailUnread.textContent = "!";
    gmailList.innerHTML = `<li class="notif-empty">Error: ${err.message || err}</li>`;
  }
}

/* ─── Calendar ─── */
async function loadCalendarSnapshot() {
  if (!calendarList || !calendarNext) return;
  calendarList.innerHTML = "";
  const invoker = resolveInvoker();
  if (!invoker) {
    calendarList.innerHTML = `<li class="notif-empty">Unavailable</li>`;
    calendarNext.textContent = "";
    return;
  }
  try {
    const snap = await invoker("google:calendarSnapshot", null);
    const { today = [], upcoming = null } = snap || {};
    if (!today.length && !upcoming) {
      calendarList.innerHTML = `<li class="notif-empty">No events today</li>`;
    } else {
      today.forEach(ev => {
        const li = document.createElement("li");
        li.className = "notif-item event fade-in";
        li.innerHTML = `<span class="notif-time">${ev.time || ""}</span> ${ev.title || "(untitled)"}`;
        calendarList.appendChild(li);
      });
    }
    calendarNext.textContent = upcoming ? `Next: ${upcoming.when || ""} — ${upcoming.title || "(untitled)"}` : "No upcoming events";
  } catch (err) {
    calendarList.innerHTML = `<li class="notif-empty">Error: ${err.message || err}</li>`;
    calendarNext.textContent = "";
  }
}

/* ─── Add Calendar Event ─── */
function attachAddEventHandlers() {
  const toggleBtn = document.getElementById("btn-toggle-add-event");
  const form = document.getElementById("add-event-form");
  const titleInput = document.getElementById("event-title");
  const dateInput = document.getElementById("event-date");
  const timeInput = document.getElementById("event-time");
  const addBtn = document.getElementById("btn-add-event");
  const status = document.getElementById("event-status");

  if (toggleBtn && form) {
    toggleBtn.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      form.classList.toggle("open");
      toggleBtn.textContent = form.classList.contains("open") ? "✕ Close" : "+ Event";
      // Pre-fill date to today
      if (form.classList.contains("open") && dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split("T")[0];
      }
    });
  }

  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const title = titleInput?.value?.trim();
      const date = dateInput?.value;
      const time = timeInput?.value;
      if (!title) { if (status) status.textContent = "Enter a title"; return; }
      if (!date) { if (status) status.textContent = "Pick a date"; return; }

      try {
        if (status) status.textContent = "Adding…";
        const invoker = resolveInvoker();
        if (invoker) {
          await invoker("google:addCalendarEvent", { title, date, time: time || "09:00" });
        }
        if (status) status.textContent = "✓ Added!";
        if (titleInput) titleInput.value = "";
        setTimeout(() => { if (status?.textContent === "✓ Added!") status.textContent = ""; }, 2000);
        await loadCalendarSnapshot();
      } catch (err) {
        if (status) status.textContent = `Failed: ${err.message || err}`;
      }
    });
  }
}

/* ─── Alarm ─── */
let activeAlarmIso = "";
let activeAlarmTitle = "";
let alarmSoundVolume = 0.5;
let lastAlarmSoundIso = "";
let alarmAudioContext = null;

function normalizeAlarmVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.5;
  }

  let closest = ALARM_VOLUME_STEPS[0];
  let smallestDiff = Infinity;
  ALARM_VOLUME_STEPS.forEach(step => {
    const diff = Math.abs(step - numeric);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closest = step;
    }
  });
  return closest;
}

function formatAlarmVolume(value) {
  return `${Math.round(normalizeAlarmVolume(value) * 100)}%`;
}

function setAlarmVolume(value, { persist = true } = {}) {
  alarmSoundVolume = normalizeAlarmVolume(value);
  const label = formatAlarmVolume(alarmSoundVolume);
  if (alarmVolumeToggle) {
    alarmVolumeToggle.textContent = `Vol ${label}`;
    alarmVolumeToggle.setAttribute("aria-label", `Alarm volume ${label}. Click to cycle.`);
    alarmVolumeToggle.title = `Alarm volume ${label}. Click to cycle.`;
  }
  if (persist) {
    writeStoredSetting(HOME_ALARM_VOLUME_KEY, String(alarmSoundVolume));
  }
}

function ensureAlarmAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }
  if (!alarmAudioContext) {
    alarmAudioContext = new AudioContextCtor();
  }
  return alarmAudioContext;
}

async function primeAlarmAudio() {
  const context = ensureAlarmAudioContext();
  if (!context) {
    return null;
  }
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      return context;
    }
  }
  return context;
}

function scheduleAlarmTone(context, startAt, frequency, duration, peakGain) {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.linearRampToValueAtTime(Math.max(0.0001, peakGain), startAt + 0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}

async function playAlarmSound({ preview = false } = {}) {
  const context = await primeAlarmAudio();
  if (!context) {
    return;
  }

  const pattern = preview ? [740] : [740, 880, 740, 988];
  const duration = preview ? 0.12 : 0.16;
  const spacing = preview ? 0.18 : 0.24;
  const peakGain = (preview ? 0.04 : 0.07) * alarmSoundVolume;
  const startAt = context.currentTime + 0.02;

  pattern.forEach((frequency, index) => {
    scheduleAlarmTone(
      context,
      startAt + index * spacing,
      frequency,
      duration,
      peakGain
    );
  });
}

function cycleAlarmVolume() {
  const currentIndex = ALARM_VOLUME_STEPS.findIndex(step => step === alarmSoundVolume);
  const nextIndex = currentIndex >= 0
    ? (currentIndex + 1) % ALARM_VOLUME_STEPS.length
    : 0;
  setAlarmVolume(ALARM_VOLUME_STEPS[nextIndex]);
  setAlarmStatus(`Alarm volume ${formatAlarmVolume(ALARM_VOLUME_STEPS[nextIndex])}`, "saved");
  setTimeout(() => {
    if (alarmStatus?.textContent?.startsWith("Alarm volume")) {
      setAlarmStatus("");
    }
  }, 1200);
  void playAlarmSound({ preview: true });
}

function formatAlarmWhen(isoDate) {
  const ms = Date.parse(String(isoDate || ""));
  if (!Number.isFinite(ms)) return "--";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatAlarmRemaining(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, "0")}m`;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

function setAlarmStatus(message, mode = "") {
  if (!alarmStatus) return;
  alarmStatus.textContent = message || "";
  alarmStatus.className = "note-status alarm-status";
  if (mode === "saved") alarmStatus.classList.add("saved");
  if (mode === "error") alarmStatus.classList.add("error");
}

function renderAlarmCountdown() {
  if (!alarmNext) return;
  if (!activeAlarmIso) {
    lastAlarmSoundIso = "";
    alarmNext.textContent = "No active alarm";
    return;
  }
  const whenMs = Date.parse(activeAlarmIso);
  if (!Number.isFinite(whenMs)) {
    activeAlarmIso = "";
    activeAlarmTitle = "";
    lastAlarmSoundIso = "";
    alarmNext.textContent = "No active alarm";
    return;
  }
  const remainingMs = whenMs - Date.now();
  if (remainingMs <= 0) {
    if (lastAlarmSoundIso !== activeAlarmIso) {
      lastAlarmSoundIso = activeAlarmIso;
      void playAlarmSound();
    }
    alarmNext.textContent = "Alarm due now";
    return;
  }
  const label = activeAlarmTitle ? `"${activeAlarmTitle}"` : "Alarm";
  alarmNext.textContent = `${label} | ${formatAlarmWhen(activeAlarmIso)} | in ${formatAlarmRemaining(remainingMs)}`;
}

async function refreshAlarmState() {
  const invoker = resolveInvoker();
  if (!invoker) {
    activeAlarmIso = "";
    activeAlarmTitle = "";
    renderAlarmCountdown();
    return;
  }
  try {
    const alarm = await invoker("alarm:get", null);
    const nextAlarmIso = alarm?.whenIso ? String(alarm.whenIso) : "";
    if (nextAlarmIso !== activeAlarmIso) {
      lastAlarmSoundIso = "";
    }
    activeAlarmIso = nextAlarmIso;
    activeAlarmTitle = alarm?.title ? String(alarm.title) : "";
    renderAlarmCountdown();
  } catch (err) {
    console.warn("refresh alarm error", err);
    activeAlarmIso = "";
    activeAlarmTitle = "";
    lastAlarmSoundIso = "";
    renderAlarmCountdown();
  }
}

async function setAlarm() {
  const whenLocal = (alarmDateTimeInput?.value || "").trim();
  const title = (alarmLabelInput?.value || "").trim();
  if (!whenLocal) {
    setAlarmStatus("Pick a date/time", "error");
    return;
  }

  const whenMs = parseLocalDateTimeValue(whenLocal);
  if (!Number.isFinite(whenMs) || whenMs <= Date.now()) {
    setAlarmStatus("Use a future time", "error");
    return;
  }

  const invoker = resolveInvoker();
  if (!invoker) {
    setAlarmStatus("Alarm unavailable", "error");
    return;
  }

  try {
    void primeAlarmAudio();
    setAlarmStatus("Setting...");
    const alarm = await invoker("alarm:set", {
      when: whenLocal,
      whenMs,
      title
    });
    activeAlarmIso = alarm?.whenIso ? String(alarm.whenIso) : "";
    activeAlarmTitle = alarm?.title ? String(alarm.title) : "";
    lastAlarmSoundIso = "";
    if (alarmDateTimeInput) alarmDateTimeInput.value = "";
    if (alarmLabelInput) alarmLabelInput.value = "";
    renderAlarmCountdown();
    setAlarmStatus("Alarm set", "saved");
    setTimeout(() => {
      if (alarmStatus?.textContent === "Alarm set") setAlarmStatus("");
    }, 1800);
  } catch (err) {
    setAlarmStatus(err?.message || "Set failed", "error");
  }
}

async function clearAlarm() {
  const invoker = resolveInvoker();
  if (!invoker) {
    setAlarmStatus("Alarm unavailable", "error");
    return;
  }
  try {
    setAlarmStatus("Clearing...");
    await invoker("alarm:clear", null);
    activeAlarmIso = "";
    activeAlarmTitle = "";
    lastAlarmSoundIso = "";
    renderAlarmCountdown();
    setAlarmStatus("Alarm cleared");
    setTimeout(() => {
      if (alarmStatus?.textContent === "Alarm cleared") setAlarmStatus("");
    }, 1800);
  } catch (err) {
    setAlarmStatus(err?.message || "Clear failed", "error");
  }
}

function attachAlarmHandlers() {
  if (btnSetAlarm) btnSetAlarm.addEventListener("click", setAlarm);
  if (btnClearAlarm) btnClearAlarm.addEventListener("click", clearAlarm);
  if (alarmVolumeToggle) {
    alarmVolumeToggle.addEventListener("click", () => {
      void primeAlarmAudio();
      cycleAlarmVolume();
    });
  }

  [alarmDateTimeInput, alarmLabelInput].forEach(input => {
    if (!input) return;
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        void setAlarm();
      }
    });
  });

  if (alarmDateTimeInput && !alarmDateTimeInput.value) {
    const next = new Date(Date.now() + 10 * 60 * 1000);
    next.setSeconds(0, 0);
    alarmDateTimeInput.value = toLocalDateTimeInput(next);
  }

  setAlarmVolume(readStoredSetting(HOME_ALARM_VOLUME_KEY, "0.5"), { persist: false });
}

/* ─── Web Apps ─── */
function setWebAppsManageStatus(message, isError = false) {
  if (!webappsManageStatus) return;
  webappsManageStatus.textContent = message || "";
  webappsManageStatus.classList.toggle("error", isError);
}

function clearPendingQuickWebAppRemoval({ clearStatus = false } = {}) {
  pendingQuickRemoveAppId = "";
  pendingQuickRemoveLabel = "";
  if (pendingQuickRemoveTimeout) {
    clearTimeout(pendingQuickRemoveTimeout);
    pendingQuickRemoveTimeout = null;
  }

  if (
    clearStatus
    && webappsManageStatus
    && /right-click again within/i.test(String(webappsManageStatus.textContent || ""))
  ) {
    setWebAppsManageStatus("");
  }
}

function markPendingQuickWebAppRemoval(appId, label) {
  clearPendingQuickWebAppRemoval();
  pendingQuickRemoveAppId = String(appId || "").trim();
  pendingQuickRemoveLabel = String(label || "launcher").trim();
  if (!pendingQuickRemoveAppId) return;

  setWebAppsManageStatus(`Right-click again within 4s to remove "${pendingQuickRemoveLabel}"`);

  pendingQuickRemoveTimeout = setTimeout(() => {
    const stillPending = pendingQuickRemoveAppId === appId;
    clearPendingQuickWebAppRemoval({ clearStatus: stillPending });
  }, QUICK_REMOVE_CONFIRM_WINDOW_MS);
}

function refreshRemoveLauncherOptions() {
  const removeSelect = document.getElementById("webapp-remove-select");
  if (!removeSelect) return;

  const apps = Array.isArray(webAppsCache) ? webAppsCache : [];
  const previousValue = String(removeSelect.value || "").trim();

  if (!apps.length) {
    removeSelect.innerHTML = `<option value="">No launchers to remove</option>`;
    removeSelect.disabled = true;
    return;
  }

  removeSelect.disabled = false;
  removeSelect.innerHTML = `<option value="">Select launcher to remove...</option>` + apps
    .map(appItem => {
      const id = String(appItem?.id || "").trim();
      const name = String(appItem?.name || id || "Launcher").trim();
      return `<option value="${escapeHtml(id)}">${escapeHtml(name)} (${escapeHtml(id)})</option>`;
    })
    .join("");

  if (previousValue && apps.some(appItem => appItem?.id === previousValue)) {
    removeSelect.value = previousValue;
  }
}

function normalizeWebAppLaunchType(rawType) {
  const value = String(rawType || "").trim().toLowerCase();
  if (value === "external-url" || value === "internal-url" || value === "app-command" || value === "file-path") {
    return value;
  }
  return "external-url";
}

function launchTypeLabel(launchType) {
  const normalized = normalizeWebAppLaunchType(launchType);
  if (normalized === "internal-url") return "Built-in Window";
  if (normalized === "app-command") return "App Command";
  if (normalized === "file-path") return "File/Shortcut";
  return "External Browser";
}

function launchTypeTargetPlaceholder(launchType) {
  const normalized = normalizeWebAppLaunchType(launchType);
  if (normalized === "internal-url") return "URL (opens in built-in window)";
  if (normalized === "app-command") return "Command (e.g. gnome-screenshot -i)";
  if (normalized === "file-path") return "Path to executable or .desktop/.url file";
  return "URL (opens in your default browser)";
}

function formatWebAppTargetDisplay(appItem) {
  const launchType = normalizeWebAppLaunchType(appItem?.launchType);
  const target = String(appItem?.target || appItem?.url || appItem?.command || appItem?.path || "").trim();
  if (!target) return "";
  if (launchType === "external-url" || launchType === "internal-url") {
    return target.replace(/^https?:\/\//i, "");
  }
  return target;
}

function isImageIconValue(iconValue) {
  const value = String(iconValue || "").trim();
  return /^data:image\//i.test(value) || /^https?:\/\//i.test(value);
}

function createWebAppIconElement(iconValue, { dock = false } = {}) {
  const value = String(iconValue || "").trim();
  if (isImageIconValue(value)) {
    const img = document.createElement("img");
    img.className = "app-icon-image";
    img.src = value;
    img.alt = "";
    img.loading = "lazy";
    return img;
  }

  const span = document.createElement("span");
  span.className = dock ? "dock-icon" : "app-icon";
  span.textContent = value || "🌐";
  return span;
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file selected"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function setWebAppIconPreview(iconPreviewEl, iconValue) {
  if (!iconPreviewEl) return;
  const value = String(iconValue || "").trim();
  iconPreviewEl.innerHTML = "";
  if (!value) {
    iconPreviewEl.textContent = "Icon preview";
    return;
  }

  if (isImageIconValue(value)) {
    const img = document.createElement("img");
    img.src = value;
    img.alt = "";
    iconPreviewEl.appendChild(img);
    const text = document.createElement("span");
    text.textContent = "Image icon loaded";
    iconPreviewEl.appendChild(text);
    return;
  }

  const icon = document.createElement("span");
  icon.textContent = value;
  icon.style.fontSize = "15px";
  const text = document.createElement("span");
  text.textContent = `Emoji/icon: ${value}`;
  iconPreviewEl.appendChild(icon);
  iconPreviewEl.appendChild(text);
}

async function launchWebApp(appId) {
  const invoker = resolveInvoker();
  if (!invoker) return;
  try {
    const result = await invoker("webapp:launch", { id: appId });
    if (result?.engine === "system-default-browser") {
      setWebAppsManageStatus("Opened in default browser");
    } else if (result?.engine === "system-shell-command" || result?.engine === "system-file-launcher") {
      setWebAppsManageStatus("Launcher started");
    } else if (result?.engine === "electron-chromium") {
      setWebAppsManageStatus("Opened in built-in window");
    }
  } catch (err) {
    console.warn("launch webapp error", err);
    setWebAppsManageStatus(`Launch failed: ${err.message || err}`, true);
  }
}

async function setWebAppPinned(appId, pinned) {
  const invoker = resolveInvoker();
  if (!invoker) return;
  try {
    const apps = await invoker("config:setWebAppPinned", { id: appId, pinned });
    webAppsCache = Array.isArray(apps) ? apps : [];
    renderWebApps();
  } catch (err) {
    console.warn("pin webapp error", err);
    setWebAppsManageStatus(`Pin failed: ${err.message || err}`, true);
  }
}

function resolveWebAppIdFromText(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  const apps = Array.isArray(webAppsCache) ? webAppsCache : [];
  const safe = toSafeWebAppId(value);
  const lower = value.toLowerCase();

  const matched = apps.find(appItem => String(appItem?.id || "").trim() === value)
    || apps.find(appItem => String(appItem?.id || "").trim() === safe)
    || apps.find(appItem => String(appItem?.name || "").trim().toLowerCase() === lower)
    || apps.find(appItem => toSafeWebAppId(appItem?.name || "") === safe);

  return matched?.id || safe || value;
}

async function removeWebApp(appIdOrQuery, { quiet = false } = {}) {
  clearPendingQuickWebAppRemoval();
  const invoker = resolveInvoker();
  if (!invoker) return false;
  const query = String(appIdOrQuery || "").trim();
  if (!query) {
    if (!quiet) setWebAppsManageStatus("Select or enter a launcher to remove", true);
    return false;
  }

  const id = resolveWebAppIdFromText(query);
  try {
    if (!quiet) setWebAppsManageStatus("Removing…");
    const apps = await invoker("config:removeWebApp", { id, query });
    webAppsCache = Array.isArray(apps) ? apps : [];
    renderWebApps();
    if (!quiet) setWebAppsManageStatus("Removed");
    return true;
  } catch (err) {
    console.warn("remove webapp error", err);
    setWebAppsManageStatus(`Remove failed: ${err.message || err}`, true);
    return false;
  }
}

function renderWebApps() {
  if (!webappsList) return;

  const apps = Array.isArray(webAppsCache) ? webAppsCache : [];
  const query = (webappFilterInput?.value || "").trim().toLowerCase();
  const filtered = query
    ? apps.filter(appItem => {
      const name = String(appItem?.name || "").toLowerCase();
      const id = String(appItem?.id || "").toLowerCase();
      const target = String(appItem?.target || appItem?.url || appItem?.command || appItem?.path || "").toLowerCase();
      const launchType = String(appItem?.launchType || "").toLowerCase();
      return name.includes(query) || id.includes(query) || target.includes(query) || launchType.includes(query);
    })
    : apps;

  if (webappsCount) {
    webappsCount.textContent = apps.length ? `${filtered.length}/${apps.length}` : "0";
  }

  if (webappsDock) {
    webappsDock.innerHTML = "";
    const pinnedApps = apps.filter(appItem => appItem?.pinned);
    if (!pinnedApps.length) {
      webappsDock.innerHTML = `<div class="dock-empty">Pin apps for quick launch</div>`;
    } else {
      pinnedApps.forEach((appItem, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dock-app fade-in";
        btn.style.animationDelay = `${idx * 20}ms`;
        btn.title = appItem.name || appItem.id || "App";
        btn.appendChild(createWebAppIconElement(appItem.icon, { dock: true }));
        const label = document.createElement("span");
        label.className = "dock-label";
        label.textContent = appItem.name || appItem.id || "App";
        btn.appendChild(label);
        btn.addEventListener("click", () => launchWebApp(appItem.id));
        webappsDock.appendChild(btn);
      });
    }
  }

  webappsList.innerHTML = "";
  if (!apps.length) {
    webappsList.innerHTML = `<div class="notif-empty">No apps configured</div>`;
    refreshRemoveLauncherOptions();
    return;
  }
  if (!filtered.length) {
    webappsList.innerHTML = `<div class="notif-empty">No apps match your search</div>`;
    refreshRemoveLauncherOptions();
    return;
  }

  filtered.forEach((appItem, idx) => {
    const row = document.createElement("div");
    row.className = "launcher-row fade-in";
    row.style.animationDelay = `${idx * 12}ms`;
    row.title = `${appItem.name || appItem.id || "Launcher"} · ${launchTypeLabel(appItem.launchType)} · Right-click to remove`;
    row.setAttribute("role", "button");
    row.tabIndex = 0;

    const nameEl = document.createElement("span");
    nameEl.className = "launcher-name";
    nameEl.textContent = appItem.name || appItem.id || "Launcher";
    row.appendChild(nameEl);

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = `app-pin ${appItem.pinned ? "pinned" : ""}`;
    pinBtn.title = appItem.pinned ? "Unpin from dock" : "Pin to dock";
    pinBtn.textContent = appItem.pinned ? "★" : "☆";
    row.appendChild(pinBtn);

    row.addEventListener("click", () => {
      clearPendingQuickWebAppRemoval({ clearStatus: true });
      launchWebApp(appItem.id);
    });
    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        clearPendingQuickWebAppRemoval({ clearStatus: true });
        launchWebApp(appItem.id);
      }
    });
    pinBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      clearPendingQuickWebAppRemoval({ clearStatus: true });
      setWebAppPinned(appItem.id, !appItem.pinned);
    });
    row.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();

      const id = String(appItem?.id || "").trim();
      if (!id) return;

      const label = appItem.name || id || "this launcher";
      if (pendingQuickRemoveAppId === id) {
        clearPendingQuickWebAppRemoval({ clearStatus: true });
        setWebAppsManageStatus(`Removing "${label}"…`);
        void removeWebApp(id);
        return;
      }

      markPendingQuickWebAppRemoval(id, label);
    });
    webappsList.appendChild(row);
  });

  refreshRemoveLauncherOptions();
}

async function loadWebApps() {
  if (!webappsList) return;
  webAppsCache = [];
  webappsList.innerHTML = `<div class="notif-empty">Loading apps…</div>`;
  const invoker = resolveInvoker();
  if (!invoker) {
    webappsList.innerHTML = `<div class="notif-empty">Apps unavailable</div>`;
    if (webappsDock) webappsDock.innerHTML = `<div class="dock-empty">Bridge unavailable</div>`;
    return;
  }
  try {
    const apps = await invoker("config:listWebApps", null);
    webAppsCache = Array.isArray(apps) ? apps : [];
    renderWebApps();
  } catch (err) {
    if (webappsDock) webappsDock.innerHTML = `<div class="dock-empty">Apps unavailable</div>`;
    webappsList.innerHTML = `<div class="notif-empty">Error: ${err.message || err}</div>`;
  }
}

function attachWebAppsHubHandlers() {
  const toggle = document.getElementById("manage-apps-toggle");
  const panel = document.getElementById("manage-panel");
  const idInput = document.getElementById("webapp-id");
  const nameInput = document.getElementById("webapp-name");
  const targetInput = document.getElementById("webapp-target");
  const launchTypeInput = document.getElementById("webapp-launch-type");
  const iconInput = document.getElementById("webapp-icon");
  const iconPreview = document.getElementById("webapp-icon-preview");
  const dropZone = document.getElementById("webapp-drop-zone");
  const removeSelect = document.getElementById("webapp-remove-select");
  const installedSearchInput = document.getElementById("installed-app-search");
  const installedAppsListEl = document.getElementById("installed-app-list");
  const btnRefreshInstalledApps = document.getElementById("btn-refresh-installed-apps");
  const btnUseInstalledApp = document.getElementById("btn-use-installed-app");
  const btnAddInstalledApp = document.getElementById("btn-add-installed-app");
  const btnPickTarget = document.getElementById("btn-pick-webapp-target");
  const btnPickIcon = document.getElementById("btn-pick-webapp-icon");
  const btnAdd = document.getElementById("btn-add-webapp");
  const btnSaveWindowState = document.getElementById("btn-save-webapp-window");
  const btnRemove = document.getElementById("btn-remove-webapp");

  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      panel.classList.toggle("open");
      toggle.textContent = panel.classList.contains("open") ? "✕ Close" : "⚙ Manage";
      if (panel.classList.contains("open")) {
        refreshRemoveLauncherOptions();
        if (installedAppsListEl && !installedAppsListEl.children.length) {
          void loadInstalledApps();
        }
      }
    });
  }

  const invoker = resolveInvoker();
  if (!invoker) return;

  if (webappFilterInput) {
    webappFilterInput.addEventListener("input", () => renderWebApps());
  }

  if (nameInput && idInput) {
    nameInput.addEventListener("blur", () => {
      if (idInput.value.trim()) return;
      idInput.value = toSafeWebAppId(nameInput.value);
    });
  }

  let installedApps = [];
  let selectedInstalledAppId = "";

  const inferInstalledAppIcon = (item) => {
    const text = `${item?.name || ""} ${item?.desktopId || ""} ${item?.target || ""}`.toLowerCase();
    if (text.includes("screenshot") || text.includes("screen shot")) return "📸";
    if (text.includes("calendar")) return "📅";
    if (text.includes("gmail") || text.includes("mail")) return "📧";
    if (text.includes("chrome") || text.includes("chromium") || text.includes("--app-id=")) return "🌐";
    return "🧩";
  };

  const renderInstalledApps = () => {
    if (!installedAppsListEl) return;
    const query = (installedSearchInput?.value || "").trim().toLowerCase();
    const filtered = query
      ? installedApps.filter(item => {
        const haystack = `${item?.name || ""} ${item?.desktopId || ""} ${item?.target || ""} ${item?.kind || ""}`.toLowerCase();
        return haystack.includes(query);
      })
      : installedApps;

    installedAppsListEl.innerHTML = "";
    if (!filtered.length) {
      installedAppsListEl.innerHTML = `<div class="installed-app-empty">No installed apps found</div>`;
      return;
    }

    filtered.slice(0, 320).forEach(item => {
      const appId = String(item.id || item.desktopId || "").trim();
      const kind = item.kind === "chromium-webapp" ? "Chromium App" : (item.kind === "link" ? "Link" : "App");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `installed-app-item${selectedInstalledAppId === appId ? " active" : ""}`;
      btn.textContent = item.name || item.desktopId || appId;
      btn.title = `${kind} · ${item.target || ""}`;
      btn.addEventListener("click", () => {
        selectedInstalledAppId = appId;
        applyInstalledAppToForm(item);
        renderInstalledApps();
        setWebAppsManageStatus(`Loaded ${item.name || item.desktopId} into form`);
      });
      btn.addEventListener("dblclick", () => {
        selectedInstalledAppId = appId;
        void addSelectedInstalledApp();
      });
      installedAppsListEl.appendChild(btn);
    });
  };

  const loadInstalledApps = async (refresh = false) => {
    if (!installedAppsListEl) return;
    try {
      installedAppsListEl.innerHTML = `<div class="installed-app-empty">Loading installed apps...</div>`;
      const result = await invoker("apps:listInstalled", { refresh, limit: 600 });
      installedApps = Array.isArray(result?.apps) ? result.apps : [];
      if (!installedApps.some(item => String(item.id || item.desktopId || "").trim() === selectedInstalledAppId)) {
        selectedInstalledAppId = "";
      }
      renderInstalledApps();
      setWebAppsManageStatus(installedApps.length ? `Loaded ${installedApps.length} installed apps` : "No installed apps found");
    } catch (err) {
      installedAppsListEl.innerHTML = `<div class="installed-app-empty">Unable to load installed apps</div>`;
      setWebAppsManageStatus(`Installed apps unavailable: ${err.message || err}`, true);
    }
  };

  const getSelectedInstalledApp = () => {
    if (!selectedInstalledAppId) return null;
    return installedApps.find(item => String(item.id || item.desktopId || "").trim() === selectedInstalledAppId) || null;
  };

  const applyInstalledAppToForm = (item) => {
    if (!item) return;
    const id = toSafeWebAppId(item.desktopId || item.name || "");
    if (idInput) idInput.value = id;
    if (nameInput) nameInput.value = item.name || item.desktopId || id;
    if (launchTypeInput) launchTypeInput.value = normalizeWebAppLaunchType(item.launchType || "app-command");
    if (targetInput) targetInput.value = String(item.target || "").trim();
    if (iconInput) iconInput.value = item.icon || inferInstalledAppIcon(item);
    updateTargetPlaceholder();
    updateIconPreview();
  };

  const addSelectedInstalledApp = async () => {
    const selectedApp = getSelectedInstalledApp();
    if (!selectedApp) {
      setWebAppsManageStatus("Select an installed app first", true);
      return;
    }
    try {
      applyInstalledAppToForm(selectedApp);
      const id = toSafeWebAppId((idInput?.value || "").trim() || selectedApp.desktopId || selectedApp.name || "");
      const name = (nameInput?.value || "").trim() || selectedApp.name || selectedApp.desktopId || id;
      const launchType = normalizeWebAppLaunchType(launchTypeInput?.value || selectedApp.launchType || "app-command");
      const target = (targetInput?.value || "").trim() || String(selectedApp.target || "").trim();
      const icon = (iconInput?.value || "").trim() || selectedApp.icon || inferInstalledAppIcon(selectedApp);
      if (!id || !target) {
        setWebAppsManageStatus("Selected app has no launch command/target", true);
        return;
      }

      setWebAppsManageStatus("Adding selected app…");
      const apps = await invoker("config:addWebApp", { id, name, launchType, target, icon });
      webAppsCache = Array.isArray(apps) ? apps : [];
      renderWebApps();
      setWebAppsManageStatus(`Added ${name}`);
    } catch (err) {
      setWebAppsManageStatus(`Add selected failed: ${err.message || err}`, true);
    }
  };

  if (installedSearchInput) {
    installedSearchInput.addEventListener("input", () => renderInstalledApps());
    installedSearchInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        void loadInstalledApps();
      }
    });
  }
  if (btnRefreshInstalledApps) {
    btnRefreshInstalledApps.addEventListener("click", () => {
      void loadInstalledApps(true);
    });
  }
  if (btnUseInstalledApp) {
    btnUseInstalledApp.addEventListener("click", () => {
      const selectedApp = getSelectedInstalledApp();
      if (!selectedApp) {
        setWebAppsManageStatus("Select an installed app first", true);
        return;
      }
      applyInstalledAppToForm(selectedApp);
      setWebAppsManageStatus(`Loaded ${selectedApp.name || selectedApp.desktopId} into form`);
    });
  }
  if (btnAddInstalledApp) {
    btnAddInstalledApp.addEventListener("click", () => {
      void addSelectedInstalledApp();
    });
  }

  const updateTargetPlaceholder = () => {
    if (!targetInput) return;
    const launchType = normalizeWebAppLaunchType(launchTypeInput?.value);
    targetInput.placeholder = launchTypeTargetPlaceholder(launchType);
  };
  if (launchTypeInput) {
    launchTypeInput.addEventListener("change", updateTargetPlaceholder);
  }
  updateTargetPlaceholder();

  const updateIconPreview = () => {
    setWebAppIconPreview(iconPreview, iconInput?.value || "");
  };
  if (iconInput) {
    iconInput.addEventListener("input", updateIconPreview);
    iconInput.addEventListener("dragover", event => {
      event.preventDefault();
      iconInput.style.borderColor = "var(--border-accent)";
    });
    iconInput.addEventListener("dragleave", () => {
      iconInput.style.borderColor = "";
    });
    iconInput.addEventListener("drop", async event => {
      event.preventDefault();
      iconInput.style.borderColor = "";
      const file = event.dataTransfer?.files?.[0];
      if (!file || !String(file.type || "").startsWith("image/")) {
        setWebAppsManageStatus("Drop an image file for icon", true);
        return;
      }
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        iconInput.value = dataUrl;
        updateIconPreview();
        setWebAppsManageStatus("Icon image loaded");
      } catch (err) {
        setWebAppsManageStatus(`Icon drop failed: ${err.message || err}`, true);
      }
    });
  }
  updateIconPreview();

  if (btnPickTarget) {
    btnPickTarget.addEventListener("click", async () => {
      try {
        const picked = await invoker("webapp:pickFile", { purpose: "target" });
        if (!picked?.filePath) return;
        if (targetInput) targetInput.value = picked.filePath;
        if (launchTypeInput) launchTypeInput.value = "file-path";
        updateTargetPlaceholder();
      } catch (err) {
        setWebAppsManageStatus(`Pick failed: ${err.message || err}`, true);
      }
    });
  }

  if (btnPickIcon) {
    btnPickIcon.addEventListener("click", async () => {
      try {
        const picked = await invoker("webapp:pickFile", { purpose: "icon" });
        if (!picked?.filePath) return;
        const iconResult = await invoker("webapp:readIconDataUrl", { filePath: picked.filePath });
        if (iconInput) iconInput.value = String(iconResult?.dataUrl || "");
        updateIconPreview();
      } catch (err) {
        setWebAppsManageStatus(`Icon pick failed: ${err.message || err}`, true);
      }
    });
  }

  if (dropZone) {
    const resolveDroppedFilePath = (event, file) => {
      const direct = String(file?.path || "").trim();
      if (direct) return direct;

      const uriList = String(event?.dataTransfer?.getData("text/uri-list") || "")
        .split(/\r?\n/)
        .map(item => item.trim())
        .find(Boolean);
      if (!uriList || !uriList.startsWith("file://")) {
        return "";
      }
      try {
        const parsed = new URL(uriList);
        let pathname = decodeURIComponent(parsed.pathname || "");
        if (/^\/[A-Za-z]:\//.test(pathname)) {
          pathname = pathname.slice(1);
        }
        return pathname;
      } catch {
        return "";
      }
    };

    const prevent = event => {
      event.preventDefault();
      event.stopPropagation();
    };
    ["dragenter", "dragover"].forEach(type => {
      dropZone.addEventListener(type, event => {
        prevent(event);
        dropZone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(type => {
      dropZone.addEventListener(type, event => {
        prevent(event);
        dropZone.classList.remove("dragover");
      });
    });

    dropZone.addEventListener("drop", async event => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) {
        setWebAppsManageStatus("Drop a shortcut or executable file", true);
        return;
      }

      if (String(file.type || "").startsWith("image/")) {
        if (iconInput) {
          try {
            iconInput.value = await readImageFileAsDataUrl(file);
            updateIconPreview();
            setWebAppsManageStatus("Image dropped into icon field");
          } catch (err) {
            setWebAppsManageStatus(`Image drop failed: ${err.message || err}`, true);
          }
        }
        return;
      }

      const filePath = resolveDroppedFilePath(event, file);
      if (!filePath) {
        setWebAppsManageStatus("Dropped file path is unavailable", true);
        return;
      }

      try {
        setWebAppsManageStatus("Adding dropped launcher…");
        const result = await invoker("webapp:addDroppedPath", { filePath });
        webAppsCache = Array.isArray(result?.apps) ? result.apps : [];
        renderWebApps();
        setWebAppsManageStatus(`Added ${result?.app?.name || "launcher"}`);
      } catch (err) {
        setWebAppsManageStatus(`Drop add failed: ${err.message || err}`, true);
      }
    });
  }

  if (btnAdd) {
    btnAdd.addEventListener("click", async () => {
      const id = toSafeWebAppId((idInput?.value || "").trim() || (nameInput?.value || "").trim());
      const name = (nameInput?.value || "").trim() || id;
      const launchType = normalizeWebAppLaunchType(launchTypeInput?.value);
      const target = (targetInput?.value || "").trim();
      const icon = (iconInput?.value || "").trim();
      if (!id || !target) {
        setWebAppsManageStatus("Need ID/name and target", true);
        return;
      }
      try {
        setWebAppsManageStatus("Saving…");
        const apps = await invoker("config:addWebApp", {
          id,
          name,
          launchType,
          target,
          icon: icon || "🌐"
        });
        webAppsCache = Array.isArray(apps) ? apps : [];
        renderWebApps();
        if (idInput) idInput.value = "";
        if (nameInput) nameInput.value = "";
        if (targetInput) targetInput.value = "";
        if (iconInput) iconInput.value = "";
        updateIconPreview();
        setWebAppsManageStatus("Saved");
      } catch (err) {
        console.warn("add webapp error", err);
        setWebAppsManageStatus(`Add failed: ${err.message || err}`, true);
      }
    });
  }

  if (btnSaveWindowState) {
    btnSaveWindowState.addEventListener("click", async () => {
      const id = resolveWebAppIdFromText((removeSelect?.value || "").trim() || (idInput?.value || "").trim() || (nameInput?.value || "").trim());
      if (!id) {
        setWebAppsManageStatus("Select a launcher to save window state", true);
        return;
      }
      try {
        setWebAppsManageStatus("Saving window state…");
        const result = await invoker("webapp:saveWindowState", { id });
        const bounds = result?.snapshot?.bounds || null;
        if (bounds && Number.isFinite(Number(bounds.width)) && Number.isFinite(Number(bounds.height))) {
          const x = Number.isFinite(Number(bounds.x)) ? Number(bounds.x) : 0;
          const y = Number.isFinite(Number(bounds.y)) ? Number(bounds.y) : 0;
          setWebAppsManageStatus(`Saved ${Math.round(Number(bounds.width))}x${Math.round(Number(bounds.height))} at ${Math.round(x)},${Math.round(y)}`);
        } else {
          setWebAppsManageStatus("Saved window state");
        }
      } catch (err) {
        setWebAppsManageStatus(`Save window failed: ${err.message || err}`, true);
      }
    });
  }

  if (btnRemove) {
    btnRemove.addEventListener("click", async () => {
      const query = String(
        (removeSelect?.value || "").trim()
        || (idInput?.value || "").trim()
        || (nameInput?.value || "").trim()
      );
      const removed = await removeWebApp(query);
      if (!removed) return;
      if (idInput) idInput.value = "";
      if (nameInput) nameInput.value = "";
      if (removeSelect) removeSelect.value = "";
    });
  }
}

/* ─── Notes ─── */
let currentEditId = null;

async function refreshNotesList(selectId) {
  if (!savedNotesList) return;
  savedNotesList.innerHTML = "";
  const activeId = selectId || currentEditId;
  let notes = [];
  try {
    if (window.commandDeskBridge?.todayNotesList) {
      notes = await window.commandDeskBridge.todayNotesList();
    } else {
      const invoker = resolveInvoker();
      if (invoker) notes = await invoker("todayNotes:list", null);
    }
  } catch (err) {
    savedNotesList.innerHTML = `<li class="notif-empty">Error loading notes</li>`;
    return;
  }
  if (!notes?.length) {
    savedNotesList.innerHTML = `<li class="notif-empty" style="padding:6px 8px;">No saved notes yet</li>`;
    return;
  }
  notes.forEach((note, i) => {
    const li = document.createElement("li");
    li.className = "saved-note fade-in";
    li.style.animationDelay = `${i * 25}ms`;
    if (note.id === activeId) li.classList.add("active");
    li.innerHTML = `
      <div class="saved-note-title">${escapeHtml(note.title || "Untitled")}</div>
      <div class="saved-note-preview">${escapeHtml((note.body || "").substring(0, 80))}</div>
      <div class="saved-note-meta">
        <span class="saved-note-date">${relativeTime(note.createdAt)}</span>
        <button class="saved-note-delete" data-id="${note.id}" title="Delete">✕</button>
      </div>`;
    li.addEventListener("click", (e) => {
      if (e.target.classList.contains("saved-note-delete")) return;
      savedNotesList.querySelectorAll(".saved-note.active").forEach(item => item.classList.remove("active"));
      li.classList.add("active");
      currentEditId = note.id;
      if (noteTitle) noteTitle.value = note.title || "";
      if (noteBody) noteBody.value = note.body || "";
      if (noteSaveStatus) {
        noteSaveStatus.textContent = "Editing";
      }
    });
    const delBtn = li.querySelector(".saved-note-delete");
    if (delBtn) {
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const invoker = resolveInvoker();
          if (invoker) await invoker("todayNotes:delete", { id: note.id });
          if (currentEditId === note.id) { currentEditId = null; if (noteTitle) noteTitle.value = ""; if (noteBody) noteBody.value = ""; }
          await refreshNotesList();
        } catch (err) { console.warn("delete note error", err); }
      });
    }
    savedNotesList.appendChild(li);
  });
}

async function saveNote() {
  const title = (noteTitle?.value || "").trim();
  const body = (noteBody?.value || "").trim();
  if (!title && !body) { if (noteSaveStatus) noteSaveStatus.textContent = "Nothing to save"; return; }
  const noteData = { title, body };
  if (currentEditId) noteData.id = currentEditId;
  try {
    if (noteSaveStatus) { noteSaveStatus.textContent = "Saving…"; noteSaveStatus.className = "note-status"; }
    let result;
    if (window.commandDeskBridge?.todayNotesSave) result = await window.commandDeskBridge.todayNotesSave(noteData);
    else { const invoker = resolveInvoker(); if (invoker) result = await invoker("todayNotes:save", noteData); }
    currentEditId = result?.notes?.[0]?.id || null;
    await refreshNotesList(currentEditId);
    if (noteSaveStatus) { noteSaveStatus.textContent = "✓ Saved"; noteSaveStatus.classList.add("saved"); setTimeout(() => { if (noteSaveStatus.textContent === "✓ Saved") { noteSaveStatus.textContent = ""; noteSaveStatus.classList.remove("saved"); } }, 2000); }
    if (noteTitle) noteTitle.value = "";
    if (noteBody) noteBody.value = "";
    currentEditId = null;
  } catch (err) { if (noteSaveStatus) noteSaveStatus.textContent = "Save failed"; }
}

function attachNotesHandlers() {
  if (btnSaveNote) btnSaveNote.addEventListener("click", saveNote);
  if (noteBody) noteBody.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); } });
  if (btnNewNote) {
    btnNewNote.addEventListener("click", () => {
      currentEditId = null;
      if (noteTitle) noteTitle.value = "";
      if (noteBody) noteBody.value = "";
      if (savedNotesList) {
        savedNotesList.querySelectorAll(".saved-note.active").forEach(item => item.classList.remove("active"));
      }
      if (noteSaveStatus) {
        noteSaveStatus.textContent = "";
        noteSaveStatus.classList.remove("saved");
      }
      noteTitle?.focus();
    });
  }
}

/* ─── Tabs & Calculator ─── */
let calcDisplayValue = "0";
let calcFirstOperand = null;
let calcOperator = null;
let calcWaitingForSecondOperand = false;

function updateCalcDisplay() {
  const display = document.getElementById("calc-display");
  if (display) display.textContent = calcDisplayValue;
}

function inputDigit(digit) {
  if (calcWaitingForSecondOperand) {
    calcDisplayValue = digit;
    calcWaitingForSecondOperand = false;
  } else {
    calcDisplayValue = calcDisplayValue === "0" ? digit : calcDisplayValue + digit;
  }
  updateCalcDisplay();
}

function inputDecimal(dot) {
  if (calcWaitingForSecondOperand) {
    calcDisplayValue = "0.";
    calcWaitingForSecondOperand = false;
    updateCalcDisplay();
    return;
  }
  if (!calcDisplayValue.includes(dot)) {
    calcDisplayValue += dot;
  }
  updateCalcDisplay();
}

function handleOperator(nextOperator) {
  const inputValue = parseFloat(calcDisplayValue);

  if (calcOperator && calcWaitingForSecondOperand) {
    calcOperator = nextOperator;
    return;
  }

  if (calcFirstOperand === null && !isNaN(inputValue)) {
    calcFirstOperand = inputValue;
  } else if (calcOperator) {
    const result = calculate(calcFirstOperand, inputValue, calcOperator);
    calcDisplayValue = `${parseFloat(result.toFixed(7))}`;
    calcFirstOperand = result;
  }

  calcWaitingForSecondOperand = true;
  calcOperator = nextOperator;
  updateCalcDisplay();
}

function calculate(firstOperand, secondOperand, operator) {
  if (operator === "+") return firstOperand + secondOperand;
  if (operator === "-") return firstOperand - secondOperand;
  if (operator === "*") return firstOperand * secondOperand;
  if (operator === "/") return firstOperand / secondOperand;
  return secondOperand;
}

function resetCalculator() {
  calcDisplayValue = "0";
  calcFirstOperand = null;
  calcOperator = null;
  calcWaitingForSecondOperand = false;
  updateCalcDisplay();
}

function deleteLastDigit() {
  if (calcDisplayValue.length > 1) {
    calcDisplayValue = calcDisplayValue.slice(0, -1);
  } else {
    calcDisplayValue = "0";
  }
  updateCalcDisplay();
}

function attachCalculatorHandlers() {
  const calcGrid = document.querySelector(".calc-grid");
  if (!calcGrid) return;

  calcGrid.addEventListener("click", (event) => {
    const { target } = event;
    if (!target.classList.contains("calc-btn")) return;

    const val = target.dataset.calc;

    switch (val) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "=":
        handleOperator(val);
        break;
      case ".":
        inputDecimal(val);
        break;
      case "C":
        resetCalculator();
        break;
      case "DEL":
        deleteLastDigit();
        break;
      default:
        if (Number.isInteger(parseFloat(val))) {
          inputDigit(val);
        }
    }
  });
}

function switchLeftRailTab(tabId) {
  const tabsPanel = document.querySelector(".tabs-panel");
  if (!tabsPanel) return;

  // Update buttons
  tabsPanel.querySelectorAll(".panel-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });

  // Update content
  tabsPanel.querySelectorAll(".tab-content").forEach(content => {
    content.classList.toggle("active", content.id === `tab-content-${tabId}`);
  });
}

function attachTabHandlers() {
  const tabsNav = document.querySelector(".tabs-nav");
  if (!tabsNav) return;

  tabsNav.addEventListener("click", (event) => {
    const btn = event.target.closest(".panel-tab");
    if (btn) {
      switchLeftRailTab(btn.dataset.tab);
    }
  });
}

/* ─── Init ─── */
function init() {
  attachLayoutAndNavigationHandlers();
  renderWeatherPlaceholder();
  void loadWeatherSnapshot();
  formatClockStrip();
  void refreshSystemAndConnectionStatus();
  renderMarkets();
  renderEconomicCalendar();
  renderNews();
  loadNewsFeeds();
  void reloadTickerTape();
  attachTickerHandlers();
  attachTabHandlers();
  attachCalculatorHandlers();
  attachNewsFeedHandlers();
  attachNotesHandlers();
  attachAlarmHandlers();
  attachAddEventHandlers();
  attachWebAppsHubHandlers();
  loadGmailSnapshot();
  loadCalendarSnapshot();
  loadWebApps();
  refreshNotesList();
  refreshAlarmState();
  renderAlarmCountdown();

  setInterval(formatClockStrip, 1000);
  setInterval(refreshSystemAndConnectionStatus, 5000);
  setInterval(renderMarkets, 1000);
  setInterval(renderEconomicCalendar, 300_000);
  setInterval(renderNews, 300_000);
  setInterval(loadWeatherSnapshot, 600_000);
  setInterval(refreshTickerQuotes, 15_000);
  setInterval(renderAlarmCountdown, 1000);
  setInterval(refreshAlarmState, 5000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
