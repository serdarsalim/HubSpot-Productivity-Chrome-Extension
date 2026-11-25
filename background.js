importScripts("shared/config.js", "shared/cloudTemplates.js");

const ATTACHED_POPUP_PATH = "popup.html";
const DETACHED_POPUP_PATH = "popup.html?mode=detached";
const ATTACHED_POPUP_URL = chrome.runtime.getURL(ATTACHED_POPUP_PATH);
const DETACHED_POPUP_URL = chrome.runtime.getURL(DETACHED_POPUP_PATH);
const SETTINGS_KEY = "popupSettings";
const CLOUD_AUTH_LOCAL_KEY = "popupCloudAuth";
const CLOUD_AUTH_LIST_LOCAL_KEY = "popupCloudAuthList";
const OPEN_CONTACTS_BG_LOCAL_KEY = "openContactsInBackground";
const DEFAULT_LAUNCH_MODE = "attached";
const OPEN_POPUP_WINDOW_MESSAGE = "OPEN_POPUP_WINDOW";
const OPEN_OR_FOCUS_CONTACT_TAB_MESSAGE = "OPEN_OR_FOCUS_CONTACT_TAB";
const OPEN_OR_REUSE_WHATSAPP_TAB_MESSAGE = "OPEN_OR_REUSE_WHATSAPP_TAB";
const TRACK_CLOUD_TEMPLATE_USE_MESSAGE = "TRACK_CLOUD_TEMPLATE_USE";
const REFRESH_CLOUD_TEMPLATES_MESSAGE = "REFRESH_CLOUD_TEMPLATES";
const shared = globalThis.ContactPilotShared || {};
const DEFAULT_CLOUD_API_BASE_URL = String(shared.CLOUD_API_BASE_URL || "https://contactpoint.vercel.app").trim();

function normalizeCloudAuthList(rawList, rawPrimary) {
  const source = [];
  if (Array.isArray(rawList)) source.push(...rawList);
  if (rawPrimary && typeof rawPrimary === "object") source.push(rawPrimary);

  const byOrgId = new Map();
  for (const item of source) {
    const organizationId = String(item?.organizationId || "").trim();
    const apiToken = String(item?.apiToken || "").trim();
    if (!organizationId || !apiToken) continue;
    byOrgId.set(organizationId, {
      organizationId,
      apiToken,
      apiBaseUrl: String(item?.apiBaseUrl || DEFAULT_CLOUD_API_BASE_URL).trim()
    });
  }
  return Array.from(byOrgId.values());
}

async function resolveCloudTrackAuth(input) {
  const organizationId = String(input?.organizationId || "").trim();
  if (organizationId) {
    const stored = await chrome.storage.local.get([CLOUD_AUTH_LIST_LOCAL_KEY, CLOUD_AUTH_LOCAL_KEY]);
    const authList = normalizeCloudAuthList(stored?.[CLOUD_AUTH_LIST_LOCAL_KEY], stored?.[CLOUD_AUTH_LOCAL_KEY]);
    const matched = authList.find((item) => item.organizationId === organizationId);
    if (matched) return matched;
  }

  return {
    organizationId,
    apiToken: String(input?.apiToken || "").trim(),
    apiBaseUrl: String(input?.apiBaseUrl || DEFAULT_CLOUD_API_BASE_URL).trim()
  };
}

async function trackCloudTemplateUse(input) {
  const auth = await resolveCloudTrackAuth(input);
  const apiBaseUrl = String(auth.apiBaseUrl || DEFAULT_CLOUD_API_BASE_URL).trim().replace(/\/+$/g, "");
  const apiToken = String(auth.apiToken || "").trim();
  const templateId = String(input?.templateId || "").trim();
  if (!apiBaseUrl) {
    throw new Error("Cloud API base URL is missing.");
  }
  if (!apiToken) {
    throw new Error("Cloud API token is missing.");
  }
  if (!templateId) {
    throw new Error("Cloud template id is missing.");
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/extension/templates/${encodeURIComponent(templateId)}/track-use`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Track use failed with status ${response.status}.`);
  }

  return true;
}

async function openOrFocusPopupWindow() {
  const existingTabs = await chrome.tabs.query({ url: [DETACHED_POPUP_URL, ATTACHED_POPUP_URL] });
  const existingTab = existingTabs.find((tab) => String(tab.url || "").includes("popup.html?mode=detached")) || existingTabs[0];

  if (existingTab && typeof existingTab.windowId === "number") {
    await chrome.windows.update(existingTab.windowId, { focused: true });
    if (typeof existingTab.id === "number") {
      await chrome.tabs.update(existingTab.id, { active: true });
    }
    return;
  }

  await chrome.windows.create({
    url: DETACHED_POPUP_URL,
    type: "popup",
    width: 980,
    height: 760
  });
}

async function openOrReuseWhatsappTab(urlInput, sender = null) {
  const url = String(urlInput || "").trim();
  if (!url) {
    throw new Error("WhatsApp URL is missing.");
  }

  const existingTabs = await chrome.tabs.query({ url: ["https://web.whatsapp.com/*"] });
  const existingTab = [...existingTabs].sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0] || null;

  if (existingTab && typeof existingTab.id === "number") {
    await chrome.tabs.update(existingTab.id, { url, active: true });
    if (typeof existingTab.windowId === "number") {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }

  const allWindows = await chrome.windows.getAll();
  const normalWindows = allWindows.filter((windowInfo) => windowInfo.type === "normal");
  let senderWindow = null;
  if (typeof sender?.tab?.windowId === "number") {
    try {
      senderWindow = await chrome.windows.get(sender.tab.windowId);
    } catch (_error) {
      senderWindow = null;
    }
  }

  let targetWindowId;
  if (senderWindow?.type === "normal" && typeof senderWindow.id === "number") {
    targetWindowId = senderWindow.id;
  } else {
    const lastFocusedTab = (
      await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      })
    )[0] || null;
    const lastFocusedWindow = typeof lastFocusedTab?.windowId === "number" ? allWindows.find((windowInfo) => windowInfo.id === lastFocusedTab.windowId) || null : null;

    targetWindowId =
      (lastFocusedWindow?.type === "normal" ? lastFocusedWindow.id : undefined) ||
      normalWindows.find((windowInfo) => windowInfo.focused)?.id ||
      normalWindows[0]?.id;
  }

  const createIndex =
    typeof sender?.tab?.index === "number" &&
    typeof sender?.tab?.windowId === "number" &&
    sender.tab.windowId === targetWindowId
      ? sender.tab.index + 1
      : undefined;
  await chrome.tabs.create({
    url,
    active: true,
    ...(typeof targetWindowId === "number" ? { windowId: targetWindowId } : {}),
    ...(typeof createIndex === "number" ? { index: createIndex } : {})
  });
  if (typeof targetWindowId === "number") {
    await chrome.windows.update(targetWindowId, { focused: true });
  }
}

function normalizeContactTabKey(urlInput) {
  const raw = String(urlInput || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const recordMatch = url.pathname.match(/\/contacts\/(\d+)\/record\/0-1\/(\d+)/i);
    if (!recordMatch) return "";
    return `${recordMatch[1]}:${recordMatch[2]}`;
  } catch (_error) {
    return "";
  }
}

async function openOrFocusContactTab(urlInput, sender = null) {
  const url = String(urlInput || "").trim();
  if (!url) {
    throw new Error("Contact URL is missing.");
  }

  const targetKey = normalizeContactTabKey(url);
  if (!targetKey) {
    throw new Error("Invalid HubSpot contact URL.");
  }

  const openInBackground = await readOpenContactsInBackground();

  const existingTabs = await chrome.tabs.query({ url: ["https://*.hubspot.com/*"] });
  const existingTab =
    [...existingTabs]
      .filter((tab) => normalizeContactTabKey(tab?.url || "") === targetKey)
      .sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0] || null;

  if (existingTab && typeof existingTab.id === "number") {
    // In background mode the tab already exists, so leave the user where they are.
    if (openInBackground) return;
    if (typeof existingTab.windowId === "number") {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    await chrome.tabs.update(existingTab.id, { active: true });
    return;
  }

  const allWindows = await chrome.windows.getAll();
  const normalWindows = allWindows.filter((windowInfo) => windowInfo.type === "normal");
  let senderWindow = null;
  if (typeof sender?.tab?.windowId === "number") {
    try {
      senderWindow = await chrome.windows.get(sender.tab.windowId);
    } catch (_error) {
      senderWindow = null;
    }
  }

  let targetWindowId;
  if (senderWindow?.type === "normal" && typeof senderWindow.id === "number") {
    targetWindowId = senderWindow.id;
  } else {
    const lastFocusedTab = (
      await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true
      })
    )[0] || null;
    const lastFocusedWindow = typeof lastFocusedTab?.windowId === "number" ? allWindows.find((windowInfo) => windowInfo.id === lastFocusedTab.windowId) || null : null;

    targetWindowId =
      (lastFocusedWindow?.type === "normal" ? lastFocusedWindow.id : undefined) ||
      normalWindows.find((windowInfo) => windowInfo.focused)?.id ||
      normalWindows[0]?.id;
  }

  const createIndex =
    typeof sender?.tab?.index === "number" &&
    typeof sender?.tab?.windowId === "number" &&
    sender.tab.windowId === targetWindowId
      ? sender.tab.index + 1
      : undefined;

  await chrome.tabs.create({
    url,
    active: !openInBackground,
    ...(typeof targetWindowId === "number" ? { windowId: targetWindowId } : {}),
    ...(typeof createIndex === "number" ? { index: createIndex } : {})
  });

  if (!openInBackground && typeof targetWindowId === "number") {
    await chrome.windows.update(targetWindowId, { focused: true });
  }
}

function normalizeLaunchMode(value) {
  return String(value || "").toLowerCase() === "detached" ? "detached" : "attached";
}

async function readLaunchMode() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeLaunchMode(result?.[SETTINGS_KEY]?.defaultLaunchMode || DEFAULT_LAUNCH_MODE);
}

async function readOpenContactsInBackground() {
  try {
    const result = await chrome.storage.local.get(OPEN_CONTACTS_BG_LOCAL_KEY);
    return result?.[OPEN_CONTACTS_BG_LOCAL_KEY] === true;
  } catch (_error) {
    return false;
  }
}

async function applyActionPopupByLaunchMode(modeInput) {
  const mode = normalizeLaunchMode(modeInput);
  await chrome.action.setPopup({ popup: mode === "detached" ? "" : ATTACHED_POPUP_PATH });
  return mode;
}

async function syncActionPopupBySettings() {
  const mode = await readLaunchMode();
  await applyActionPopupByLaunchMode(mode);
}

chrome.action.onClicked.addListener(() => {
  openOrFocusPopupWindow().catch((error) => {
    console.error("Could not open extension window", error);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void syncActionPopupBySettings().catch((error) => {
    console.error("Could not apply launch mode on install", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  void syncActionPopupBySettings().catch((error) => {
    console.error("Could not apply launch mode on startup", error);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  const settingsChange = changes?.[SETTINGS_KEY];
  if (!settingsChange) return;
  const nextMode = normalizeLaunchMode(settingsChange.newValue?.defaultLaunchMode || DEFAULT_LAUNCH_MODE);
  void applyActionPopupByLaunchMode(nextMode).catch((error) => {
    console.error("Could not update launch mode from storage change", error);
  });
});

const CLOUD_CONNECT_MESSAGE = "CONTACT_POINT_CONNECT";
const LOAD_HUBSPOT_PROPERTIES_MESSAGE = "CONTACT_POINT_LOAD_HUBSPOT_PROPERTIES";
const GET_HUBSPOT_PROPERTIES_MESSAGE = "GET_HUBSPOT_PROPERTIES";
const CLOUD_IDENTITY_LOCAL_KEY = "popupCloudIdentity";
const CLOUD_LEFT_ORG_IDS_LOCAL_KEY = "popupCloudLeftOrgIds";

function getCloudSiteOrigin() {
  try {
    return new URL(DEFAULT_CLOUD_API_BASE_URL).origin;
  } catch {
    return "";
  }
}

async function fetchCloudIdentity(apiToken) {
  const baseUrl = DEFAULT_CLOUD_API_BASE_URL.replace(/\/+$/g, "");
  const response = await fetch(`${baseUrl}/api/v1/extension/me`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiToken}` }
  });
  if (!response.ok) throw new Error(`Key check failed with status ${response.status}.`);
  return response.json();
}

// Called by the website's /connect page after "Sign in with Google". Each key
// is verified against the API before it is stored, then merged into the same
// list the popup uses for pasted keys. Open popups pick it up via
// chrome.storage.onChanged.
async function connectCloudFromWebsite(message) {
  const incoming = Array.isArray(message?.connections) ? message.connections : [];
  const tokens = incoming
    .map((item) => String(item?.token || "").trim())
    .filter((token) => token.startsWith("cpt_"));
  const identityToken = String(message?.identityToken || "").trim();
  const email = String(message?.email || "").trim();

  // Stay signed in even with no team yet; the popup uses this to pick up
  // teams later. An explicit sign-in also forgets previously left teams.
  if (identityToken.startsWith("cpi_") && email) {
    await chrome.storage.local.set({
      [CLOUD_IDENTITY_LOCAL_KEY]: { email, token: identityToken, signedInAt: new Date().toISOString() },
      [CLOUD_LEFT_ORG_IDS_LOCAL_KEY]: []
    });
  }
  if (!tokens.length) {
    return identityToken ? { ok: true, connected: 0 } : { ok: false, error: "No keys received." };
  }

  const stored = await chrome.storage.local.get([CLOUD_AUTH_LIST_LOCAL_KEY, CLOUD_AUTH_LOCAL_KEY]);
  const existingRaw = Array.isArray(stored?.[CLOUD_AUTH_LIST_LOCAL_KEY]) ? stored[CLOUD_AUTH_LIST_LOCAL_KEY] : [];
  const byOrgId = new Map();
  for (const item of existingRaw) {
    const orgId = String(item?.organizationId || "").trim();
    if (orgId && String(item?.apiToken || "").trim()) byOrgId.set(orgId, item);
  }

  let connected = 0;
  for (const apiToken of tokens) {
    try {
      const me = await fetchCloudIdentity(apiToken);
      const organizationId = String(me?.organization?.id || "").trim();
      if (!organizationId) continue;
      const previous = byOrgId.get(organizationId);
      byOrgId.set(organizationId, {
        apiToken,
        apiBaseUrl: DEFAULT_CLOUD_API_BASE_URL,
        organizationId,
        organizationName: String(me?.organization?.name || "").trim(),
        organizationSlug: String(me?.organization?.slug || "").trim(),
        templatesPaused: previous?.templatesPaused === true,
        tokenPrefix: String(me?.token?.prefix || "").trim(),
        updatedAt: new Date().toISOString()
      });
      connected += 1;
    } catch (error) {
      console.error("Could not verify team key from sign-in", error);
    }
  }

  if (!connected) return { ok: false, error: "Could not verify the team keys." };

  const nextList = Array.from(byOrgId.values());
  await chrome.storage.local.set({
    [CLOUD_AUTH_LIST_LOCAL_KEY]: nextList,
    [CLOUD_AUTH_LOCAL_KEY]: nextList[0] || null
  });
  return { ok: true, connected };
}

function portalIdFromHubSpotUrl(url) {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/^\/[a-z0-9-]+\/(\d{4,})(?:\/|$)/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

// Website Fields page: "Load from HubSpot". Reads the property list from an
// open HubSpot tab (the team's linked account first), since only a page on
// HubSpot carries the person's HubSpot session.
async function loadHubSpotPropertiesForWebsite(message) {
  const expectedPortalId = String(message?.expectedPortalId || "").trim();
  const tabs = await chrome.tabs.query({ url: ["https://*.hubspot.com/*"] });
  const candidates = tabs
    .filter((tab) => tab.id && portalIdFromHubSpotUrl(tab.url || ""))
    .sort((a, b) => {
      const score = (tab) =>
        (expectedPortalId && portalIdFromHubSpotUrl(tab.url || "") === expectedPortalId ? 2 : 0) + (tab.active ? 1 : 0);
      return score(b) - score(a) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
    });
  if (!candidates.length) return { ok: false, code: "no_hubspot_tab" };

  let lastFailure = { ok: false, code: "no_hubspot_tab" };
  for (const tab of candidates) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: GET_HUBSPOT_PROPERTIES_MESSAGE });
      if (response?.ok) return response;
      lastFailure = response || lastFailure;
    } catch {
      // Tab opened before the extension was installed or updated.
      lastFailure = { ok: false, code: "reload_hubspot_tab" };
    }
  }
  return lastFailure;
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const expectedOrigin = getCloudSiteOrigin();
  const trusted = Boolean(expectedOrigin) && sender?.origin === expectedOrigin;

  if (message?.type === LOAD_HUBSPOT_PROPERTIES_MESSAGE) {
    if (!trusted) {
      sendResponse({ ok: false, error: "Unexpected sender." });
      return false;
    }
    loadHubSpotPropertiesForWebsite(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, code: "failed", error: String(error?.message || error || "Unknown error") }));
    return true;
  }

  if (message?.type !== CLOUD_CONNECT_MESSAGE) return false;
  if (!trusted) {
    sendResponse({ ok: false, error: "Unexpected sender." });
    return false;
  }
  connectCloudFromWebsite(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "Unknown error") }));
  return true;
});

// Keeps cloud templates fresh while reps work in HubSpot, without opening the
// popup. Asks the website whether each team's templates changed (a cached,
// database-free answer) and downloads the full list only when they did.
// Writing the cache keys is enough: content.js re-reads on storage changes.
let cloudTemplateRefreshInFlight = null;

async function fetchCloudJsonInBackground(baseUrl, path, apiToken) {
  const timing = globalThis.ContactPilotShared?.TIMING?.background || {};
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Number(timing.cloudRequestTimeoutMs || 12000));
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiToken}` },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Cloud request failed with status ${response.status}.`);
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function refreshOneCloudTeam(auth, intervalMs) {
  const cloud = globalThis.ContactPilotShared.cloudTemplates;
  const keys = cloud.cacheKeys(auth.organizationId);
  if (!keys) return;
  const stored = await chrome.storage.local.get([keys.metaKey, keys.emailKey, keys.whatsappKey, keys.noteKey]);
  const localMeta = stored?.[keys.metaKey] && typeof stored[keys.metaKey] === "object" ? stored[keys.metaKey] : null;
  const lastCheckedMs = Date.parse(String(localMeta?.lastCheckedAt || ""));
  if (Number.isFinite(lastCheckedMs) && Date.now() - lastCheckedMs < intervalMs) return;

  const baseUrl = String(auth.apiBaseUrl || DEFAULT_CLOUD_API_BASE_URL).trim().replace(/\/+$/g, "");
  const remoteMeta = await fetchCloudJsonInBackground(baseUrl, "/api/v1/extension/templates/meta", auth.apiToken);
  const hasCachedTemplates = [keys.emailKey, keys.whatsappKey, keys.noteKey].some((key) => Array.isArray(stored?.[key]));
  const nowIso = new Date().toISOString();
  const metaBase = {
    organizationId: auth.organizationId,
    latestUpdatedAt: remoteMeta?.latestUpdatedAt || null,
    templateCount: Number(remoteMeta?.templateCount || 0),
    lastCheckedAt: nowIso
  };

  if (!cloud.needsFullSync(localMeta, remoteMeta, hasCachedTemplates, false)) {
    await chrome.storage.local.set({
      [keys.metaKey]: { ...metaBase, lastFullSyncAt: String(localMeta?.lastFullSyncAt || nowIso) }
    });
    return;
  }

  const payload = await fetchCloudJsonInBackground(baseUrl, "/api/v1/extension/templates", auth.apiToken);
  const split = cloud.splitByType(payload?.templates);
  await chrome.storage.local.set({
    [keys.emailKey]: cloud.normalizeArray(split.email, "EMAIL", auth.organizationId),
    [keys.whatsappKey]: cloud.normalizeArray(split.whatsapp, "WHATSAPP", auth.organizationId),
    [keys.noteKey]: cloud.normalizeArray(split.note, "NOTE", auth.organizationId),
    [keys.metaKey]: { ...metaBase, lastFullSyncAt: nowIso }
  });
}

async function refreshCloudTemplatesInBackground() {
  const timing = globalThis.ContactPilotShared?.TIMING?.background || {};
  const intervalMs = Number(timing.cloudTemplateCheckIntervalMs || 60 * 1000);
  const stored = await chrome.storage.local.get([CLOUD_AUTH_LIST_LOCAL_KEY]);
  const rawList = Array.isArray(stored?.[CLOUD_AUTH_LIST_LOCAL_KEY]) ? stored[CLOUD_AUTH_LIST_LOCAL_KEY] : [];
  const pausedOrgIds = new Set(
    rawList.filter((item) => item?.templatesPaused === true).map((item) => String(item?.organizationId || "").trim())
  );
  const targets = normalizeCloudAuthList(rawList, null).filter((auth) => !pausedOrgIds.has(auth.organizationId));

  // Errors (offline, revoked key) are left for the popup, which already knows
  // how to disconnect a team and explain it.
  await Promise.all(
    targets.map((auth) =>
      refreshOneCloudTeam(auth, intervalMs).catch((error) => {
        console.warn("Cloud template check failed", auth.organizationId, error);
      })
    )
  );
}

function requestCloudTemplateRefresh() {
  if (!cloudTemplateRefreshInFlight) {
    cloudTemplateRefreshInFlight = refreshCloudTemplatesInBackground().finally(() => {
      cloudTemplateRefreshInFlight = null;
    });
  }
  return cloudTemplateRefreshInFlight;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === OPEN_POPUP_WINDOW_MESSAGE) {
    openOrFocusPopupWindow()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "Unknown error") }));
    return true;
  }

  if (message?.type === OPEN_OR_FOCUS_CONTACT_TAB_MESSAGE) {
    openOrFocusContactTab(message?.url, _sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "Unknown error") }));
    return true;
  }

  if (message?.type === OPEN_OR_REUSE_WHATSAPP_TAB_MESSAGE) {
    openOrReuseWhatsappTab(message?.url, _sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "Unknown error") }));
    return true;
  }

  if (message?.type === REFRESH_CLOUD_TEMPLATES_MESSAGE) {
    requestCloudTemplateRefresh()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "Unknown error") }));
    return true;
  }

  if (message?.type === TRACK_CLOUD_TEMPLATE_USE_MESSAGE) {
    trackCloudTemplateUse(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error || "Unknown error") }));
    return true;
  }
});

void syncActionPopupBySettings().catch((error) => {
  console.error("Could not apply launch mode at worker start", error);
});
