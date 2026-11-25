(() => {
  const DEFAULT_COUNTRY_CODE = "";
  const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{6,}\d)/;
  const shared = globalThis.ContactPilotShared || {};
  const MESSAGE_TYPES = shared.MESSAGE_TYPES || Object.freeze({
    GET_CONTACTS: "GET_CONTACTS",
    GET_ACTIVE_TAB_CONTEXT: "GET_ACTIVE_TAB_CONTEXT",
    GET_PORTAL_ID: "GET_PORTAL_ID",
    CREATE_NOTE_ON_PAGE: "CREATE_NOTE_ON_PAGE",
    GET_NOTES_ON_PAGE: "GET_NOTES_ON_PAGE",
    APPLY_EMAIL_TEMPLATE_ON_PAGE: "APPLY_EMAIL_TEMPLATE_ON_PAGE",
    OPEN_EMAIL_AND_APPLY_TEMPLATE_ON_PAGE: "OPEN_EMAIL_AND_APPLY_TEMPLATE_ON_PAGE",
    OPEN_OR_FOCUS_CONTACT_TAB: "OPEN_OR_FOCUS_CONTACT_TAB",
    OPEN_OR_REUSE_WHATSAPP_TAB: "OPEN_OR_REUSE_WHATSAPP_TAB",
    TRACK_CLOUD_TEMPLATE_USE: "TRACK_CLOUD_TEMPLATE_USE",
    REFRESH_CLOUD_TEMPLATES: "REFRESH_CLOUD_TEMPLATES",
    GET_HUBSPOT_PROPERTIES: "GET_HUBSPOT_PROPERTIES"
  });
  const TIMING = shared.TIMING?.content || Object.freeze({
    tableScrollDelayMs: 240,
    noteComposerOpenAttempts: 20,
    noteComposerOpenDelayMs: 400,
    noteEditorSettleDelayMs: 250,
    noteSaveSettleDelayMs: 1200,
    noteReadRetryAttempts: 14,
    noteReadRetryDelayMs: 450,
    emailComposerOpenAttempts: 20,
    emailComposerOpenDelayMs: 300
  });
  const SETTINGS_KEY = "popupSettings";
  const EMAIL_TEMPLATES_LOCAL_KEY = "popupEmailTemplates";
  const WHATSAPP_TEMPLATES_LOCAL_KEY = "popupWhatsappTemplates";
  const NOTE_TEMPLATES_LOCAL_KEY = "popupNoteTemplates";
  const TEMPLATE_USAGE_LOCAL_KEY = "popupTemplateUsageByContact";
  const TEMPLATE_STATS_LOCAL_KEY = "popupTemplateUsageStats";
  const CLOUD_AUTH_LOCAL_KEY = "popupCloudAuth";
  const CLOUD_AUTH_LIST_LOCAL_KEY = "popupCloudAuthList";
  const CLOUD_EMAIL_CACHE_PREFIX = "popupCloudEmailTemplates::";
  const CLOUD_WHATSAPP_CACHE_PREFIX = "popupCloudWhatsappTemplates::";
  const CLOUD_NOTE_CACHE_PREFIX = "popupCloudNoteTemplates::";
  const CLOUD_TEMPLATE_ID_PREFIX = "cloud_";
  const CLOUD_API_BASE_URL = cleanText(shared.CLOUD_API_BASE_URL || "https://contactpoint.vercel.app");
  const CONTACT_INDEX_NEW_TAB_STYLE_ID = "cpContactIndexNewTabStyle";
  const SIDEBAR_DECLUTTER_BAR_ID = "cpSidebarDeclutterBar";
  const SIDEBAR_DECLUTTER_STYLE_ID = "cpSidebarDeclutterStyle";
  const SIDEBAR_HIDE_EMPTY_LOCAL_KEY = "popupSidebarHideEmpty";
  const NAV_THEME_TOGGLE_ID = "cpNavThemeToggle";
  const NAV_THEME_TOGGLE_STYLE_ID = "cpNavThemeToggleStyle";
  const COMPOSER_TEMPLATE_SEARCH_ROW_ID = "cpComposerTemplateSearchRow";
  const COMPOSER_NOTE_SEARCH_ROW_ID = "cpComposerNoteSearchRow";
  const COMPOSER_TEMPLATE_SEARCH_STYLE_ID = "cpComposerTemplateSearchStyle";
  const DARK_READER_THEME = Object.freeze({
    brightness: 100,
    contrast: 90,
    sepia: 10
  });
  // HubSpot's editors (ProseMirror) redraw any node whose inline style
  // changes. Dark Reader rewrites inline colors on every new node, so pasting
  // or inserting colored text (most HubSpot templates) ping-pongs between
  // the two and froze the tab for 30+ seconds. Dark Reader leaves editor
  // inline styles alone; the CSS below keeps that text readable instead.
  const DARK_READER_FIXES = Object.freeze({
    invert: [],
    css: [
      ".ProseMirror [style*='color'] { color: ${#33475b} !important; }",
      ".ProseMirror [style*='background'] { background-color: transparent !important; }"
    ].join("\n"),
    ignoreInlineStyle: [".ProseMirror *"],
    ignoreImageAnalysis: [".ProseMirror img"],
    disableStyleSheetsProxy: false
  });

  function normalizeThemeMode(value) {
    return String(value || "").toLowerCase() === "dark" ? "dark" : "light";
  }

  function getDarkReaderApi() {
    const api = globalThis.DarkReader;
    if (!api) return null;
    if (typeof api.enable !== "function" || typeof api.disable !== "function") return null;
    return api;
  }

  let hubSpotThemeMode = "light";

  function applyHubSpotThemeMode(themeMode) {
    const mode = normalizeThemeMode(themeMode);
    hubSpotThemeMode = mode;
    syncNavThemeToggle();
    const darkReader = getDarkReaderApi();
    if (!darkReader) return false;

    if (mode === "dark") {
      if (typeof darkReader.setFetchMethod === "function" && typeof globalThis.fetch === "function") {
        darkReader.setFetchMethod(globalThis.fetch.bind(globalThis));
      }
      darkReader.enable(DARK_READER_THEME, DARK_READER_FIXES);
      return true;
    }

    darkReader.disable();
    return true;
  }

  // --- Dark mode toggle in HubSpot's global toolbar ---
  // Same setting the popup's theme button writes (popupSettings.themeMode),
  // so both stay in sync through chrome.storage.onChanged.
  const NAV_THEME_TOGGLE_ICONS = Object.freeze({
    moon: "<svg viewBox='0 0 16 16' width='16' height='16' aria-hidden='true'><path fill='currentColor' d='M6.2 1.2a.6.6 0 0 1 .1.7A5.4 5.4 0 0 0 13.9 9a.6.6 0 0 1 .9.7A7 7 0 1 1 5.5 1a.6.6 0 0 1 .7.2Z'/></svg>",
    sun: "<svg viewBox='0 0 16 16' width='16' height='16' aria-hidden='true'><circle cx='8' cy='8' r='3.2' fill='currentColor'/><path stroke='currentColor' stroke-width='1.5' stroke-linecap='round' d='M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.2 1.2M11.8 11.8 13 13M13 3l-1.2 1.2M4.2 11.8 3 13'/></svg>"
  });

  function syncNavThemeToggle() {
    const button = document.querySelector(`#${NAV_THEME_TOGGLE_ID} button`);
    if (!button) return;
    const isDark = hubSpotThemeMode === "dark";
    if (button.dataset.cpTheme === hubSpotThemeMode) return;
    button.dataset.cpTheme = hubSpotThemeMode;
    const label = isDark ? "Switch to light mode" : "Switch to dark mode";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.innerHTML = isDark ? NAV_THEME_TOGGLE_ICONS.sun : NAV_THEME_TOGGLE_ICONS.moon;
  }

  function toggleHubSpotThemeFromNav() {
    const nextMode = hubSpotThemeMode === "dark" ? "light" : "dark";
    applyHubSpotThemeMode(nextMode);
    try {
      chrome.storage.sync.get(SETTINGS_KEY, (result) => {
        if (chrome.runtime.lastError) return;
        const settings = result?.[SETTINGS_KEY];
        const nextSettings = { ...(settings && typeof settings === "object" ? settings : {}), themeMode: nextMode };
        chrome.storage.sync.set({ [SETTINGS_KEY]: nextSettings });
      });
    } catch (_error) {
      // Ignore storage failures; the page itself already switched.
    }
  }

  function ensureNavThemeToggle() {
    const list = document.getElementById("hs-global-toolbar-icons");
    if (!list) return;
    const existing = document.getElementById(NAV_THEME_TOGGLE_ID);
    if (existing && list.contains(existing)) return;
    if (existing) existing.remove();

    if (!document.getElementById(NAV_THEME_TOGGLE_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = NAV_THEME_TOGGLE_STYLE_ID;
      style.textContent = `
        #${NAV_THEME_TOGGLE_ID} {
          display: flex;
          align-items: center;
          margin: 0 5px;
          list-style: none;
        }
        #${NAV_THEME_TOGGLE_ID} button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          padding: 8px;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: #ffffff;
          cursor: pointer;
        }
        /* HubSpot sets a dark color on every svg, which currentColor inherits. */
        #${NAV_THEME_TOGGLE_ID} svg {
          display: block;
          color: #ffffff;
        }
        #${NAV_THEME_TOGGLE_ID} button:hover,
        #${NAV_THEME_TOGGLE_ID} button:focus-visible {
          background: rgba(255, 255, 255, 0.14);
          outline: none;
        }
      `;
      document.head.appendChild(style);
    }

    const item = document.createElement("li");
    item.id = NAV_THEME_TOGGLE_ID;
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", toggleHubSpotThemeFromNav);
    item.appendChild(button);

    // Sit just left of the notifications bell; fall back to the end of the row.
    // The bell is wrapped (li inside a div), so anchor on whichever direct
    // child of the row contains it.
    const bell = document.getElementById("hs-global-toolbar-notifications-list-item");
    const bellItem = bell ? Array.from(list.children).find((child) => child.contains(bell)) : null;
    if (bellItem) {
      list.insertBefore(item, bellItem);
    } else {
      list.appendChild(item);
    }
    syncNavThemeToggle();
  }

  function applyHubSpotThemeFromSettingsStorage() {
    try {
      chrome.storage.sync.get(SETTINGS_KEY, (result) => {
        if (chrome.runtime.lastError) return;
        const settings = result?.[SETTINGS_KEY];
        applyHubSpotThemeMode(settings?.themeMode || "light");
        applyContactEnhancerSettings(settings);
      });
    } catch (_error) {
      // Ignore storage read failures.
    }
  }

  function subscribeHubSpotThemeChanges() {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (!changes) return;

        if (areaName === "sync" && Object.prototype.hasOwnProperty.call(changes, SETTINGS_KEY)) {
          const nextSettings = changes[SETTINGS_KEY]?.newValue;
          applyHubSpotThemeMode(nextSettings?.themeMode || "light");
          applyContactEnhancerSettings(nextSettings);
        }

        if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, SIDEBAR_HIDE_EMPTY_LOCAL_KEY)) {
          sidebarDeclutterState.hideEmpty = changes[SIDEBAR_HIDE_EMPTY_LOCAL_KEY]?.newValue === true;
          scheduleContactEnhancers();
        }

        if (areaName === "local" && Object.prototype.hasOwnProperty.call(changes, TEMPLATE_USAGE_LOCAL_KEY)) {
          contactTemplateState.templateUsageByContact = normalizeInlineTemplateUsageMap(
            changes[TEMPLATE_USAGE_LOCAL_KEY]?.newValue
          );
          if (waTemplatePopoverState.open) renderWaTemplatePopoverList();
        }

        if (areaName === "local") {
          const changedKeys = Object.keys(changes);
          const templatesDataChanged = changedKeys.some((key) => {
            return (
              key === EMAIL_TEMPLATES_LOCAL_KEY ||
              key === WHATSAPP_TEMPLATES_LOCAL_KEY ||
              key === NOTE_TEMPLATES_LOCAL_KEY ||
              key === CLOUD_AUTH_LIST_LOCAL_KEY ||
              key === CLOUD_AUTH_LOCAL_KEY ||
              key.startsWith(CLOUD_EMAIL_CACHE_PREFIX) ||
              key.startsWith(CLOUD_WHATSAPP_CACHE_PREFIX) ||
              key.startsWith(CLOUD_NOTE_CACHE_PREFIX)
            );
          });

          const { email, note } = composerTemplateSearchState.kinds;
          if (templatesDataChanged && (email.dialog || note.dialog || waTemplatePopoverState.open)) {
            void refreshContactTemplateData().then(() => {
              void refreshComposerFavorites("email");
              void refreshComposerFavorites("note");
              if (waTemplatePopoverState.open) renderWaTemplatePopoverList();
            });
          }

          for (const [kind, { picker }] of Object.entries(composerTemplateSearchState.kinds)) {
            if (!picker) continue;
            let favoritesChanged = false;
            for (const key of changedKeys) {
              if (!picker.favorites.has(key)) continue;
              picker.favoriteUpdates.add(key);
              const starred = changes[key].newValue === true;
              if (picker.favorites.get(key) === starred) continue;
              picker.favorites.set(key, starred);
              favoritesChanged = true;
            }
            if (favoritesChanged) renderComposerTemplateDropdown(kind);
          }
        }
      });
    } catch (_error) {
      // Ignore storage subscription failures.
    }
  }

  // A content script left behind by an extension reload or auto-update keeps
  // running against a dead chrome.runtime, and every API call from it throws
  // "Extension context invalidated". It can't reach the extension any more, so
  // the sweeps stop themselves rather than throw on every DOM mutation until
  // the tab is refreshed.
  function isExtensionContextAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch (_error) {
      return false;
    }
  }

  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeSearchText(text) {
    return String(text || "")
      .normalize("NFKD")
      .replace(/[İIı]/g, "i")
      .replace(/[Şş]/g, "s")
      .replace(/[Çç]/g, "c")
      .replace(/[Ğğ]/g, "g")
      .replace(/[Üü]/g, "u")
      .replace(/[Öö]/g, "o")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function normalizeSearchTokens(text) {
    return normalizeSearchText(text)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  function searchTextMatchesQuery(text, query) {
    const normalizedText = normalizeSearchText(text);
    const tokens = Array.isArray(query) ? query.map((token) => normalizeSearchText(token)).filter(Boolean) : normalizeSearchTokens(query);
    if (!tokens.length) return true;
    if (!normalizedText) return false;
    return tokens.every((token) => normalizedText.includes(token));
  }

  function isDashLikePlaceholder(value) {
    const text = cleanText(value);
    if (!text) return false;
    const compact = text.replace(/[\s|_]+/g, "");
    if (!compact) return false;
    return /^[-–—−‐‑‒﹘﹣－]+$/.test(compact);
  }

  function hasMeaningfulCellValue(value) {
    const text = cleanText(value);
    if (!text) return false;
    if (isDashLikePlaceholder(text)) return false;
    const compact = text.replace(/[\s\-–—|_]+/g, "");
    return compact.length > 0;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function slugify(input) {
    return cleanText(input)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "column";
  }

  function stripOuterNoise(text) {
    return cleanText((text || "").replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, "").replace(/\s*--\s*--\s*/g, " "));
  }

  function removeLeadingInitials(name) {
    const tokens = cleanText(name).split(" ").filter(Boolean);
    if (tokens.length < 2) return cleanText(name);

    const isInitialToken = (token) => {
      const cleaned = token.replace(/[^A-Za-z]/g, "");
      return cleaned.length >= 1 && cleaned.length <= 2 && cleaned === cleaned.toUpperCase();
    };

    while (tokens.length > 1 && isInitialToken(tokens[0])) {
      tokens.shift();
    }

    return cleanText(tokens.join(" "));
  }

  function sanitizeNameValue(rawName) {
    const withoutPreview = cleanText(rawName).replace(/\bpreview\b/gi, " ");
    return removeLeadingInitials(stripOuterNoise(withoutPreview));
  }

  function cleanPhoneCandidate(raw) {
    let text = cleanText(raw || "");
    if (!text) return "";

    // Keep trailing digit groups intact (e.g. +90 544 157 14 74).
    // Trimming short suffixes here can clip valid international numbers.
    return cleanText(text);
  }

  function normalizePhone(raw, countryPrefix = DEFAULT_COUNTRY_CODE) {
    const trimmed = cleanPhoneCandidate(raw);
    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return null;

    const prefix = String(countryPrefix || DEFAULT_COUNTRY_CODE).replace(/\D/g, "");

    // International number already has explicit country code.
    if (trimmed.startsWith("+")) return digits;
    // International format with leading 00 (e.g. 0060...).
    if (digits.startsWith("00")) return digits.slice(2);
    // Already starts with configured prefix.
    if (prefix && digits.startsWith(prefix)) return digits;

    if (prefix) {
      // Local format with trunk zero: 017... -> 60 + 17...
      if (digits.startsWith("0")) return `${prefix}${digits.slice(1)}`;
      // Short local numbers likely missing country code.
      if (digits.length <= 9) return `${prefix}${digits}`;
    } else {
      // No default prefix configured: avoid guessing for local numbers.
      if (digits.startsWith("0")) return null;
    }

    // Looks like a full international number without +.
    return digits;
  }

  function findHeaderRow() {
    const rows = Array.from(document.querySelectorAll("thead tr, [role='row']"));
    let best = null;
    let bestScore = 0;

    for (const row of rows) {
      const headerCells = Array.from(row.querySelectorAll("th, [role='columnheader']"));
      if (!headerCells.length) continue;

      const labels = headerCells.map((cell) => cleanText(cell.innerText || cell.textContent || ""));
      const score = labels.filter((label) => label && !/^[-|]+$/.test(label)).length;

      if (score > bestScore) {
        bestScore = score;
        best = { row, headerCells, labels };
      }
    }

    return bestScore >= 2 ? best : null;
  }

  function buildColumns(headerInfo) {
    const used = new Set();
    const columns = [];

    headerInfo.headerCells.forEach((cell, sourceIndex) => {
      const rawLabel = cleanText(cell.innerText || cell.textContent || "");
      if (!rawLabel) return;
      if (/^[-|]+$/.test(rawLabel)) return;

      let id = slugify(rawLabel);
      let count = 2;
      while (used.has(id)) {
        id = `${slugify(rawLabel)}_${count}`;
        count += 1;
      }

      used.add(id);
      columns.push({ id, label: rawLabel, sourceIndex });
    });

    return columns;
  }

  function getDataRows(headerInfo) {
    const headerRow = headerInfo.row;
    const table = headerRow.closest("table");

    if (table) {
      const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
      if (bodyRows.length) return bodyRows;
    }

    return Array.from(document.querySelectorAll("[role='row']")).filter((row) => {
      if (row === headerRow) return false;
      const hasHeaderCells = row.querySelectorAll("th, [role='columnheader']").length > 0;
      if (hasHeaderCells) return false;
      const cellCount = row.querySelectorAll("td, [role='gridcell']").length;
      if (!cellCount) return false;
      if (row.offsetParent === null) return false;
      return true;
    });
  }

  function findPhoneColumnId(columns) {
    const phoneCol = columns.find((c) => /phone/i.test(c.label));
    return phoneCol ? phoneCol.id : null;
  }

  function findNameColumnId(columns) {
    const nameCol = columns.find((c) => /name/i.test(c.label) || /^name(_\d+)?$/i.test(c.id));
    return nameCol ? nameCol.id : null;
  }

  function resolveGenderValue(values) {
    const source = values && typeof values === "object" ? values : {};
    const keyMatchers = [
      (key) => key === "gender" || key.includes("gender"),
      (key) => key === "salutation" || key.includes("salutation"),
      (key) => key === "sex" || /(?:^|_)sex(?:_|$)/.test(key),
      (key) => key === "title" || key.includes("title")
    ];

    for (const matchesKey of keyMatchers) {
      for (const [rawKey, rawValue] of Object.entries(source)) {
        const normalizedKey = String(rawKey || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
        if (!normalizedKey || !matchesKey(normalizedKey)) continue;
        const value = cleanText(rawValue || "");
        if (value) return value;
      }
    }

    return "";
  }

  function applyMessageTemplate(template, values, nameColumnId) {
    const rawName = cleanText(values?.[nameColumnId || ""] || "");
    const firstName = rawName ? rawName.split(" ")[0] : "";
    const gender = resolveGenderValue(values);
    return String(template || "")
      .replace(/\[name\]/gi, firstName)
      .replace(/\[gender\]/gi, gender);
  }

  function extractValuesFromRow(row, columns) {
    const cells = Array.from(row.querySelectorAll("td, [role='gridcell']"));
    if (!cells.length) return null;

    const values = {};
    for (const col of columns) {
      const cell = cells[col.sourceIndex] || null;
      let value = cleanText(cell?.innerText || cell?.textContent || "");

      if (!value) {
        values[col.id] = "";
        continue;
      }

      if (/name/i.test(col.label) || /^name(_\d+)?$/i.test(col.id)) {
        value = sanitizeNameValue(value);
      }

      values[col.id] = value;
    }

    return values;
  }

  function extractContactRecordIdFromHref(hrefInput) {
    const href = String(hrefInput || "").trim();
    if (!href) return "";
    const match = href.match(/\/record\/0-1\/(\d+)/i);
    return match ? String(match[1]) : "";
  }

  function extractRecordIdFromRow(row) {
    if (!(row instanceof Element)) return "";

    const linkCandidates = Array.from(row.querySelectorAll("a[href], [data-href], [data-url], [href]"));
    for (const element of linkCandidates) {
      if (!(element instanceof Element)) continue;
      const href = element.getAttribute("href") || element.getAttribute("data-href") || element.getAttribute("data-url") || "";
      const recordId = extractContactRecordIdFromHref(href);
      if (recordId) return recordId;
    }

    const rowHtml = String(row.innerHTML || "");
    const fallbackRecordId = extractContactRecordIdFromHref(rowHtml);
    return fallbackRecordId || "";
  }

  function buildContactFromValues(row, values, columns, phoneColumnId, nameColumnId, countryPrefix, messageText) {
    if (!values) return null;
    const rowValues = Object.values(values);
    const dashOnlyRow = rowValues.length > 0 && rowValues.every((value) => isDashLikePlaceholder(value));
    if (dashOnlyRow) return null;

    const hasAny = Object.values(values).some((value) => hasMeaningfulCellValue(value));
    if (!hasAny) return null;

    let phoneRaw = "";
    if (phoneColumnId) {
      phoneRaw = cleanPhoneCandidate(values[phoneColumnId] || "");
    }

    if (!phoneRaw) {
      const firstPhoneCell = Object.values(values).find((v) => PHONE_PATTERN.test(v));
      phoneRaw = cleanPhoneCandidate(firstPhoneCell || "");
    }

    const phoneDigits = phoneRaw ? normalizePhone(phoneRaw, countryPrefix) || "" : "";
    const baseWaUrl = phoneDigits ? `https://web.whatsapp.com/send/?phone=${phoneDigits}&type=phone_number` : "";
    const text = cleanText(applyMessageTemplate(messageText, values, nameColumnId));
    const waUrl = baseWaUrl ? (text ? `${baseWaUrl}&text=${encodeURIComponent(text)}` : baseWaUrl) : "";
    const recordId = extractRecordIdFromRow(row);
    const key = recordId ? `record_${recordId}` : columns.map((c) => values[c.id] || "").join("|");

    return {
      key,
      recordId,
      values,
      phoneDisplay: phoneRaw || values[phoneColumnId || ""] || "",
      phoneDigits,
      waUrl
    };
  }

  function collectContactsFromRows(rows, columns, phoneColumnId, nameColumnId, countryPrefix, messageText, seenKeys, contacts) {
    for (const row of rows) {
      const values = extractValuesFromRow(row, columns);
      const contact = buildContactFromValues(row, values, columns, phoneColumnId, nameColumnId, countryPrefix, messageText);
      if (!contact) continue;
      if (seenKeys.has(contact.key)) continue;
      seenKeys.add(contact.key);
      contacts.push(contact);
    }
  }

  function isScrollableElement(element) {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const overflowY = String(style.overflowY || "").toLowerCase();
    const canScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    if (!canScroll) return false;
    return element.scrollHeight - element.clientHeight > 60;
  }

  function findTableScrollContainer(headerInfo) {
    const seeds = [
      headerInfo?.row?.closest("table"),
      headerInfo?.row?.closest("[role='grid']"),
      headerInfo?.row
    ].filter(Boolean);

    for (const seed of seeds) {
      let node = seed;
      while (node && node !== document.body) {
        if (isScrollableElement(node)) return node;
        node = node.parentElement;
      }
    }

    const fallback = document.scrollingElement || document.documentElement;
    return fallback || null;
  }

  async function extractTableContactsWithAutoScroll(countryPrefix = DEFAULT_COUNTRY_CODE, messageText = "") {
    const headerInfo = findHeaderRow();
    if (!headerInfo) {
      return { columns: [], contacts: [], phoneColumnId: null };
    }

    const columns = buildColumns(headerInfo);
    if (!columns.length) {
      return { columns: [], contacts: [], phoneColumnId: null };
    }

    const phoneColumnId = findPhoneColumnId(columns);
    const nameColumnId = findNameColumnId(columns);
    const contacts = [];
    const seen = new Set();
    const collectSnapshot = () => {
      const rows = getDataRows(headerInfo);
      collectContactsFromRows(rows, columns, phoneColumnId, nameColumnId, countryPrefix, messageText, seen, contacts);
    };

    collectSnapshot();

    const scroller = findTableScrollContainer(headerInfo);
    if (!scroller) return { columns, contacts, phoneColumnId };

    const startTop = scroller.scrollTop;

    try {
      scroller.scrollTop = 0;
      await sleep(TIMING.tableScrollDelayMs);
      collectSnapshot();

      let stableBottomRounds = 0;
      let previousHeight = scroller.scrollHeight;
      let previousCount = contacts.length;

      for (let i = 0; i < 180; i += 1) {
        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const step = Math.max(220, Math.floor(scroller.clientHeight * 0.85));
        const nextTop = Math.min(maxTop, scroller.scrollTop + step);
        scroller.scrollTop = nextTop;

        await sleep(TIMING.tableScrollDelayMs);
        collectSnapshot();

        const newMaxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const atBottom = scroller.scrollTop >= newMaxTop - 2;
        const heightChanged = Math.abs(scroller.scrollHeight - previousHeight) > 1;
        const countChanged = contacts.length !== previousCount;

        if (atBottom && !heightChanged && !countChanged) {
          stableBottomRounds += 1;
        } else {
          stableBottomRounds = 0;
        }

        previousHeight = scroller.scrollHeight;
        previousCount = contacts.length;

        if (stableBottomRounds >= 6) break;
      }

      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      await sleep(TIMING.tableScrollDelayMs);
      collectSnapshot();
    } finally {
      scroller.scrollTop = startTop;
    }

    return { columns, contacts, phoneColumnId };
  }

  function extractTableContacts(countryPrefix = DEFAULT_COUNTRY_CODE, messageText = "") {
    const headerInfo = findHeaderRow();
    if (!headerInfo) {
      return { columns: [], contacts: [], phoneColumnId: null };
    }

    const columns = buildColumns(headerInfo);
    if (!columns.length) {
      return { columns: [], contacts: [], phoneColumnId: null };
    }

    const phoneColumnId = findPhoneColumnId(columns);
    const nameColumnId = findNameColumnId(columns);

    const contacts = [];
    const seen = new Set();
    const rows = getDataRows(headerInfo);
    collectContactsFromRows(rows, columns, phoneColumnId, nameColumnId, countryPrefix, messageText, seen, contacts);

    return { columns, contacts, phoneColumnId };
  }

  function getPortalIdFromPath() {
    const match = String(location.pathname || "").match(/\/contacts\/(\d+)\//i);
    return match ? match[1] : "";
  }

  function getRecordIdFromPath() {
    const match = String(location.pathname || "").match(/\/record\/0-1\/(\d+)/i);
    return match ? match[1] : "";
  }

  function inferObjectKindFromPath() {
    const objectTypeMatch = String(location.pathname || "").match(/\/record\/0-(\d+)\//i);
    if (!objectTypeMatch) return "unknown";
    const objectTypeId = objectTypeMatch[1];
    if (objectTypeId === "1") return "contact";
    if (objectTypeId === "2") return "company";
    if (objectTypeId === "3") return "deal";
    return "record";
  }

  function isContactIndexPage() {
    const path = String(location.pathname || "");
    if (!/\/contacts\/\d+\//i.test(path)) return false;
    if (/\/record\/0-1\/\d+/i.test(path)) return false;
    return /\/objects\/0-1(?:\/|$)/i.test(path);
  }

  function isContactIndexRecordLink(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return false;
    const href = String(anchor.href || anchor.getAttribute("href") || "").trim();
    if (!extractContactRecordIdFromHref(href)) return false;

    const row = anchor.closest("tr, [role='row'], li, article, section, div");
    if (!(row instanceof Element)) return false;
    return !!extractRecordIdFromRow(row);
  }

  function ensureContactIndexNewTabStyles() {
    if (document.getElementById(CONTACT_INDEX_NEW_TAB_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = CONTACT_INDEX_NEW_TAB_STYLE_ID;
    style.textContent = `
      .cp-contact-index-avatar-action {
        position: relative;
        cursor: pointer;
      }

      .cp-contact-index-avatar-action::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 28px;
        height: 28px;
        transform: translate(-50%, -50%);
        border-radius: 999px;
        opacity: 0;
        pointer-events: none;
        background-color: #7c3aed;
        background-repeat: no-repeat;
        background-position: center;
        background-size: 12px 12px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M6 3.5H3.75A1.25 1.25 0 0 0 2.5 4.75v7.5A1.25 1.25 0 0 0 3.75 13.5h7.5a1.25 1.25 0 0 0 1.25-1.25V10' stroke='white' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M8.5 2.5h5v5' stroke='white' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M13.25 2.75 7 9' stroke='white' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);
        transition: opacity 120ms ease;
      }

      tr:hover .cp-contact-index-avatar-action,
      [role='row']:hover .cp-contact-index-avatar-action,
      .cp-contact-index-avatar-action:focus-visible {
        color: transparent !important;
        font-size: 0 !important;
        text-shadow: none !important;
      }

      tr:hover .cp-contact-index-avatar-action::after,
      [role='row']:hover .cp-contact-index-avatar-action::after,
      .cp-contact-index-avatar-action:focus-visible::after {
        opacity: 1;
      }

      .cp-contact-index-avatar-action:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px rgba(11, 114, 133, 0.18);
      }

      .cp-contact-index-phone-action-wrap {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .cp-active-contact-phone-action-wrap {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .cp-contact-index-whatsapp-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: 1px solid rgba(18, 140, 76, 0.22);
        border-radius: 999px;
        background: #25d366;
        color: #ffffff;
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(37, 211, 102, 0.28);
        transition: opacity 120ms ease, background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      }

      tr:hover .cp-contact-index-whatsapp-btn,
      [role='row']:hover .cp-contact-index-whatsapp-btn,
      .cp-contact-index-whatsapp-btn:focus-visible {
        opacity: 1;
        pointer-events: auto;
      }

      .cp-contact-index-whatsapp-btn:hover,
      .cp-contact-index-whatsapp-btn:focus-visible {
        background: #1fbe5d;
        border-color: rgba(18, 140, 76, 0.38);
        box-shadow: 0 4px 12px rgba(31, 190, 93, 0.34);
        transform: translateY(-1px);
        outline: none;
      }

      .cp-contact-index-whatsapp-btn svg {
        width: 17px;
        height: 17px;
        stroke: currentColor;
        fill: none;
        stroke-width: 1.7;
      }

      .cp-active-contact-whatsapp-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: 1px solid rgba(18, 140, 76, 0.22);
        border-radius: 999px;
        background: #25d366;
        color: #ffffff;
        cursor: pointer;
        pointer-events: auto;
        box-shadow: 0 2px 8px rgba(37, 211, 102, 0.28);
        transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
        flex: 0 0 auto;
      }

      .cp-active-contact-whatsapp-btn:hover,
      .cp-active-contact-whatsapp-btn:focus-visible {
        background: #1fbe5d;
        border-color: rgba(18, 140, 76, 0.38);
        box-shadow: 0 4px 12px rgba(31, 190, 93, 0.34);
        transform: translateY(-1px);
        outline: none;
      }

      .cp-active-contact-whatsapp-btn svg {
        width: 17px;
        height: 17px;
        stroke: currentColor;
        fill: none;
        stroke-width: 1.7;
      }

      .cp-phone-flag {
        width: 18px;
        height: 13.5px;
        border-radius: 2px;
        flex: 0 0 auto;
        vertical-align: middle;
        box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.12);
        cursor: default;
      }

      .cp-phone-flag-inline {
        display: inline-block;
        margin-right: 6px;
        vertical-align: -1px;
      }

      .cp-wa-inline {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: 9px;
        vertical-align: middle;
      }

      .cp-phone-flag-tooltip {
        position: fixed;
        z-index: 2147483647;
        transform: translate(-50%, -100%);
        padding: 4px 9px;
        border-radius: 6px;
        background: #1f2933;
        color: #ffffff;
        font-size: 12px;
        font-weight: 500;
        line-height: 1.35;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.3);
      }
    `;
    document.head.appendChild(style);
  }

  // One tooltip for every flag, fixed-position so HubSpot's overflow-hidden
  // table cells can't clip it. Shown instantly on hover — a native title
  // waits ~1s, which defeats "glance at the flag, read the country".
  let phoneFlagTooltipEl = null;

  function hidePhoneFlagTooltip() {
    if (!phoneFlagTooltipEl) return;
    phoneFlagTooltipEl.remove();
    phoneFlagTooltipEl = null;
  }

  function showPhoneFlagTooltip(flag) {
    if (!(flag instanceof Element) || !flag.isConnected) return;
    hidePhoneFlagTooltip();
    const label = String(flag.dataset.cpCountry || "").trim();
    if (!label) return;
    const rect = flag.getBoundingClientRect();
    const tooltip = document.createElement("div");
    tooltip.className = "cp-phone-flag-tooltip";
    tooltip.textContent = label;
    tooltip.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    if (rect.top < 40) {
      // No room above (first table row): show below the flag instead.
      tooltip.style.top = `${Math.round(rect.bottom + 6)}px`;
      tooltip.style.transform = "translate(-50%, 0)";
    } else {
      tooltip.style.top = `${Math.round(rect.top - 6)}px`;
    }
    document.body.appendChild(tooltip);
    phoneFlagTooltipEl = tooltip;
  }

  // Scrolling moves the flag out from under a fixed tooltip without firing
  // mouseleave, so drop it as soon as anything scrolls.
  window.addEventListener("scroll", hidePhoneFlagTooltip, true);

  // Country for a number's flag, or null when the feature can't or shouldn't
  // draw one: feature off, country excluded in settings, or the number has no
  // "+" prefix (its country would just echo the rep's default prefix).
  function resolvePhoneFlagCountry(rawPhone) {
    if (!contactTemplateState.phoneFlagsEnabled) return null;
    const resolver = globalThis.ContactPilotShared?.phoneCountry;
    if (typeof resolver !== "function") return null;
    const country = resolver(rawPhone);
    if (!country) return null;
    if (contactTemplateState.phoneFlagsExcludedIsos.includes(country.iso)) return null;
    return country;
  }

  function createPhoneFlagElement(country) {
    const flag = document.createElement("img");
    flag.className = "cp-phone-flag";
    flag.src = chrome.runtime.getURL(`vendor/flags/${country.iso}.svg`);
    flag.alt = country.label;
    flag.dataset.cpIso = country.iso;
    flag.dataset.cpCountry = country.label;
    flag.draggable = false;
    flag.addEventListener("mouseenter", () => showPhoneFlagTooltip(flag));
    flag.addEventListener("mouseleave", hidePhoneFlagTooltip);
    return flag;
  }

  // Idempotent per container: keeps an existing flag when the country still
  // matches, replaces or removes it otherwise. The flag sits first inside the
  // phone action wrap (flag, number, WhatsApp button) when one exists.
  function applyPhoneFlagDecoration(container, rawPhone) {
    if (!(container instanceof Element)) return;
    const existing = container.querySelector(".cp-phone-flag");
    const country = resolvePhoneFlagCountry(rawPhone);
    if (!country) {
      if (existing) existing.remove();
      return;
    }
    if (existing instanceof Element) {
      if (existing.dataset.cpIso === country.iso) return;
      existing.remove();
    }
    const wrapSelector = ".cp-contact-index-phone-action-wrap, .cp-active-contact-phone-action-wrap";
    const wrapper = container.matches(wrapSelector) ? container : container.querySelector(wrapSelector);
    (wrapper || container).prepend(createPhoneFlagElement(country));
  }

  async function openContactIndexLinkInNewTab(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = String(anchor.href || anchor.getAttribute("href") || "").trim();
    if (!href) return;
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.OPEN_OR_FOCUS_CONTACT_TAB,
      url: href
    });
    if (response === undefined || response?.ok) return;
    throw new Error(String(response?.error || "Could not open contact tab."));
  }

  async function openOrReuseWhatsappTab(url) {
    const targetUrl = String(url || "").trim();
    if (!targetUrl) return;

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.OPEN_OR_REUSE_WHATSAPP_TAB,
      url: targetUrl
    });
    if (response === undefined || response?.ok) return;
    throw new Error(String(response?.error || "Could not open WhatsApp tab."));
  }

  function buildContactIndexWhatsappUrl(rawPhone) {
    const phoneDigits = normalizePhone(rawPhone, contactTemplateState.countryPrefix) || "";
    if (!phoneDigits) return "";
    return `https://web.whatsapp.com/send/?phone=${phoneDigits}&type=phone_number`;
  }

  function findContactIndexAnchorInScope(scope) {
    if (!(scope instanceof Element)) return null;
    const anchors = scope instanceof HTMLAnchorElement ? [scope, ...scope.querySelectorAll("a[href]")] : Array.from(scope.querySelectorAll("a[href]"));
    for (const anchor of anchors) {
      if (anchor instanceof HTMLAnchorElement && isContactIndexRecordLink(anchor)) {
        return anchor;
      }
    }
    return null;
  }

  function findContactIndexNameCell(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    return anchor.closest("td, [role='gridcell'], [role='cell']") || anchor.parentElement;
  }

  function isLikelyContactIndexAvatarNode(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20 || rect.width > 64 || rect.height > 64) return false;
    // Avatars are roughly square; this filters out the wide name/text nodes
    // without depending on the avatar having text.
    const aspectRatio = rect.width / rect.height;
    if (aspectRatio < 0.7 || aspectRatio > 1.4) return false;
    // Initials avatars carry short text; icon/silhouette avatars (used when a
    // name contains an emoji, so HubSpot can't derive initials) have none.
    // Accept both — only reject nodes with too much text to be an avatar.
    const text = cleanText(element.textContent || "");
    if (text.length > 4) return false;
    return true;
  }

  function findContactIndexInlineContainer(anchor, nameCell) {
    const cell = nameCell instanceof Element ? nameCell : findContactIndexNameCell(anchor);
    if (!(cell instanceof Element) || !(anchor instanceof HTMLAnchorElement)) return cell;

    let current = anchor.parentElement;
    while (current && current !== cell) {
      const children = Array.from(current.children);
      const anchorChild = children.find((child) => child === anchor || child.contains(anchor));
      if (anchorChild && children.length >= 2) {
        const avatarSibling = children.find((child) => child !== anchorChild && isLikelyContactIndexAvatarNode(child));
        if (avatarSibling) return current;
      }
      current = current.parentElement;
    }

    return cell;
  }

  function findContactIndexAvatarNode(container, anchor) {
    if (!(container instanceof Element) || !(anchor instanceof HTMLAnchorElement)) return null;
    const children = Array.from(container.children);
    const anchorChild = children.find((child) => child === anchor || child.contains(anchor)) || anchor;
    return children.find((child) => child !== anchorChild && isLikelyContactIndexAvatarNode(child)) || null;
  }

  function decorateContactIndexAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.dataset.cpInlineNewTabEnhanced === "1") return;
    if (!isContactIndexRecordLink(anchor)) return;

    const nameCell = findContactIndexNameCell(anchor);
    if (!(nameCell instanceof Element)) return;

    const existingInCell = nameCell.querySelector(".cp-contact-index-inline-open-btn");
    if (existingInCell instanceof HTMLButtonElement) {
      anchor.dataset.cpInlineNewTabEnhanced = "1";
      return;
    }

    const container = findContactIndexInlineContainer(anchor, nameCell);
    if (!(container instanceof Element)) return;

    const avatarNode = findContactIndexAvatarNode(container, anchor);
    if (avatarNode instanceof Element) {
      avatarNode.classList.add("cp-contact-index-avatar-action");
      avatarNode.setAttribute("role", "button");
      avatarNode.setAttribute("tabindex", "0");
      avatarNode.setAttribute("aria-label", "Open contact in new tab");
      avatarNode.setAttribute("title", "Open in new tab");
      avatarNode.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await openContactIndexLinkInNewTab(anchor);
        } catch (_error) {}
      });
      avatarNode.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        try {
          await openContactIndexLinkInNewTab(anchor);
        } catch (_error) {}
      });
      anchor.dataset.cpInlineNewTabEnhanced = "1";
    }
  }

  function getContactIndexPhoneColumn() {
    const headerInfo = findHeaderRow();
    if (!headerInfo) return null;
    const columns = buildColumns(headerInfo);
    if (!columns.length) return null;
    const phoneColumnId = findPhoneColumnId(columns);
    if (!phoneColumnId) return null;
    return columns.find((column) => column.id === phoneColumnId) || null;
  }

  function findContactIndexPhoneContentElement(phoneCell) {
    if (!(phoneCell instanceof Element)) return null;
    const candidates = Array.from(phoneCell.querySelectorAll("*")).filter((element) => {
      if (!(element instanceof Element)) return false;
      if (element.classList.contains("cp-contact-index-whatsapp-btn")) return false;
      const text = cleanText(element.textContent || "");
      return !!text && PHONE_PATTERN.test(text);
    });
    candidates.sort((a, b) => cleanText(a.textContent || "").length - cleanText(b.textContent || "").length);
    return candidates[0] || phoneCell.firstElementChild || null;
  }

  function createContactIndexWhatsappButton(waUrl) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cp-contact-index-whatsapp-btn";
    button.setAttribute("aria-label", "Open number in WhatsApp");
    button.setAttribute("title", "Open in WhatsApp");
    button.innerHTML = whatsappIcon();
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await openOrReuseWhatsappTab(waUrl);
    });
    return button;
  }

  function createActiveContactWhatsappButton(waUrl) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cp-active-contact-whatsapp-btn";
    button.dataset.waUrl = waUrl;
    button.setAttribute("aria-label", "Open number in WhatsApp");
    button.setAttribute("title", "WhatsApp templates");
    button.innerHTML = whatsappIcon();
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openWaTemplatePopover(button);
    });
    return button;
  }

  function decorateContactIndexPhoneCell(phoneCell) {
    if (!(phoneCell instanceof Element)) return;

    const rawPhone = cleanPhoneCandidate(phoneCell.textContent || "");

    if (!phoneCell.querySelector(".cp-contact-index-whatsapp-btn")) {
      const waUrl = buildContactIndexWhatsappUrl(rawPhone);
      if (waUrl) {
        const contentElement = findContactIndexPhoneContentElement(phoneCell);
        const button = createContactIndexWhatsappButton(waUrl);

        if (contentElement instanceof Element && !contentElement.classList.contains("cp-contact-index-phone-action-wrap")) {
          const wrapper = document.createElement("span");
          wrapper.className = "cp-contact-index-phone-action-wrap";
          contentElement.parentNode?.insertBefore(wrapper, contentElement);
          wrapper.appendChild(contentElement);
          wrapper.appendChild(button);
        } else {
          phoneCell.appendChild(button);
        }
      }
    }

    // After the button pass so the flag lands inside the action wrap it
    // creates, and independent of it so cells decorated on an earlier sweep
    // still gain or shed flags when the setting changes.
    applyPhoneFlagDecoration(phoneCell, rawPhone);
  }

  function enhanceContactIndexInlineButtons() {
    if (!isContactIndexPage()) return;
    ensureContactIndexNewTabStyles();
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    for (const anchor of anchors) {
      decorateContactIndexAnchor(anchor);
    }

    const phoneColumn = getContactIndexPhoneColumn();
    const headerInfo = findHeaderRow();
    if (!phoneColumn || !headerInfo) return;
    const rows = getDataRows(headerInfo);
    for (const row of rows) {
      if (!(row instanceof Element)) continue;
      const cells = Array.from(row.querySelectorAll("td, [role='gridcell']"));
      const phoneCell = cells[phoneColumn.sourceIndex] || null;
      decorateContactIndexPhoneCell(phoneCell);
    }
  }

  // On record pages HubSpot renders each phone property as a visible text
  // span plus a separate textless tel: icon button, so flags anchor on the
  // text: any leaf element whose entire content is an international number
  // gets a flag inline before it. Phone, Mobile phone and WhatsApp phone all
  // light up without per-field wiring.
  const PHONE_TEXT_ONLY_PATTERN = /^\+[\d\s().-]{6,}\d$/;

  // HubSpot re-renders the same value as either <a>+44…</a> or
  // <a><span>+44…</span></a>, so a flag added on one pass can end up a level
  // away from the leaf the next pass finds. Collect the flags on the whole
  // chain of ancestors that still hold nothing but this number, so a shape
  // change can't stack a second flag on the same value.
  function findPhoneTextFlags(node, text) {
    return collectPhoneTextMarks(node, text, "cp-phone-flag");
  }

  // WhatsApp buttons anchor on the same always-visible number text the flags
  // use: HubSpot's tel: link lives in the property's hover cluster (next to
  // Details/edit), so anything anchored there only shows on hover.
  //
  // Flags and buttons interleave around the number, and a React reshape can
  // strand an old [flag][button] pair one level out from the new leaf. Each
  // chain level therefore scans BOTH directions across runs of our own marks
  // (either kind); a single-kind, single-direction walk cannot see a stale
  // flag sitting behind a stale button. Collection starts at the leaf, so
  // dedup keeps the mark nearest the number and drops stranded outer ones.
  function isCpPhoneMark(el) {
    return (
      el instanceof Element &&
      (el.classList.contains("cp-phone-flag") || el.classList.contains("cp-active-contact-whatsapp-btn"))
    );
  }

  function collectPhoneTextMarks(node, text, matchClass) {
    const found = [];
    let current = node;
    while (current && current !== document.body) {
      for (const dir of ["previousElementSibling", "nextElementSibling"]) {
        let sibling = current[dir];
        while (isCpPhoneMark(sibling)) {
          if (sibling.classList.contains(matchClass)) found.push(sibling);
          sibling = sibling[dir];
        }
      }
      const parent = current.parentElement;
      if (!parent || cleanText(parent.textContent || "") !== text) break;
      current = parent;
    }
    return found;
  }

  function findPhoneTextWaButtons(node, text) {
    return collectPhoneTextMarks(node, text, "cp-active-contact-whatsapp-btn");
  }

  function ensureInlinePhoneWaButton(node, text) {
    const waUrl = buildContactIndexWhatsappUrl(text);
    const existing = findPhoneTextWaButtons(node, text);
    if (!waUrl) {
      for (const button of existing) button.remove();
      return;
    }

    // Position is part of correctness: only the button sitting immediately
    // after the number survives, so a stale left-side survivor can never win.
    let kept = null;
    for (const button of existing) {
      if (!kept && button === node.nextElementSibling && button.dataset.waUrl === waUrl) kept = button;
    }
    for (const button of existing) {
      if (button !== kept) button.remove();
    }
    if (kept) return;

    const button = createActiveContactWhatsappButton(waUrl);
    button.classList.add("cp-wa-inline");
    node.parentNode?.insertBefore(button, node.nextSibling);
  }

  function decorateActiveContactPhoneTextFlags() {
    if (inferObjectKindFromPath() !== "contact" || !getRecordIdFromPath()) return;
    // Toggle-off removal is handled centrally in applyContactEnhancerSettings.
    const flagsEnabled = contactTemplateState.phoneFlagsEnabled;

    for (const node of document.querySelectorAll("span, a, p, div")) {
      if (node.childElementCount !== 0) continue;
      const raw = node.textContent || "";
      // Cheap guards first — this sweep runs on every enhancer pass.
      if (raw.length > 32 || raw.indexOf("+") === -1) continue;
      const text = cleanText(raw);
      if (!PHONE_TEXT_ONLY_PATTERN.test(text)) continue;

      ensureInlinePhoneWaButton(node, text);
      if (!flagsEnabled) continue;

      const country = resolvePhoneFlagCountry(text);
      const existing = findPhoneTextFlags(node, text);
      if (!country) {
        for (const flag of existing) flag.remove();
        continue;
      }

      // Keep only a flag immediately before the number with the right
      // country; anything elsewhere in the chain is a stale survivor.
      let kept = null;
      for (const flag of existing) {
        if (!kept && flag === node.previousElementSibling && flag.dataset.cpIso === country.iso) kept = flag;
      }
      for (const flag of existing) {
        if (flag !== kept) flag.remove();
      }
      if (kept) continue;

      const flag = createPhoneFlagElement(country);
      flag.classList.add("cp-phone-flag-inline");
      node.parentNode?.insertBefore(flag, node);
    }
  }

  // --- Sidebar declutter (record pages) ---
  // HubSpot's left sidebar buries the handful of filled properties under a
  // wall of empty "--" rows across dozens of cards. This injects a filter
  // input plus a "Hide empty" toggle above the property cards. Anchored on
  // HubSpot's own test hooks (profile-properties-list / property-input-*),
  // which survive their CSS class churn.
  const SIDEBAR_EMPTY_VALUE_PATTERN = /^[-–—]{1,2}$/;
  // HubSpot moved this hook from data-selenium-test to data-test-id in the
  // 2026 record-page redesign; match both so either markup keeps working.
  const SIDEBAR_PROPERTIES_LIST_SELECTOR =
    "[data-test-id='profile-properties-list'], [data-selenium-test='profile-properties-list']";

  const sidebarDeclutterState = {
    hideEmpty: false,
    searchQuery: "",
    searchInputValue: "",
    searchDebounceId: 0,
    lastUrl: "",
    autoExpandedCardIds: new Set()
  };

  function isRecordPageForDeclutter() {
    return /\/record\/0-\d+\/\d+/i.test(String(location.pathname || ""));
  }

  function getLeftSidebarElement() {
    return (
      document.querySelector("[data-selenium-test='left-sidebar']") ||
      document.querySelector("[data-test-id='left-sidebar']")
    );
  }

  function ensureSidebarDeclutterStyles() {
    if (document.getElementById(SIDEBAR_DECLUTTER_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SIDEBAR_DECLUTTER_STYLE_ID;
    style.textContent = `
      .cp-sd-hidden {
        display: none !important;
      }

      #${SIDEBAR_DECLUTTER_BAR_ID} {
        position: sticky;
        top: 0;
        z-index: 8;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: #f5f8fa;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      }

      .cp-sd-input-wrap {
        position: relative;
        flex: 1 1 auto;
        min-width: 0;
      }

      .cp-sd-input-wrap svg {
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 13px;
        height: 13px;
        stroke: #7c98b6;
        fill: none;
        stroke-width: 2;
        pointer-events: none;
      }

      .cp-sd-input {
        width: 100%;
        height: 28px;
        box-sizing: border-box;
        padding: 0 26px 0 27px;
        border: 1px solid #cbd6e2;
        border-radius: 3px;
        background: #ffffff;
        color: #33475b;
        font-size: 13px;
        line-height: 26px;
        outline: none;
      }

      .cp-sd-input:focus {
        border-color: rgba(0, 208, 228, 0.5);
        box-shadow: 0 0 4px 1px rgba(0, 208, 228, 0.3);
      }

      .cp-sd-input::placeholder {
        color: #7c98b6;
      }

      .cp-sd-input::-webkit-search-cancel-button,
      .cp-sd-input::-webkit-search-decoration {
        -webkit-appearance: none;
        appearance: none;
      }

      .cp-sd-clear {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        display: none;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: #7c98b6;
        cursor: pointer;
      }

      .cp-sd-clear:hover {
        background: rgba(124, 152, 182, 0.18);
        color: #33475b;
      }

      .cp-sd-clear svg {
        width: 11px;
        height: 11px;
        stroke: currentColor;
        fill: none;
        stroke-width: 2;
        stroke-linecap: round;
      }

      .cp-sd-input-wrap.cp-sd-has-value .cp-sd-clear {
        display: inline-flex;
      }

      .cp-sd-toggle {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 6px;
        min-height: 28px;
        padding: 0 2px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: #33475b;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      }

      .cp-sd-toggle:focus-visible {
        outline: 2px solid #7c3aed;
        outline-offset: 2px;
      }

      .cp-sd-toggle-track {
        position: relative;
        flex: 0 0 28px;
        height: 16px;
        border-radius: 999px;
        background: #64748b;
      }

      .cp-sd-toggle-track::after {
        position: absolute;
        inset: 2px auto auto 2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ffffff;
        content: "";
      }

      .cp-sd-toggle[aria-checked='true'] .cp-sd-toggle-track {
        background: #7c3aed;
      }

      .cp-sd-toggle[aria-checked='true'] .cp-sd-toggle-track::after {
        transform: translateX(12px);
      }

      /* Every card repeats the same "Actions" dropdown; keep it for the card
         being pointed at (or keyboard-focused) and fade out the rest. */
      [data-selenium-test='left-sidebar'] [data-selenium-test='crm-card-actions'] {
        opacity: 0;
        transition: opacity 100ms ease;
      }

      [data-selenium-test='left-sidebar'] [data-test-id^='card-wrapper-']:hover [data-selenium-test='crm-card-actions'],
      [data-selenium-test='left-sidebar'] [data-test-id^='card-wrapper-']:focus-within [data-selenium-test='crm-card-actions'] {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function findCardCollapseToggle(card, expanded) {
    if (!(card instanceof Element)) return null;
    const want = expanded ? "true" : "false";
    return (
      Array.from(card.querySelectorAll(`[role='button'][aria-expanded='${want}']`)).find((toggle) =>
        toggle.querySelector("[data-selenium-test='crm-card-title']")
      ) || null
    );
  }

  // Collapsed cards render no property rows, so a search can only see what is
  // expanded. Expand everything when a search starts, remember which cards we
  // opened, and fold exactly those back when the search is cleared.
  function autoExpandSidebarCardsForSearch(sidebar) {
    for (const card of sidebar.querySelectorAll("[data-test-id^='card-wrapper-']")) {
      const toggle = findCardCollapseToggle(card, false);
      if (!toggle) continue;
      const cardId = card.getAttribute("data-test-id") || "";
      if (cardId) sidebarDeclutterState.autoExpandedCardIds.add(cardId);
      toggle.click();
    }
  }

  function restoreAutoExpandedSidebarCards(sidebar) {
    for (const cardId of sidebarDeclutterState.autoExpandedCardIds) {
      const card = sidebar.querySelector(`[data-test-id="${CSS.escape(cardId)}"]`);
      const toggle = findCardCollapseToggle(card, true);
      if (toggle) toggle.click();
    }
    sidebarDeclutterState.autoExpandedCardIds.clear();
  }

  function applySidebarDeclutterFilters(sidebar) {
    const query = sidebarDeclutterState.searchQuery;
    // A search shows matches even when their value is empty; otherwise typing a
    // field's name to fill it would fight the hide-empty toggle.
    const hideEmpty = sidebarDeclutterState.hideEmpty && !query;

    // Cards fold back to a title-only shell when re-collapsed; a shell must
    // never stay hidden by a decision made against its old rows.
    for (const card of sidebar.querySelectorAll("[data-test-id^='card-wrapper-'].cp-sd-hidden")) {
      if (!card.querySelector(SIDEBAR_PROPERTIES_LIST_SELECTOR)) {
        card.classList.remove("cp-sd-hidden");
      }
    }

    for (const list of sidebar.querySelectorAll(SIDEBAR_PROPERTIES_LIST_SELECTOR)) {
      let visibleCount = 0;
      for (const row of Array.from(list.children)) {
        if (!(row instanceof Element)) continue;
        const valueEl = row.querySelector("[data-selenium-test^='property-input-']");
        const valueText = cleanText(valueEl ? valueEl.textContent || "" : "");
        const isEmpty = !valueText || SIDEBAR_EMPTY_VALUE_PATTERN.test(valueText);

        let show = true;
        if (query) {
          const propertyName = String(valueEl?.getAttribute("data-selenium-test") || "")
            .replace(/^property-input-/, "")
            .replace(/_/g, " ");
          const rowText = cleanText(row.textContent || "").toLowerCase();
          show = rowText.includes(query) || propertyName.includes(query);
        } else if (hideEmpty) {
          show = !isEmpty;
        }

        row.classList.toggle("cp-sd-hidden", !show);
        if (show) visibleCount += 1;
      }

      const card = list.closest("[data-test-id^='card-wrapper-']");
      if (card) {
        card.classList.toggle("cp-sd-hidden", (query || hideEmpty) && visibleCount === 0);
      }
    }
  }

  function syncSidebarDeclutterClearButton(inputWrap, input) {
    if (!(inputWrap instanceof Element)) return;
    inputWrap.classList.toggle("cp-sd-has-value", !!(input instanceof HTMLInputElement && input.value));
  }

  function syncSidebarDeclutterToggleButton(button) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.setAttribute("aria-checked", String(!sidebarDeclutterState.hideEmpty));
  }

  function handleSidebarDeclutterSearchInput(rawValue) {
    const previousQuery = sidebarDeclutterState.searchQuery;
    sidebarDeclutterState.searchInputValue = String(rawValue || "");
    sidebarDeclutterState.searchQuery = cleanText(sidebarDeclutterState.searchInputValue).toLowerCase();

    const sidebar = getLeftSidebarElement();
    if (sidebar) {
      if (sidebarDeclutterState.searchQuery && !previousQuery) {
        autoExpandSidebarCardsForSearch(sidebar);
      } else if (!sidebarDeclutterState.searchQuery && previousQuery) {
        restoreAutoExpandedSidebarCards(sidebar);
      }
    }

    if (sidebarDeclutterState.searchDebounceId) {
      clearTimeout(sidebarDeclutterState.searchDebounceId);
    }
    sidebarDeclutterState.searchDebounceId = setTimeout(() => {
      sidebarDeclutterState.searchDebounceId = 0;
      const currentSidebar = getLeftSidebarElement();
      if (currentSidebar) applySidebarDeclutterFilters(currentSidebar);
    }, 120);
  }

  function createSidebarDeclutterBar() {
    const bar = document.createElement("div");
    bar.id = SIDEBAR_DECLUTTER_BAR_ID;

    const inputWrap = document.createElement("div");
    inputWrap.className = "cp-sd-input-wrap";
    inputWrap.innerHTML =
      "<svg viewBox='0 0 16 16' aria-hidden='true'><circle cx='7' cy='7' r='4.5'/><path d='M10.5 10.5 14 14' stroke-linecap='round'/></svg>";

    const input = document.createElement("input");
    input.className = "cp-sd-input";
    input.type = "search";
    input.placeholder = "Filter properties";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Filter sidebar properties");
    input.value = sidebarDeclutterState.searchInputValue;
    input.addEventListener("input", () => {
      handleSidebarDeclutterSearchInput(input.value);
      syncSidebarDeclutterClearButton(inputWrap, input);
    });
    inputWrap.appendChild(input);

    const clear = document.createElement("button");
    clear.className = "cp-sd-clear";
    clear.type = "button";
    clear.setAttribute("aria-label", "Clear filter");
    clear.setAttribute("title", "Clear filter");
    clear.innerHTML = "<svg viewBox='0 0 12 12' aria-hidden='true'><path d='M2 2 10 10M10 2 2 10'/></svg>";
    clear.addEventListener("click", () => {
      input.value = "";
      handleSidebarDeclutterSearchInput("");
      syncSidebarDeclutterClearButton(inputWrap, input);
      input.focus();
    });
    inputWrap.appendChild(clear);
    syncSidebarDeclutterClearButton(inputWrap, input);

    const toggle = document.createElement("button");
    toggle.className = "cp-sd-toggle";
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.title = "Show properties without a value";
    toggle.innerHTML = "<span>Show empty</span><span class='cp-sd-toggle-track' aria-hidden='true'></span>";
    syncSidebarDeclutterToggleButton(toggle);
    toggle.addEventListener("click", () => {
      sidebarDeclutterState.hideEmpty = !sidebarDeclutterState.hideEmpty;
      syncSidebarDeclutterToggleButton(toggle);
      try {
        chrome.storage.local.set({ [SIDEBAR_HIDE_EMPTY_LOCAL_KEY]: sidebarDeclutterState.hideEmpty });
      } catch (_error) {
        // Ignore storage write failures.
      }
      const currentSidebar = getLeftSidebarElement();
      if (currentSidebar) applySidebarDeclutterFilters(currentSidebar);
    });

    bar.appendChild(inputWrap);
    bar.appendChild(toggle);
    return bar;
  }

  function ensureSidebarDeclutterBar(sidebar) {
    const existing = document.getElementById(SIDEBAR_DECLUTTER_BAR_ID);
    if (existing && sidebar.contains(existing)) {
      syncSidebarDeclutterToggleButton(existing.querySelector(".cp-sd-toggle"));
      const input = existing.querySelector(".cp-sd-input");
      if (input instanceof HTMLInputElement && document.activeElement !== input && input.value !== sidebarDeclutterState.searchInputValue) {
        input.value = sidebarDeclutterState.searchInputValue;
      }
      syncSidebarDeclutterClearButton(existing.querySelector(".cp-sd-input-wrap"), input);
      return;
    }
    if (existing) existing.remove();

    // Sit below the record highlight (photo/name/actions), above the cards.
    const bar = createSidebarDeclutterBar();
    let anchor = null;
    for (const card of sidebar.querySelectorAll("[data-test-id^='card-wrapper-']")) {
      const cardId = card.getAttribute("data-test-id") || "";
      if (!cardId.includes("OBJECT_HIGHLIGHT")) {
        anchor = card;
        break;
      }
    }
    if (anchor?.parentElement) {
      anchor.parentElement.insertBefore(bar, anchor);
    } else {
      sidebar.insertBefore(bar, sidebar.firstChild);
    }
  }

  function removeSidebarDeclutter() {
    document.getElementById(SIDEBAR_DECLUTTER_BAR_ID)?.remove();
    // Keep the filter and its hover-only card rules scoped to record pages.
    document.getElementById(SIDEBAR_DECLUTTER_STYLE_ID)?.remove();
    for (const el of document.querySelectorAll(".cp-sd-hidden")) {
      el.classList.remove("cp-sd-hidden");
    }
  }

  function enhanceSidebarDeclutter() {
    if (location.href !== sidebarDeclutterState.lastUrl) {
      // Route change: a stale filter silently hiding fields on the next record
      // would look like data loss, so search state resets per record.
      sidebarDeclutterState.lastUrl = location.href;
      sidebarDeclutterState.searchQuery = "";
      sidebarDeclutterState.searchInputValue = "";
      sidebarDeclutterState.autoExpandedCardIds.clear();
    }

    if (!isRecordPageForDeclutter()) {
      removeSidebarDeclutter();
      return;
    }
    const sidebar = getLeftSidebarElement();
    if (!sidebar) return;

    ensureSidebarDeclutterStyles();
    ensureSidebarDeclutterBar(sidebar);
    applySidebarDeclutterFilters(sidebar);
  }

  function loadSidebarDeclutterLocalState() {
    try {
      chrome.storage.local.get(SIDEBAR_HIDE_EMPTY_LOCAL_KEY, (result) => {
        if (chrome.runtime.lastError) return;
        sidebarDeclutterState.hideEmpty = result?.[SIDEBAR_HIDE_EMPTY_LOCAL_KEY] === true;
        scheduleContactEnhancers();
      });
    } catch (_error) {
      // Ignore storage read failures.
    }
  }

  // --- Composer template search ---
  const composerTemplateSearchState = {
    refreshKicked: false,
    kinds: {
      email: {
        query: "",
        open: false,
        activeIndex: 0,
        visibleTemplateIds: [],
        busy: false,
        dialog: null,
        picker: null,
        outsideClickHandler: null
      },
      note: {
        query: "",
        open: false,
        activeIndex: 0,
        visibleTemplateIds: [],
        busy: false,
        dialog: null,
        picker: null,
        outsideClickHandler: null
      }
    }
  };

  // Per-kind wiring: which dialog hosts the row, which templates it offers,
  // and how a pick lands. The apply functions fill the open editor without
  // submitting anything.
  // HubSpot's own template library, read through the same internal search the
  // composer's "Select template" modal uses. Same-origin from the content
  // script, so the session cookie plus the CSRF header is all it needs.
  // Unpublished API: every failure falls back to Contact Point templates only.
  const HUBSPOT_TEMPLATE_CACHE_MS = 5 * 60 * 1000;
  const hubspotTemplateState = { items: [], fetchedAt: 0, inFlight: null, portalId: "" };

  function readBrowserCookie(name) {
    for (const part of String(document.cookie || "").split("; ")) {
      const idx = part.indexOf("=");
      if (idx > 0 && part.slice(0, idx) === name) return part.slice(idx + 1);
    }
    return "";
  }

  function getHubSpotPortalId() {
    const path = String(location.pathname || "");
    const match = path.match(/\/contacts\/(\d+)\//) || path.match(/^\/[a-z0-9-]+\/(\d{4,})(?:\/|$)/i);
    return match ? match[1] : "";
  }

  async function fetchHubSpotTemplates() {
    const portalId = getHubSpotPortalId();
    const csrf = readBrowserCookie("hubspotapi-csrf");
    if (!portalId || !csrf) return [];

    const res = await fetch(`/api/salescontentsearch/v2/search?portalId=${encodeURIComponent(portalId)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-HubSpot-CSRF-hubspotapi": csrf },
      // The whole library comes back well under one page, so this is a single
      // request and all filtering happens locally.
      body: JSON.stringify({ query: "", offset: 0, limit: 500 })
    });
    if (!res.ok) throw new Error(`HubSpot template search failed (${res.status})`);

    const data = await res.json();
    return (data?.results || [])
      .filter((row) => String(row?.contentType || "") === "TEMPLATE")
      .map((row) => ({
        id: `hubspot-${row.contentId}`,
        contentId: row.contentId,
        name: cleanText(row.name || ""),
        source: "hubspot"
      }))
      .filter((template) => template.name);
  }

  function refreshHubSpotTemplates() {
    const portalId = getHubSpotPortalId();
    if (hubspotTemplateState.portalId !== portalId) {
      Object.assign(hubspotTemplateState, { portalId, items: [], fetchedAt: 0, inFlight: null });
    }
    if (hubspotTemplateState.inFlight) return;
    const fresh = Date.now() - hubspotTemplateState.fetchedAt < HUBSPOT_TEMPLATE_CACHE_MS;
    if (fresh && hubspotTemplateState.items.length) return;

    const request = fetchHubSpotTemplates()
      .then((items) => {
        if (hubspotTemplateState.inFlight !== request) return;
        hubspotTemplateState.items = items;
      })
      .catch(() => {
        // The Contact Point library remains available when HubSpot search fails.
      })
      .finally(() => {
        if (hubspotTemplateState.inFlight !== request) return;
        hubspotTemplateState.fetchedAt = Date.now();
        hubspotTemplateState.inFlight = null;
        void refreshComposerFavorites("email");
      });
    hubspotTemplateState.inFlight = request;
  }

  async function fetchHubSpotTemplateDetail(contentId) {
    const portalId = getHubSpotPortalId();
    const csrf = readBrowserCookie("hubspotapi-csrf");
    if (!portalId || !csrf || !contentId) return null;

    const res = await fetch(
      `/api/sales-templates/v1/templates/${encodeURIComponent(contentId)}?portalId=${encodeURIComponent(portalId)}`,
      { credentials: "include", headers: { "X-HubSpot-CSRF-hubspotapi": csrf } }
    );
    if (!res.ok) return null;
    return res.json();
  }

  function findEmailSenderName(dialog) {
    // The From label and the name are sibling elements, so textContent joins
    // them with no space between: "FromSerdar Domurcuk (email)".
    const match = elementText(dialog).match(/From\s*([^()]{2,60})\(/);
    return match ? cleanText(match[1]) : "";
  }

  // The record's full property set, straight from HubSpot — templates token
  // on internal property names (contact.kurs_ba_lang_tarihi), which the
  // sidebar labels can't recover. A property absent here is genuinely unset,
  // so rendering it blank matches what HubSpot's own insert produces.
  async function fetchHubSpotContactProperties(recordId) {
    const portalId = getHubSpotPortalId();
    const csrf = readBrowserCookie("hubspotapi-csrf");
    if (!portalId || !csrf || !recordId) return null;

    const res = await fetch(
      `/api/inbounddb-objects/v1/crm-objects/0-1/${encodeURIComponent(recordId)}?portalId=${encodeURIComponent(
        portalId
      )}&allPropertiesFetchMode=latest_version`,
      { credentials: "include", headers: { "X-HubSpot-CSRF-hubspotapi": csrf } }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const map = {};
    for (const [name, prop] of Object.entries(data?.properties || {})) {
      const value = prop?.versions?.[0]?.value;
      if (value !== undefined && value !== null) map[String(name).toLowerCase()] = String(value);
    }
    return map;
  }

  // HubSpot's contact property list: internal name, label, type and dropdown
  // options. Used to print dropdown labels ("Hanım", not "Kadin") and, from the
  // website's Fields page, to pick properties for templates. Read through the
  // rep's own HubSpot session; kept slim and cached per account.
  const HUBSPOT_PROPERTY_DEFS_PREFIX = "hubspotPropertyDefs::";
  const hubspotPropertyDefsState = { portalId: "", fetchedAt: 0, defs: null, inFlight: null };

  function slimHubSpotPropertyDefinitions(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const defs = [];
    for (const entry of source) {
      const prop = entry?.property || entry;
      const name = cleanText(prop?.name || "").toLowerCase();
      if (!name || prop?.deleted === true) continue;
      defs.push({
        name,
        label: cleanText(prop?.label || "") || name,
        type: cleanText(prop?.type || ""),
        fieldType: cleanText(prop?.fieldType || ""),
        group: cleanText(prop?.groupName || ""),
        hidden: prop?.hidden === true,
        hubspotDefined: prop?.hubspotDefined === true,
        options: (Array.isArray(prop?.options) ? prop.options : [])
          .filter((option) => option && option.hidden !== true)
          .map((option) => ({ value: String(option.value ?? ""), label: cleanText(option.label || "") }))
      });
    }
    return defs;
  }

  async function fetchHubSpotPropertyDefinitions(options = {}) {
    const portalId = getHubSpotPortalId();
    const csrf = readBrowserCookie("hubspotapi-csrf");
    if (!portalId || !csrf) return null;

    const ttlMs = Number(TIMING.hubspotPropertyDefsCacheMs || 6 * 60 * 60 * 1000);
    const fresh = (fetchedAt) => Date.now() - Number(fetchedAt || 0) < ttlMs;
    const state = hubspotPropertyDefsState;
    if (!options.force && state.portalId === portalId && state.defs && fresh(state.fetchedAt)) return state.defs;
    if (state.inFlight && state.portalId === portalId) return state.inFlight;

    state.portalId = portalId;
    state.inFlight = (async () => {
      const storageKey = `${HUBSPOT_PROPERTY_DEFS_PREFIX}${portalId}`;
      if (!options.force) {
        const stored = await readStorageArea("local", [storageKey]).catch(() => ({}));
        const cached = stored?.[storageKey];
        if (cached && Array.isArray(cached.defs) && fresh(cached.fetchedAt)) {
          state.defs = cached.defs;
          state.fetchedAt = cached.fetchedAt;
          return cached.defs;
        }
      }

      const res = await fetch(`/api/properties/v4/0-1?portalId=${encodeURIComponent(portalId)}`, {
        credentials: "include",
        headers: { "X-HubSpot-CSRF-hubspotapi": csrf }
      });
      if (!res.ok) throw new Error(`HubSpot property list failed (${res.status}).`);
      const defs = slimHubSpotPropertyDefinitions(await res.json());
      const fetchedAt = Date.now();
      state.defs = defs;
      state.fetchedAt = fetchedAt;
      try {
        await chrome.storage.local.set({ [storageKey]: { fetchedAt, defs } });
      } catch (_error) {
        // Cache is optional; the in-memory copy still serves this page.
      }
      return defs;
    })().finally(() => {
      state.inFlight = null;
    });
    return state.inFlight;
  }

  // Prints a stored HubSpot value the way HubSpot shows it: dropdown and
  // checkbox labels instead of internal values, dates as dates.
  function formatPropertyForTemplate(rawValue, def) {
    const raw = cleanText(rawValue);
    if (!raw) return "";
    if (!def) return formatHubSpotPropertyValue(raw);

    if (def.type === "enumeration" || def.type === "bool") {
      const labels = new Map((def.options || []).map((option) => [option.value, option.label]));
      return raw
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => labels.get(part) || part)
        .join(", ");
    }

    if (def.type === "date" || def.type === "datetime") {
      const date = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
      if (!Number.isNaN(date.getTime())) {
        return def.type === "date"
          ? date.toLocaleDateString("tr-TR", { timeZone: "UTC" })
          : date.toLocaleDateString("tr-TR");
      }
      return raw;
    }

    return raw;
  }

  function formatHubSpotPropertyValue(value) {
    // Date/datetime properties arrive as epoch milliseconds; anything else
    // passes through untouched.
    if (/^\d{13}$/.test(value)) {
      const date = new Date(Number(value));
      if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("tr-TR");
    }
    return value;
  }

  // HubSpot templates use {{ contact.x }} and {{ sender.x }} tokens, which we
  // can fill from the record. Anything else — custom.* tracked document links,
  // {{#if}} conditionals — only HubSpot's own renderer can produce, so those
  // templates hand off to its picker rather than ship a broken link.
  function resolveHubSpotTemplateHtml(rawHtml, tokens, senderName, realProps) {
    let unresolved = "";
    const html = String(rawHtml || "").replace(/\{\{([^{}]*)\}\}/g, (match, inner) => {
      if (unresolved) return match;
      const key = cleanText(inner).toLowerCase();
      if (!/^[a-z0-9_.]+$/.test(key)) {
        unresolved = key || "conditional";
        return match;
      }

      const dot = key.indexOf(".");
      const scope = dot === -1 ? "" : key.slice(0, dot);
      const prop = dot === -1 ? key : key.slice(dot + 1);

      if (scope === "contact") {
        const tokenKey = inlineTokenKey(prop);

        // Sidebar first: it shows the option's label ("Hanım"), while the
        // stored property holds the raw value ("Kadin"). HubSpot renders the
        // label, so that is what a filled template needs.
        const shown = cleanText(tokens[tokenKey] || "");
        if (shown) return escapeHtml(shown);

        // Otherwise the record's own properties, which cover fields the
        // sidebar never displays. Present renders, absent is genuinely unset
        // and renders blank — exactly what HubSpot's insert does.
        if (realProps) {
          if (Object.prototype.hasOwnProperty.call(realProps, prop)) {
            return escapeHtml(formatHubSpotPropertyValue(cleanText(realProps[prop])));
          }
          return "";
        }

        if (!Object.prototype.hasOwnProperty.call(tokens, tokenKey)) {
          unresolved = key;
          return match;
        }
        return "";
      }

      if (scope === "sender" || scope === "owner") {
        // A blank sender reads as broken rather than merely empty, so this
        // one still hands off when the From line could not be read.
        if (!senderName) {
          unresolved = key;
          return match;
        }
        const parts = senderName.split(" ").filter(Boolean);
        if (prop === "firstname") return escapeHtml(parts[0] || "");
        if (prop === "lastname") return escapeHtml(parts.slice(1).join(" "));
        if (prop === "fullname" || prop === "name") return escapeHtml(senderName);
      }

      unresolved = key;
      return match;
    });
    return { html, unresolved };
  }

  async function openHubSpotTemplatePicker(template) {
    const dialog = findOpenEmailDialog();
    if (!dialog) throw new Error("Open the email composer first.");

    const tab = Array.from(dialog.querySelectorAll("a, button, [role='tab'], [role='link']")).find(
      (el) => isVisible(el) && cleanText(el.textContent || "").toLowerCase() === "templates"
    );
    if (!tab) throw new Error("Could not find HubSpot's Templates button.");
    tab.click();

    for (let attempt = 0; attempt < 24; attempt += 1) {
      await sleep(150);
      const input = Array.from(document.querySelectorAll("input")).find(
        (el) => isVisible(el) && /search templates/i.test(el.getAttribute("placeholder") || "")
      );
      if (input) {
        setInputValue(input, template.name);
        return;
      }
    }
    throw new Error("HubSpot's template picker did not open.");
  }

  async function applyHubSpotTemplate(template) {
    const dialog = findOpenEmailDialog();
    if (!dialog) throw new Error("Open the email composer first.");

    const detail = await fetchHubSpotTemplateDetail(template?.contentId).catch(() => null);
    if (detail?.body) {
      const context = getInlineContactContextOrThrow();
      const tokens = buildInlineTemplateTokens(context);
      const realProps = await fetchHubSpotContactProperties(context.recordId).catch(() => null);
      const senderName = findEmailSenderName(dialog);
      const body = resolveHubSpotTemplateHtml(detail.body, tokens, senderName, realProps);
      const subject = resolveHubSpotTemplateHtml(detail.subject || "", tokens, senderName, realProps);

      if (!body.unresolved && !subject.unresolved) {
        await applyEmailTemplateOnPage(
          htmlToPlainText(subject.html),
          htmlToPlainText(body.html),
          body.html
        );
        return null;
      }

      // Reported rather than opening the picker straight away: HubSpot's
      // modal covers the composer, so a surprise modal reads as a bug.
      return { needsHubSpotPicker: true, reason: describeUnresolvedToken(body.unresolved || subject.unresolved) };
    }

    return { needsHubSpotPicker: true, reason: "its content could not be read" };
  }

  function describeUnresolvedToken(token) {
    const key = String(token || "").toLowerCase();
    if (key.startsWith("custom.documentlink")) return "it contains a tracked document link";
    if (key.startsWith("custom.")) return "it uses a HubSpot-only field";
    if (/^(#|\/|if|else|end)/.test(key)) return "it uses conditional logic";
    if (key.startsWith("sender.") || key.startsWith("owner.")) return "the sender could not be read";
    return `the ${key} field is not on this record`;
  }

  const COMPOSER_SEARCH_KINDS = {
    email: {
      rowId: COMPOSER_TEMPLATE_SEARCH_ROW_ID,
      placeholder: "Search email templates...",
      emptyText: "No email templates yet. Create them from the Contact Point popup.",
      findDialog: () => {
        // The task composer contains "Send reminder", which scores high
        // enough on findOpenEmailDialog's text heuristic to misdetect it as
        // an email dialog. A real email composer always has a Subject field
        // and no task form.
        const dialog = findOpenEmailDialog();
        if (!dialog) return null;
        const text = elementText(dialog).toLowerCase();
        if (!text.includes("subject")) return null;
        if (text.includes("enter your task") || text.includes("task type")) return null;
        return dialog;
      },
      getTemplates: () => [
        ...(contactTemplateState.templates?.email || []),
        ...(hubspotTemplateState.portalId === getHubSpotPortalId()
          ? hubspotTemplateState.items
          : [])
      ],
      apply: (template) =>
        String(template?.source || "").toLowerCase() === "hubspot"
          ? applyHubSpotTemplate(template)
          : applyInlineEmailTemplate(template)
    },
    note: {
      rowId: COMPOSER_NOTE_SEARCH_ROW_ID,
      placeholder: "Search note templates...",
      emptyText: "No note templates yet. Create them from the Contact Point popup.",
      findDialog: () => {
        const editor = findNoteEditor(document, composerTemplateSearchState.kinds.email.dialog);
        return editor ? getNoteComposerRoot(editor) : null;
      },
      getTemplates: () => contactTemplateState.templates?.note || [],
      apply: applyInlineNoteTemplate
    }
  };

  function ensureComposerTemplateSearchStyles() {
    if (document.getElementById(COMPOSER_TEMPLATE_SEARCH_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = COMPOSER_TEMPLATE_SEARCH_STYLE_ID;
    style.textContent = `
      .cp-cts-row {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        /* flex-basis 100% wraps to an own line in row parents, but grow must
           stay 0: in a column flex parent grow would stretch the row to fill
           the dialog's free height. */
        flex: 0 0 100%;
        max-height: 47px;
        box-sizing: border-box;
        padding: 8px 16px;
        /* Deep enough to read as a toolbar rather than a pastel accent, and
           desaturated so it stays sober next to the composer header. */
        background: #dbe4ee;
        border-bottom: 1px solid #b9c8d9;
      }

      .cp-cts-bolt {
        flex: 0 0 auto;
        font-size: 13px;
        line-height: 1;
      }

      .cp-cts-input-wrap {
        position: relative;
        flex: 1 1 auto;
        min-width: 0;
      }

      .cp-cts-input-wrap > svg {
        position: absolute;
        left: 9px;
        top: 50%;
        transform: translateY(-50%);
        width: 13px;
        height: 13px;
        stroke: #7c93ac;
        fill: none;
        stroke-width: 2;
        pointer-events: none;
      }

      .cp-cts-input {
        width: 100%;
        height: 30px;
        box-sizing: border-box;
        padding: 0 10px 0 29px;
        border: 1px solid #b9c8d9;
        border-radius: 6px;
        background: #ffffff;
        color: #1a2a3e;
        font-size: 13px;
        outline: none;
        transition: background-color 100ms ease, border-color 100ms ease;
      }

      .cp-cts-input:focus {
        background: #ffffff;
        border-color: #0b66c3;
        box-shadow: 0 0 0 3px rgba(11, 102, 195, 0.18);
      }

      .cp-cts-input::placeholder {
        color: #7c93ac;
      }

      .cp-cts-dropdown {
        /* Anchored to the input wrap, so it tracks the capped field width
           instead of spanning the whole row. */
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        z-index: 30;
        display: none;
        max-height: 280px;
        overflow-y: auto;
        padding: 6px;
        background: #ffffff;
        border: 1px solid #dfe3eb;
        border-radius: 8px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
      }

      .cp-cts-dropdown.cp-cts-open {
        display: block;
      }

      .cp-cts-section {
        padding: 6px 8px 2px;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #7c98b6;
      }

      .cp-cts-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 7px 10px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #33475b;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }

      .cp-cts-item:hover,
      .cp-cts-item.cp-cts-active {
        background: #f0f3f8;
      }

      .cp-cts-item-label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cp-cts-item-meta {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #7c98b6;
        font-size: 12px;
      }

      .cp-cts-source-icon {
        display: block;
        flex: 0 0 16px;
        width: 16px;
        height: 16px;
        object-fit: contain;
      }

      html[data-darkreader-scheme="dark"] .cp-cts-source-icon {
        filter: invert(1);
      }

      .cp-cts-check {
        opacity: 0.15;
      }

      .cp-cts-check.is-used {
        opacity: 1;
        color: #128c4c;
      }

      .cp-cts-empty {
        padding: 10px;
        font-size: 12.5px;
        color: #7c98b6;
      }

      .cp-cts-notice {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        font-size: 12.5px;
        color: #33475b;
      }

      .cp-cts-notice-btn {
        flex: 0 0 auto;
        padding: 4px 10px;
        border: 1px solid #b9c8d9;
        border-radius: 999px;
        background: #ffffff;
        color: #0b66c3;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }

      .cp-cts-notice-btn:hover {
        background: #eef4fb;
        border-color: #0b66c3;
      }

      .cp-cts-sidebar {
        position: fixed;
        z-index: 2147483001;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        overflow: hidden;
        border: 1px solid #dfe3eb;
        border-right: 0;
        border-radius: 8px 0 0 8px;
        background: #ffffff;
        color: #1a2a3e;
        box-shadow: -8px 4px 24px rgba(15, 23, 42, 0.12);
        clip-path: inset(-32px 0 -36px -40px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .cp-cts-composer-docked {
        border-top-left-radius: 0 !important;
        border-bottom-left-radius: 0 !important;
      }

      .cp-cts-sidebar[hidden],
      .cp-cts-row[hidden],
      .cp-cts-list-section[hidden],
      .cp-cts-item-row[hidden],
      .cp-cts-item[hidden],
      .cp-cts-status:empty {
        display: none;
      }

      .cp-cts-sidebar-header {
        padding: 15px 16px 12px;
      }

      .cp-cts-sidebar-brand {
        display: block;
        margin-bottom: 3px;
        color: #536a84;
        font-size: 11px;
        font-weight: 600;
      }

      .cp-cts-sidebar-title {
        font-size: 19px;
        line-height: 1.25;
      }

      .cp-cts-sidebar-slot {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
      }

      .cp-cts-sidebar .cp-cts-input-wrap {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .cp-cts-sidebar .cp-cts-input-wrap > svg {
        left: 26px;
        top: 18px;
      }

      .cp-cts-sidebar .cp-cts-input {
        flex: 0 0 auto;
        width: calc(100% - 32px);
        height: 36px;
        margin: 0 16px 10px;
      }

      .cp-cts-sidebar .cp-cts-dropdown {
        position: static;
        flex: 1 1 auto;
        max-height: none;
        padding: 4px 8px 8px;
        border: 0;
        border-top: 1px solid #e8edf4;
        border-radius: 0;
        box-shadow: none;
        overscroll-behavior: contain;
      }

      .cp-cts-sidebar .cp-cts-section {
        padding-block: 10px 4px;
        color: #536a84;
      }

      .cp-cts-item-row {
        display: flex;
        align-items: center;
        gap: 2px;
        content-visibility: auto;
        contain-intrinsic-height: 36px;
      }

      .cp-cts-item-row .cp-cts-item {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 36px;
      }

      .cp-cts-star {
        display: grid;
        flex: 0 0 32px;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #536a84;
        cursor: pointer;
      }

      .cp-cts-star svg {
        width: 16px;
        height: 16px;
        stroke: currentColor;
        fill: none;
        stroke-width: 1.6;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }

      .cp-cts-star[aria-pressed='true'] {
        color: #9a5700;
      }

      .cp-cts-star[aria-pressed='true'] svg {
        fill: #ffcb65;
      }

      .cp-cts-star:hover {
        background: #f0f3f8;
      }

      /* WhatsApp template popover, anchored to the inline phone button. */
      .cp-wa-pop {
        position: fixed;
        z-index: 2147483647;
        width: 300px;
        max-height: 300px;
        overflow-y: auto;
        padding: 6px;
        background: #ffffff;
        border: 1px solid #dfe3eb;
        border-radius: 8px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
      }

      .cp-wa-pop .cp-cts-input-wrap {
        margin: 2px 2px 6px;
      }

      /* The row our button lives in must never be hover-gated by HubSpot. */
      .cp-active-contact-phone-action-wrap,
      .cp-active-contact-whatsapp-btn {
        opacity: 1 !important;
        visibility: visible !important;
      }
    `;
    document.head.appendChild(style);
  }

  // The composer's own tab bar (Templates / Sequences / Documents / ...) is
  // the visual anchor: our row slots directly beneath it. Found by text, not
  // classes, so HubSpot's CSS churn can't break it; falls back to the top of
  // the dialog.
  function findComposerTabRow(dialog) {
    const candidates = Array.from(dialog.querySelectorAll("a, button, [role='tab'], [role='link']"));
    for (const el of candidates) {
      const text = cleanText(el.textContent || "").toLowerCase();
      if (text !== "templates" && text !== "documents") continue;
      let current = el.parentElement;
      for (let depth = 0; depth < 5 && current && current !== dialog; depth += 1) {
        const containerText = cleanText(current.textContent || "").toLowerCase();
        if (containerText.includes("templates") && containerText.includes("documents") && containerText.length < 120) {
          return current;
        }
        current = current.parentElement;
      }
    }
    return null;
  }

  function composerFavoriteKey(kindKey, template) {
    const portalId = composerTemplateSearchState.kinds[kindKey].picker?.portalId;
    const prefix = kindKey === "email" ? "cpEmailFavorite" : "cpNoteFavorite";
    return portalId
      ? `${prefix}::${portalId}::${template.source || "local"}::${template.id}`
      : "";
  }

  async function refreshComposerFavorites(kindKey) {
    const kindState = composerTemplateSearchState.kinds[kindKey];
    const picker = kindState.picker;
    if (!picker) return;
    positionComposerSidebar(kindKey);
    const keys = COMPOSER_SEARCH_KINDS[kindKey].getTemplates().map((template) => composerFavoriteKey(kindKey, template))
      .filter((key) => key && !picker.favorites.has(key));
    if (keys.length) {
      for (const key of keys) picker.favorites.set(key, false);
      const stored = await readStorageArea("local", keys);
      for (const key of keys) {
        if (!picker.favoriteUpdates.has(key)) picker.favorites.set(key, stored[key] === true);
      }
    }
    if (kindState.picker === picker) renderComposerTemplateDropdown(kindKey);
  }

  function renderComposerTemplateDropdown(kindKey) {
    const kindState = composerTemplateSearchState.kinds[kindKey];
    const picker = kindState.picker;
    if (!picker) return;
    const { dropdown } = picker;

    const open = picker.docked || kindState.open;
    dropdown.classList.toggle("cp-cts-open", open);
    if (!open) return;

    const focusedStar = dropdown.contains(document.activeElement) ? document.activeElement.dataset.ctsFavorite : null;
    const scrollTop = dropdown.scrollTop;

    const all = COMPOSER_SEARCH_KINDS[kindKey].getTemplates();
    if (!all.length) {
      kindState.visibleTemplateIds = [];
      picker.visibleButtons = [];
      picker.sections = null;
      dropdown.innerHTML = `<div class='cp-cts-empty'>${escapeHtml(COMPOSER_SEARCH_KINDS[kindKey].emptyText)}</div>`;
      return;
    }

    const sourceOf = (template) => String(template?.source || "").toLowerCase();
    const isStarred = (template) => picker.favorites.get(composerFavoriteKey(kindKey, template)) === true;
    const starred = all.filter(isStarred);
    const remaining = all.filter((template) => !isStarred(template));
    const cloud = remaining.filter((template) => sourceOf(template) === "cloud");
    const hubspot = remaining.filter((template) => sourceOf(template) === "hubspot");
    const personal = remaining.filter((template) => !["cloud", "hubspot"].includes(sourceOf(template)));
    const sections = [["Starred", starred], ["Cloud", cloud], ["Personal", personal], ["HubSpot", hubspot]];

    const renderItem = (template) => {
      const isHubSpot = sourceOf(template) === "hubspot";
      const sourceLabel = isHubSpot ? "HubSpot" : "Contact Point";
      const iconUrl = isHubSpot ? picker.hubSpotIconUrl : picker.contactPointIconUrl;
      const sourceIcon = `<img class='cp-cts-source-icon' src='${escapeHtml(iconUrl)}' alt='${sourceLabel}' title='${sourceLabel}' width='16' height='16'>`;
      const item = (
        `<button type='button' class='cp-cts-item' data-cts-template-id='${escapeHtml(
          String(template.id)
        )}'>` +
        sourceIcon +
        `<span class='cp-cts-item-label'>${escapeHtml(template.name || "Untitled")}</span>` +
        (sourceOf(template) === "cloud"
          ? "<span class='cp-cts-item-meta' aria-hidden='true' title='Cloud template'>☁</span>"
          : "") +
        "</button>"
      );
      const favoriteKey = composerFavoriteKey(kindKey, template);
      if (!favoriteKey) return item;
      return (
        "<div class='cp-cts-item-row'>" + item +
        `<button type='button' class='cp-cts-star' aria-label='Star ${escapeHtml(template.name || "Untitled")}'` +
        ` title='${isStarred(template) ? "Remove from Starred" : "Add to Starred"}'` +
        ` aria-pressed='${isStarred(template)}' data-cts-favorite='${escapeHtml(favoriteKey)}'>` +
        "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.5l-5.7 3.1 1.1-6.4-4.6-4.5 6.4-.9Z'/></svg>" +
        "</button></div>"
      );
    };

    const populated = sections.filter(([, templates]) => templates.length);
    dropdown.innerHTML = populated.map(([label, templates]) =>
      `<div class='cp-cts-list-section'><div class='cp-cts-section'>${label}</div>${templates.map(renderItem).join("")}</div>`
    ).join("") + "<div class='cp-cts-empty' hidden>No templates match that title.</div>";
    picker.sections = populated.map(([, templates], index) => {
      const element = dropdown.children[index];
      return {
        element,
        rows: Array.from(element.querySelectorAll("[data-cts-template-id]"), (button, rowIndex) => ({
          button,
          element: button.closest(".cp-cts-item-row") || button,
          name: normalizeSearchText(templates[rowIndex].name || "")
        }))
      };
    });
    picker.noMatches = dropdown.lastElementChild;
    filterComposerTemplateRows(kindState);
    dropdown.scrollTop = scrollTop;
    if (focusedStar) dropdown.querySelector(`[data-cts-favorite="${CSS.escape(focusedStar)}"]`)?.focus();
  }

  function filterComposerTemplateRows(kindState) {
    const { picker } = kindState;
    const tokens = normalizeSearchTokens(kindState.query);
    const buttons = [];
    for (const section of picker.sections) {
      const firstIndex = buttons.length;
      for (const row of section.rows) {
        const matches = tokens.every((token) => row.name.includes(token));
        row.element.toggleAttribute("hidden", !matches);
        if (matches) buttons.push(row.button);
      }
      section.element.toggleAttribute("hidden", buttons.length === firstIndex);
    }
    picker.noMatches.toggleAttribute("hidden", buttons.length > 0);
    picker.visibleButtons = buttons;
    kindState.visibleTemplateIds = buttons.map((button) => button.dataset.ctsTemplateId);
    if (kindState.activeIndex >= buttons.length) kindState.activeIndex = 0;
    picker.dropdown.querySelector(".cp-cts-active")?.classList.remove("cp-cts-active");
    buttons[kindState.activeIndex]?.classList.add("cp-cts-active");
  }

  function closeComposerTemplateDropdown(kindKey) {
    composerTemplateSearchState.kinds[kindKey].open = false;
    renderComposerTemplateDropdown(kindKey);
  }

  async function handleComposerTemplateSelection(kindKey, templateId) {
    const kindState = composerTemplateSearchState.kinds[kindKey];
    if (kindState.busy) return;
    const template = COMPOSER_SEARCH_KINDS[kindKey]
      .getTemplates()
      .find((item) => String(item?.id || "") === String(templateId || ""));
    if (!template) return;

    const row = document.getElementById(COMPOSER_SEARCH_KINDS[kindKey].rowId);
    const picker = kindState.picker;
    const input = picker?.input || row?.querySelector(".cp-cts-input");
    const notice = picker?.docked ? picker.status : picker?.dropdown || row?.querySelector(".cp-cts-dropdown");
    if (picker) picker.status.textContent = "";
    kindState.busy = true;
    if (input instanceof HTMLInputElement) input.placeholder = "Applying...";
    try {
      const result = await COMPOSER_SEARCH_KINDS[kindKey].apply(template, kindState.dialog);
      if (!row?.isConnected) return;

      if (result?.needsHubSpotPicker) {
        if (notice) {
          if (notice === picker?.dropdown) picker.sections = null;
          notice.innerHTML =
            "<div class='cp-cts-notice'>" +
            `<span>Can't fill this one here because ${escapeHtml(cleanText(result.reason || ""))}.</span>` +
            `<button type='button' class='cp-cts-notice-btn' data-cts-open-picker='${escapeHtml(
              String(template.id)
            )}'>Open in HubSpot</button>` +
            "</div>";
        }
        return;
      }

      if (kindKey === "email") void recordInlineTemplateStatsUse("email", template.id);
      void trackInlineCloudTemplateUse(template);
      if (picker?.docked) return;
      kindState.query = "";
      if (input instanceof HTMLInputElement) input.value = "";
      closeComposerTemplateDropdown(kindKey);
    } catch (error) {
      if (notice) {
        if (notice === picker?.dropdown) picker.sections = null;
        notice.innerHTML = `<div class='cp-cts-empty'>${escapeHtml(
          cleanText(String(error?.message || error || "Could not apply the template."))
        )}</div>`;
      }
    } finally {
      kindState.busy = false;
      if (input instanceof HTMLInputElement) input.placeholder = COMPOSER_SEARCH_KINDS[kindKey].placeholder;
    }
  }

  function handleComposerSearchKeydown(kindKey, event) {
    const kindState = composerTemplateSearchState.kinds[kindKey];
    const ids = kindState.visibleTemplateIds;
    if (event.key === "Escape") {
      if (kindState.picker?.docked) {
        event.stopPropagation();
      } else {
        closeComposerTemplateDropdown(kindKey);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!kindState.open && !kindState.picker?.docked) {
        kindState.open = true;
        renderComposerTemplateDropdown(kindKey);
        return;
      }
      if (!ids.length || !kindState.picker) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      kindState.activeIndex = (kindState.activeIndex + delta + ids.length) % ids.length;
      const { dropdown } = kindState.picker;
      const item = kindState.picker.visibleButtons?.[kindState.activeIndex];
      if (!item?.isConnected) {
        renderComposerTemplateDropdown(kindKey);
        return;
      }
      dropdown.querySelector(".cp-cts-active")?.classList.remove("cp-cts-active");
      item.classList.add("cp-cts-active");
      item.closest(".cp-cts-item-row")?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!kindState.open && !kindState.picker?.docked) return;
      const id = ids[kindState.activeIndex] || ids[0];
      if (id) void handleComposerTemplateSelection(kindKey, id);
    }
  }

  function positionComposerSidebar(kindKey) {
    const kindState = composerTemplateSearchState.kinds[kindKey];
    const { dialog, picker } = kindState;
    if (!picker || !dialog?.isConnected) return;
    const bounds = dialog.getBoundingClientRect();
    const top = Math.max(0, bounds.top);
    const height = Math.min(window.innerHeight, bounds.bottom) - top;
    const width = Math.min(344, bounds.left - 12);
    const hasTemplates = kindKey === "email" || COMPOSER_SEARCH_KINDS[kindKey].getTemplates().length > 0;
    const visible = hasTemplates && isVisible(dialog) && height >= 170;
    const otherDialog = composerTemplateSearchState.kinds[kindKey === "email" ? "note" : "email"].dialog;
    const docked = visible && picker.canDock && width >= 280 && !isComposerCovered(dialog, otherDialog, bounds);
    if (docked) {
      const left = bounds.left - width;
      const position = `${left}:${top}:${width}:${height}`;
      if (picker.position !== position) {
        picker.position = position;
        Object.assign(picker.panel.style, {
          left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`
        });
      }
    }
    const hadSearchFocus = document.activeElement === picker.input;
    const dockChanged = picker.docked !== docked;
    if (dockChanged) {
      picker.docked = docked;
      kindState.open = !docked && visible && hadSearchFocus;
      (docked ? picker.slot : picker.row).appendChild(picker.inputWrap);
    }
    picker.row.toggleAttribute("hidden", !visible || docked);
    picker.panel.toggleAttribute("hidden", !docked);
    dialog.classList.toggle("cp-cts-composer-docked", docked);
    if (dockChanged) {
      renderComposerTemplateDropdown(kindKey);
      if (docked && kindKey === "email") refreshHubSpotTemplates();
      if (hadSearchFocus && visible) picker.input.focus({ preventScroll: true });
    }
  }

  function isComposerCovered(dialog, otherDialog, bounds) {
    if (!otherDialog?.isConnected) return false;
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const frontComposer = document.elementsFromPoint(x, y).find((element) =>
      dialog.contains(element) || otherDialog.contains(element)
    );
    return !!frontComposer && otherDialog.contains(frontComposer);
  }

  function mountComposerSidebar(kindKey, row, dialog, inputWrap, input, dropdown) {
    const kindState = composerTemplateSearchState.kinds[kindKey];
    const panel = document.createElement("aside");
    panel.id = `cp-${kindKey}-template-sidebar`;
    panel.className = "cp-cts-sidebar";
    panel.setAttribute("aria-label", `Contact Point ${kindKey} templates`);
    panel.hidden = true;
    panel.innerHTML =
      "<div class='cp-cts-sidebar-header'><span class='cp-cts-sidebar-brand'>Contact Point</span>" +
      "<strong class='cp-cts-sidebar-title'>Templates</strong></div>" +
      "<div class='cp-cts-status' role='status'></div><div class='cp-cts-sidebar-slot'></div>";
    document.body.appendChild(panel);

    const picker = {
      row, panel, inputWrap, input, dropdown,
      portalId: getHubSpotPortalId(),
      hubSpotIconUrl: chrome.runtime.getURL("icons/hubspot.svg"),
      contactPointIconUrl: chrome.runtime.getURL("icons/contact-point-monochrome.svg"),
      slot: panel.querySelector(".cp-cts-sidebar-slot"),
      status: panel.querySelector(".cp-cts-status"),
      favorites: new Map(),
      favoriteUpdates: new Set(),
      canDock: kindKey === "email" || !isTaskComposerRoot(dialog.closest("[role='dialog']") || dialog),
      docked: false
    };
    kindState.picker = picker;

    let frame = 0;
    const schedulePosition = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        positionComposerSidebar(kindKey);
      });
    };
    const dragPosition = (event) => {
      if (event.buttons) schedulePosition();
    };
    const observer = new ResizeObserver(schedulePosition);
    observer.observe(dialog);
    const movementObserver = new MutationObserver(schedulePosition);
    movementObserver.observe(dialog, { attributes: true, attributeFilter: ["class", "style"] });
    if (dialog.parentElement) {
      movementObserver.observe(dialog.parentElement, { attributes: true, attributeFilter: ["class", "style"] });
    }
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    window.addEventListener("pointermove", dragPosition, true);
    picker.cleanup = () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      movementObserver.disconnect();
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
      window.removeEventListener("pointermove", dragPosition, true);
      dialog.classList.remove("cp-cts-composer-docked");
      panel.remove();
    };
    void refreshComposerFavorites(kindKey);
  }

  function mountComposerTemplateSearchRow(kindKey, dialog) {
    const kindState = composerTemplateSearchState.kinds[kindKey];
    const row = document.createElement("div");
    row.id = COMPOSER_SEARCH_KINDS[kindKey].rowId;
    row.className = "cp-cts-row";

    const bolt = document.createElement("span");
    bolt.className = "cp-cts-bolt";
    bolt.textContent = "⚡";
    bolt.setAttribute("aria-hidden", "true");
    bolt.setAttribute("title", "Contact Point");

    const inputWrap = document.createElement("div");
    inputWrap.className = "cp-cts-input-wrap";
    inputWrap.innerHTML =
      "<svg viewBox='0 0 16 16' aria-hidden='true'><circle cx='7' cy='7' r='4.5'/><path d='M10.5 10.5 14 14' stroke-linecap='round'/></svg>";

    const input = document.createElement("input");
    input.className = "cp-cts-input";
    input.type = "text";
    input.placeholder = COMPOSER_SEARCH_KINDS[kindKey].placeholder;
    input.autocomplete = "off";
    input.setAttribute("aria-label", COMPOSER_SEARCH_KINDS[kindKey].placeholder);
    const openPicker = () => {
      if (kindState.open) return;
      kindState.open = true;
      if (kindKey === "email") refreshHubSpotTemplates();
      renderComposerTemplateDropdown(kindKey);
    };
    input.addEventListener("focus", openPicker);
    input.addEventListener("click", openPicker);
    input.addEventListener("input", () => {
      kindState.query = input.value;
      kindState.activeIndex = 0;
      kindState.open = true;
      if (kindState.picker) kindState.picker.status.textContent = "";
      const picker = kindState.picker;
      if (picker?.sections && picker.dropdown.classList.contains("cp-cts-open")) {
        filterComposerTemplateRows(kindState);
        picker.dropdown.scrollTop = 0;
      } else {
        renderComposerTemplateDropdown(kindKey);
      }
    });
    input.addEventListener("keydown", (event) => handleComposerSearchKeydown(kindKey, event));
    inputWrap.appendChild(input);

    const dropdown = document.createElement("div");
    dropdown.className = "cp-cts-dropdown";
    const handlePickerClick = (event) => {
      const target = event.target instanceof Element ? event.target : null;

      const picker = target?.closest("[data-cts-open-picker]");
      if (picker) {
        event.preventDefault();
        const id = picker.getAttribute("data-cts-open-picker");
        const template = COMPOSER_SEARCH_KINDS[kindKey].getTemplates().find((item) => String(item?.id || "") === String(id));
        if (template) void openHubSpotTemplatePicker(template).catch(() => {});
        if (kindState.picker?.docked) kindState.picker.status.textContent = "";
        else closeComposerTemplateDropdown(kindKey);
        return;
      }

      const favorite = target?.closest("[data-cts-favorite]");
      if (favorite && kindState.picker) {
        const picker = kindState.picker;
        const key = favorite.dataset.ctsFavorite;
        const wasStarred = picker.favorites.get(key) === true;
        picker.favoriteUpdates.add(key);
        picker.favorites.set(key, !wasStarred);
        renderComposerTemplateDropdown(kindKey);
        const storage = chrome.storage.local;
        const update = wasStarred ? storage.remove(key) : storage.set({ [key]: true });
        void update.catch(() => {
          if (picker.favorites.get(key) !== !wasStarred) return;
          picker.favorites.set(key, wasStarred);
          renderComposerTemplateDropdown(kindKey);
        });
        return;
      }

      const item = target?.closest("[data-cts-template-id]");
      if (!item) return;
      void handleComposerTemplateSelection(kindKey, item.getAttribute("data-cts-template-id"));
    };
    dropdown.addEventListener("click", handlePickerClick);
    dropdown.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || kindState.picker?.docked) return;
      input.focus();
      closeComposerTemplateDropdown(kindKey);
    });

    row.appendChild(bolt);
    inputWrap.appendChild(dropdown);
    row.appendChild(inputWrap);

    // Email composer: below its tab bar. The tab list itself lives inside a
    // flex row, so climb to the first ancestor spanning (nearly) the dialog
    // width to get an own full-width line.
    const tabRow = kindKey === "email" ? findComposerTabRow(dialog) : null;
    if (tabRow?.parentElement) {
      const dialogWidth = dialog.getBoundingClientRect().width || 0;
      let anchor = tabRow;
      while (anchor.parentElement && anchor.parentElement !== dialog) {
        if (anchor.getBoundingClientRect().width >= dialogWidth * 0.85) break;
        anchor = anchor.parentElement;
      }
      anchor.parentElement.insertBefore(row, anchor.nextSibling);
    } else {
      // Note composer has no tab bar. Mount below the dialog header so it
      // sits in the same place as the email row rather than above the title.
      const header = Array.from(dialog.children).find(
        (child) => child !== row && (child.tagName === "HEADER" || !!child.querySelector("[aria-label*='close' i]"))
      );
      dialog.insertBefore(row, header ? header.nextSibling : dialog.firstChild);
    }

    mountComposerSidebar(kindKey, row, dialog, inputWrap, input, dropdown);
    kindState.picker.status.addEventListener("click", handlePickerClick);

    kindState.outsideClickHandler = (event) => {
      if (!(event.target instanceof Node) || !row.isConnected) return;
      // Only the field and its dropdown keep the list open, so clicking the
      // bare stretch of the row (or the bolt) dismisses it too.
      if (!kindState.picker?.docked && !inputWrap.contains(event.target)) closeComposerTemplateDropdown(kindKey);
    };
    document.addEventListener("mousedown", kindState.outsideClickHandler, true);

    // Email and note can mount together and share the same template load.
    if (!composerTemplateSearchState.refreshKicked) {
      composerTemplateSearchState.refreshKicked = true;
      requestCloudTemplateRefresh();
      void refreshContactTemplateData().finally(() => {
        composerTemplateSearchState.refreshKicked = false;
        void refreshComposerFavorites("email");
        void refreshComposerFavorites("note");
      });
    }
  }

  function removeComposerTemplateSearchKind(kindKey) {
    const kindState = composerTemplateSearchState.kinds[kindKey];
    kindState.picker?.cleanup();
    kindState.picker = null;
    document.getElementById(COMPOSER_SEARCH_KINDS[kindKey].rowId)?.remove();
    if (kindState.outsideClickHandler) {
      document.removeEventListener("mousedown", kindState.outsideClickHandler, true);
      kindState.outsideClickHandler = null;
    }
    kindState.dialog = null;
    kindState.open = false;
    kindState.query = "";
    kindState.activeIndex = 0;
    kindState.visibleTemplateIds = [];
  }

  function removeComposerTemplateSearch() {
    for (const kindKey of Object.keys(COMPOSER_SEARCH_KINDS)) {
      removeComposerTemplateSearchKind(kindKey);
    }
  }

  function ensureComposerTemplateSearchKind(kindKey) {
    const kindState = composerTemplateSearchState.kinds[kindKey];

    // Cheap path first: row alive inside a still-connected dialog.
    const existingRow = document.getElementById(COMPOSER_SEARCH_KINDS[kindKey].rowId);
    const samePortal = kindState.picker?.portalId === getHubSpotPortalId();
    if (samePortal && existingRow && kindState.dialog?.isConnected && kindState.dialog.contains(existingRow)) {
      positionComposerSidebar(kindKey);
      return;
    }
    // Full teardown before any remount so a dialog swap can't leak the old
    // outside-click listener.
    removeComposerTemplateSearchKind(kindKey);

    const dialog = COMPOSER_SEARCH_KINDS[kindKey].findDialog();
    if (!(dialog instanceof Element)) return;

    kindState.dialog = dialog;
    ensureComposerTemplateSearchStyles();
    mountComposerTemplateSearchRow(kindKey, dialog);
  }

  function ensureComposerTemplateSearch() {
    if (!isContactRecordPage()) {
      removeComposerTemplateSearch();
      return;
    }
    for (const kindKey of Object.keys(COMPOSER_SEARCH_KINDS)) {
      ensureComposerTemplateSearchKind(kindKey);
    }
  }

  // --- WhatsApp template popover ---
  // WhatsApp has no HubSpot composer to host a search row, so its templates
  // anchor to the inline phone button instead: click opens a popover with the
  // same search pattern, picking a template opens WhatsApp with the message
  // filled. "Open without template" keeps the old one-click path.
  const waTemplatePopoverState = {
    open: false,
    query: "",
    activeIndex: 0,
    visibleIds: [],
    busy: false,
    el: null,
    anchorBtn: null,
    outsideHandler: null,
    scrollHandler: null
  };

  function closeWaTemplatePopover() {
    waTemplatePopoverState.el?.remove();
    if (waTemplatePopoverState.outsideHandler) {
      document.removeEventListener("mousedown", waTemplatePopoverState.outsideHandler, true);
      waTemplatePopoverState.outsideHandler = null;
    }
    if (waTemplatePopoverState.scrollHandler) {
      window.removeEventListener("scroll", waTemplatePopoverState.scrollHandler, true);
      waTemplatePopoverState.scrollHandler = null;
    }
    waTemplatePopoverState.el = null;
    waTemplatePopoverState.anchorBtn = null;
    waTemplatePopoverState.open = false;
    waTemplatePopoverState.query = "";
    waTemplatePopoverState.activeIndex = 0;
    waTemplatePopoverState.visibleIds = [];
  }

  function getWaPopoverVisibleTemplates() {
    const templates = contactTemplateState.templates?.whatsapp || [];
    const query = normalizeSearchText(waTemplatePopoverState.query || "");
    if (!query) return templates;
    return templates.filter((template) => searchTextMatchesQuery(template?.name || "", query));
  }

  function renderWaTemplatePopoverList() {
    const list = waTemplatePopoverState.el?.querySelector(".cp-wa-pop-list");
    if (!list) return;

    const visible = getWaPopoverVisibleTemplates();
    // Index 0 is always the plain-open entry so Enter with no typing keeps
    // the old instant behavior one keypress away.
    waTemplatePopoverState.visibleIds = ["__plain__", ...visible.map((template) => String(template.id))];
    if (waTemplatePopoverState.activeIndex >= waTemplatePopoverState.visibleIds.length) {
      waTemplatePopoverState.activeIndex = 0;
    }

    const cloud = visible.filter((template) => String(template?.source || "").toLowerCase() === "cloud");
    const personal = visible.filter((template) => String(template?.source || "").toLowerCase() !== "cloud");

    const renderItem = (template) => {
      const index = waTemplatePopoverState.visibleIds.indexOf(String(template.id));
      const isUsed = hasInlineWhatsappTemplateBeenUsed(template.id);
      const isActive = index === waTemplatePopoverState.activeIndex;
      return (
        `<button type='button' class='cp-cts-item ${isActive ? "cp-cts-active" : ""}' data-wa-template-id='${escapeHtml(
          String(template.id)
        )}'>` +
        `<span class='cp-cts-item-label'>${escapeHtml(template.name || "Untitled")}</span>` +
        "<span class='cp-cts-item-meta'>" +
        `${String(template?.source || "").toLowerCase() === "cloud" ? "<span aria-hidden='true' title='Cloud template'>☁</span>" : ""}` +
        `<span class='cp-cts-check ${isUsed ? "is-used" : ""}' aria-hidden='true'>✓</span>` +
        "</span>" +
        "</button>"
      );
    };

    const plainActive = waTemplatePopoverState.activeIndex === 0;
    list.innerHTML =
      `<button type='button' class='cp-cts-item ${plainActive ? "cp-cts-active" : ""}' data-wa-template-id='__plain__'>` +
      "<span class='cp-cts-item-label'>Open without template</span>" +
      "<span class='cp-cts-item-meta'><span aria-hidden='true'>↗</span></span>" +
      "</button>" +
      (cloud.length ? "<div class='cp-cts-section'>Cloud</div>" + cloud.map(renderItem).join("") : "") +
      (personal.length ? "<div class='cp-cts-section'>Personal</div>" + personal.map(renderItem).join("") : "") +
      (!visible.length && waTemplatePopoverState.query
        ? "<div class='cp-cts-empty'>No templates match that title.</div>"
        : "");
  }

  async function handleWaPopoverSelection(templateId) {
    if (waTemplatePopoverState.busy) return;
    const waUrl = String(waTemplatePopoverState.anchorBtn?.dataset.waUrl || "");

    if (templateId === "__plain__") {
      closeWaTemplatePopover();
      if (waUrl) await openOrReuseWhatsappTab(waUrl);
      return;
    }

    const template = (contactTemplateState.templates?.whatsapp || []).find(
      (item) => String(item?.id || "") === String(templateId || "")
    );
    if (!template) return;

    waTemplatePopoverState.busy = true;
    try {
      await applyInlineWhatsappTemplate(template);
      markInlineWhatsappTemplateUsed(template.id);
      void trackInlineCloudTemplateUse(template);
      closeWaTemplatePopover();
    } catch (error) {
      const list = waTemplatePopoverState.el?.querySelector(".cp-wa-pop-list");
      if (list) {
        list.innerHTML = `<div class='cp-cts-empty'>${escapeHtml(
          cleanText(String(error?.message || error || "Could not open WhatsApp."))
        )}</div>`;
      }
    } finally {
      waTemplatePopoverState.busy = false;
    }
  }

  function openWaTemplatePopover(button) {
    if (waTemplatePopoverState.open && waTemplatePopoverState.anchorBtn === button) {
      closeWaTemplatePopover();
      return;
    }
    closeWaTemplatePopover();

    ensureComposerTemplateSearchStyles();
    const pop = document.createElement("div");
    pop.className = "cp-wa-pop";

    const inputWrap = document.createElement("div");
    inputWrap.className = "cp-cts-input-wrap";
    inputWrap.innerHTML =
      "<svg viewBox='0 0 16 16' aria-hidden='true'><circle cx='7' cy='7' r='4.5'/><path d='M10.5 10.5 14 14' stroke-linecap='round'/></svg>";
    const input = document.createElement("input");
    input.className = "cp-cts-input";
    input.type = "text";
    input.placeholder = "Search WhatsApp templates...";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Search WhatsApp templates");
    input.addEventListener("input", () => {
      waTemplatePopoverState.query = input.value;
      waTemplatePopoverState.activeIndex = waTemplatePopoverState.query ? 1 : 0;
      renderWaTemplatePopoverList();
    });
    input.addEventListener("keydown", (event) => {
      const ids = waTemplatePopoverState.visibleIds;
      if (event.key === "Escape") {
        closeWaTemplatePopover();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (ids.length) {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          waTemplatePopoverState.activeIndex = (waTemplatePopoverState.activeIndex + delta + ids.length) % ids.length;
          renderWaTemplatePopoverList();
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const id = ids[waTemplatePopoverState.activeIndex] || ids[0];
        if (id) void handleWaPopoverSelection(id);
      }
    });
    inputWrap.appendChild(input);

    const list = document.createElement("div");
    list.className = "cp-wa-pop-list";
    list.addEventListener("mousedown", (event) => {
      const item = event.target instanceof Element ? event.target.closest("[data-wa-template-id]") : null;
      if (!item) return;
      event.preventDefault();
      void handleWaPopoverSelection(item.getAttribute("data-wa-template-id"));
    });

    pop.appendChild(inputWrap);
    pop.appendChild(list);
    document.body.appendChild(pop);

    const rect = button.getBoundingClientRect();
    const width = 300;
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    pop.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 60)}px`;

    waTemplatePopoverState.el = pop;
    waTemplatePopoverState.anchorBtn = button;
    waTemplatePopoverState.open = true;

    waTemplatePopoverState.outsideHandler = (event) => {
      if (!(event.target instanceof Node)) return;
      if (!pop.contains(event.target) && event.target !== button) closeWaTemplatePopover();
    };
    document.addEventListener("mousedown", waTemplatePopoverState.outsideHandler, true);
    // The popover is fixed-position; a page scroll shifts its anchor away.
    // Scrolling inside the popover's own template list must not close it.
    waTemplatePopoverState.scrollHandler = (event) => {
      if (event.target instanceof Node && pop.contains(event.target)) return;
      closeWaTemplatePopover();
    };
    window.addEventListener("scroll", waTemplatePopoverState.scrollHandler, true);

    renderWaTemplatePopoverList();
    requestCloudTemplateRefresh();
    void refreshContactTemplateData().then(() => {
      if (waTemplatePopoverState.open) renderWaTemplatePopoverList();
    });
    input.focus();
  }

  let contactEnhancerRafId = 0;
  let contactEnhancerObserver = null;

  function runContactEnhancers() {
    contactEnhancerRafId = 0;
    if (!isExtensionContextAlive()) {
      stopContactEnhancers();
      return;
    }
    if (globalThis.__cpPerfDebug) {
      const start = performance.now();
      enhanceContactIndexInlineButtons();
      decorateActiveContactPhoneTextFlags();
      enhanceSidebarDeclutter();
      ensureComposerTemplateSearch();
      ensureNavThemeToggle();
      const ms = performance.now() - start;
      if (ms > 4) console.log(`[ContactPoint] enhancers ran in ${ms.toFixed(1)}ms`);
      return;
    }
    enhanceContactIndexInlineButtons();
    decorateActiveContactPhoneTextFlags();
    enhanceSidebarDeclutter();
    ensureComposerTemplateSearch();
    ensureNavThemeToggle();
  }

  // Coalesce bursts of DOM mutations into a single run per animation frame.
  // HubSpot mutates the DOM constantly; running the page-wide sweeps on every
  // mutation pegs a CPU core, so we throttle to at most once per frame.
  function scheduleContactEnhancers() {
    if (contactEnhancerRafId) return;
    contactEnhancerRafId = window.requestAnimationFrame(runContactEnhancers);
  }

  function stopContactEnhancers() {
    if (contactEnhancerObserver) {
      contactEnhancerObserver.disconnect();
      contactEnhancerObserver = null;
    }
    if (contactEnhancerRafId) {
      window.cancelAnimationFrame(contactEnhancerRafId);
      contactEnhancerRafId = 0;
    }
    window.removeEventListener("scroll", hidePhoneFlagTooltip, true);
    hidePhoneFlagTooltip();
  }

  function startContactIndexEnhancerWatcher() {
    ensureContactIndexNewTabStyles();
    runContactEnhancers();
    if (!document.body) return;
    contactEnhancerObserver = new MutationObserver((mutations) => {
      // Template list updates need no page-wide HubSpot enhancement pass.
      const changedHubSpot = mutations.some(({ target }) =>
        !(target instanceof Element) || !target.closest(".cp-cts-row, .cp-cts-sidebar, .cp-wa-pop")
      );
      if (changedHubSpot) scheduleContactEnhancers();
    });
    contactEnhancerObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function findActiveContactName() {
    const heading = Array.from(document.querySelectorAll("h1, [data-test-id*='name'], [data-selenium-test*='record-name']"))
      .map((el) => cleanText(el.textContent || ""))
      .find(Boolean);
    return sanitizeNameValue(heading || "");
  }

  function findActiveContactEmail() {
    const labeledEmail = findLabeledFieldValue(/\bemail\b/i, /\S+@\S+\.\S+/i, 120);
    if (labeledEmail) return labeledEmail.toLowerCase();

    const mailto = Array.from(document.querySelectorAll("a[href^='mailto:']"))
      .map((el) => cleanText(el.textContent || "").toLowerCase())
      .find((text) => /\S+@\S+\.\S+/.test(text));
    if (mailto) return mailto;

    const textEmail = cleanText(document.body?.innerText || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return textEmail ? String(textEmail[0]).toLowerCase() : "";
  }

  function findLabeledFieldValue(labelRegex, valueRegex, maxLen = 120) {
    function isBlockedFieldValue(value) {
      const normalized = cleanText(value || "").toLowerCase();
      return !normalized || normalized === "details" || normalized === "--" || normalized === "-";
    }

    function splitLines(text) {
      return String(text || "")
        .split(/\n+/)
        .map((line) => cleanText(line))
        .filter(Boolean);
    }

    function extractFromLines(lines) {
      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        if (!labelRegex.test(line)) continue;
        for (let j = idx + 1; j < Math.min(lines.length, idx + 5); j += 1) {
          const candidate = cleanText(lines[j] || "");
          if (isBlockedFieldValue(candidate)) continue;
          if (labelRegex.test(candidate)) break;
          if (!valueRegex || valueRegex.test(candidate)) {
            return cleanSummaryText(candidate, maxLen);
          }
        }
      }
      return "";
    }

    const labels = Array.from(document.querySelectorAll("label, dt, th, span, div, p, strong, h4, h5"));
    for (const node of labels) {
      if (!isVisible(node)) continue;
      const labelText = cleanText(node.textContent || "");
      if (!labelText || labelText.length > 60 || !labelRegex.test(labelText)) continue;

      const siblingText = cleanText(node.nextElementSibling?.textContent || "");
      if (!isBlockedFieldValue(siblingText) && !labelRegex.test(siblingText) && (!valueRegex || valueRegex.test(siblingText))) {
        return cleanSummaryText(siblingText, maxLen);
      }

      const row = node.closest("li, tr, [role='row'], section, article, div");
      const rowLines = splitLines(row?.innerText || "");
      const extractedFromRow = extractFromLines(rowLines);
      if (extractedFromRow) {
        return extractedFromRow;
      }
    }

    const bodyLines = splitLines(document.body?.innerText || "");
    const extractedFromBody = extractFromLines(bodyLines);
    if (extractedFromBody) return extractedFromBody;

    return "";
  }

  function findActiveContactOwner() {
    const labeledOwner = findLabeledFieldValue(/\bcontact owner\b/i, /[a-z]/i, 70);
    if (labeledOwner && !/^(?:--|-|n\/a)$/i.test(labeledOwner)) {
      const cleanedOwner = cleanSummaryText(
        labeledOwner
          .replace(/^details\s+/i, "")
          .replace(/\b(phone(?: number)?|email|city|country|office)\b.*$/i, "")
          .trim(),
        70
      );
      if (cleanedOwner) return cleanedOwner;
    }

    const ownerLabels = Array.from(document.querySelectorAll("label, dt, th, [data-test-id*='owner'], [data-selenium-test*='owner']"));
    for (const labelNode of ownerLabels) {
      const labelText = cleanText(labelNode.textContent || "");
      if (!/\bcontact owner\b/i.test(labelText)) continue;

      const siblingText = cleanText(labelNode.nextElementSibling?.textContent || "");
      if (siblingText && !/\bcontact owner\b/i.test(siblingText)) {
        return cleanSummaryText(siblingText, 70);
      }

      const rowText = cleanText(labelNode.closest("tr, [role='row'], li, article, section, div")?.innerText || "");
      const inlineMatch = rowText.match(/contact owner\s*[:\-]?\s*([a-z0-9 .,'-]{2,70})/i);
      if (inlineMatch) {
        return cleanSummaryText(inlineMatch[1], 70);
      }
    }

    const bodyMatch = cleanText(document.body?.innerText || "").match(/contact owner\s*[:\-]?\s*([a-z0-9 .,'-]{2,70})/i);
    if (bodyMatch) {
      return cleanSummaryText(bodyMatch[1], 70);
    }
    return "";
  }

  function findActiveContactPhone() {
    const labeledPhone = findLabeledFieldValue(/\bphone(?: number)?\b/i, /\+?\d[\d\s\-().]{6,}\d/, 30);
    if (labeledPhone) return labeledPhone;

    const telAnchor = Array.from(document.querySelectorAll("a[href^='tel:']"))
      .map((el) => {
        const href = String(el.getAttribute("href") || "");
        const hrefPhone = href.replace(/^tel:/i, "").trim();
        const textPhone = cleanText(el.textContent || "");
        return cleanText(textPhone || hrefPhone);
      })
      .find(Boolean);
    if (telAnchor) return telAnchor;

    const candidates = Array.from(document.querySelectorAll("a, span, div"))
      .map((el) => cleanText(el.textContent || ""))
      .filter((text) => /\+?\d[\d\s\-().]{6,}\d/.test(text));
    return candidates[0] || "";
  }

  function findStrictActiveFieldValue(labelRegex, maxLen = 40) {
    const labels = Array.from(document.querySelectorAll("label, dt, th, span, div, p, strong, h4, h5"));
    const blockedValueRegex = /^(?:--|-|n\/a|details)$/i;
    const blockedLabelLikeRegex =
      /\b(create date|contact owner|owner|phone(?: number)?|email|city|country|office|record id|next activity date|changes saved|save|saving)\b/i;

    function isPlausibleFieldValue(value) {
      const text = cleanText(value || "");
      if (!text) return false;
      if (blockedValueRegex.test(text)) return false;
      if (blockedLabelLikeRegex.test(text)) return false;
      if (text.length > 24) return false;
      if (/\d/.test(text)) return false;
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length > 2) return false;
      return true;
    }

    for (const node of labels) {
      if (!isVisible(node)) continue;
      const labelText = cleanText(node.textContent || "");
      if (!labelText || labelText.length > 60 || !labelRegex.test(labelText)) continue;

      const siblingText = cleanText(node.nextElementSibling?.textContent || "");
      if (siblingText && !labelRegex.test(siblingText) && isPlausibleFieldValue(siblingText)) {
        return cleanSummaryText(siblingText, maxLen);
      }

      const row = node.closest("li, tr, [role='row'], section, article, div");
      const rowLines = String(row?.innerText || "")
        .split(/\n+/)
        .map((line) => cleanText(line))
        .filter(Boolean);
      const labelIndex = rowLines.findIndex((line) => labelRegex.test(line));
      if (labelIndex >= 0) {
        const immediateNext = cleanText(rowLines[labelIndex + 1] || "");
        if (immediateNext && !labelRegex.test(immediateNext) && isPlausibleFieldValue(immediateNext)) {
          return cleanSummaryText(immediateNext, maxLen);
        }
      }
    }

    return "";
  }

  function findActiveContactGender() {
    function normalizeDisplayedFieldValue(value, maxLen = 40) {
      const text = cleanText(String(value || "").replace(/[▾▿▼▼▲△]/g, " "));
      if (!text) return "";
      if (/^(?:--|-|n\/a|details|undo)$/i.test(text)) return "";
      if (/\b(changes saved|create date|contact owner|owner|phone(?: number)?|email|city|country|office|record id|next activity date)\b/i.test(text)) {
        return "";
      }
      if (text.length > 24) return "";
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length > 2) return "";
      return cleanSummaryText(text, maxLen);
    }

    function readFieldValueFromLabel(labelRegex, maxLen = 40) {
      const labels = Array.from(document.querySelectorAll("label, dt, th, span, div, p, strong, h4, h5"));
      for (const node of labels) {
        if (!isVisible(node)) continue;
        const labelText = cleanText(node.textContent || "");
        if (!labelText || !labelRegex.test(labelText)) continue;

        const directCandidates = [
          node.nextElementSibling,
          node.parentElement?.querySelector("[role='combobox']"),
          node.parentElement?.querySelector("[aria-haspopup='listbox']"),
          node.parentElement?.querySelector("button"),
          node.parentElement?.querySelector("[data-test-id]"),
          node.parentElement?.querySelector("[data-testid]")
        ].filter(Boolean);

        for (const candidate of directCandidates) {
          if (!(candidate instanceof Element) || !isVisible(candidate)) continue;
          const firstLine = cleanText(String(candidate.innerText || candidate.textContent || "").split(/\n+/)[0] || "");
          const normalized = normalizeDisplayedFieldValue(firstLine, maxLen);
          if (normalized) return normalized;
        }

        const parentLines = String(node.parentElement?.innerText || "")
          .split(/\n+/)
          .map((line) => cleanText(line))
          .filter(Boolean);
        const labelIndex = parentLines.findIndex((line) => labelRegex.test(line));
        if (labelIndex >= 0) {
          for (let i = labelIndex + 1; i < Math.min(parentLines.length, labelIndex + 4); i += 1) {
            const normalized = normalizeDisplayedFieldValue(parentLines[i], maxLen);
            if (normalized) return normalized;
          }
        }
      }
      return "";
    }

    return (
      readFieldValueFromLabel(/^\s*gender\s*$/i, 40) ||
      readFieldValueFromLabel(/^\s*salutation\s*$/i, 40) ||
      findStrictActiveFieldValue(/\bgender\b/i, 40) ||
      findStrictActiveFieldValue(/\bsalutation\b/i, 40) ||
      ""
    );
  }

  function cleanSummaryText(value, maxLen = 120) {
    const cleaned = cleanText(value || "").replace(/\s*[|•·]\s*/g, " ").trim();
    if (!cleaned) return "";
    return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1).trim()}...` : cleaned;
  }

  function extractRecentNotesFromText(text) {
    const raw = String(text || "");
    let body = raw;
    body = body.replace(/^note by\s+.+?\s+\d{1,2}\s+[a-z]{3,9}\s+\d{4}\s+at\s+\d{1,2}:\d{2}(?:\s*[ap]m)?/i, "");
    body = body.replace(/\bnote description\b/i, "");
    body = body.replace(/\bthis activity is collapsed.*$/i, "");
    body = body.replace(/\bnote\b[:\s-]*/i, "");
    return cleanSummaryText(body, 120);
  }

  function extractRecentTaskTitleFromText(text) {
    const raw = String(text || "");
    const compact = cleanText(raw);
    const dueMatch = compact.match(
      /\bdue:\s*([0-9]{1,2}\s+[a-z]{3,9}\s+[0-9]{4}\s+at\s+[0-9]{1,2}:[0-9]{2})(?:\s*gmt[+-]\d{1,2})?/i
    );
    const dueText = cleanSummaryText(String(dueMatch?.[1] || "").trim(), 45);

    const lines = raw
      .split(/\n+/)
      .map((line) => cleanText(line))
      .filter(Boolean);

    let title = "";
    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
      const line = lines[idx];
      const lowered = line.toLowerCase();
      if (
        lowered.includes("task assigned to") ||
        lowered.startsWith("due:") ||
        lowered.includes("task is incomplete") ||
        lowered.includes("click to mark") ||
        lowered === "incomplete." ||
        lowered === "incomplete"
      ) {
        continue;
      }
      if (line.length >= 2 && line.length <= 110) {
        title = cleanSummaryText(line, 80);
        break;
      }
    }

    if (!title) {
      const inlineTitleMatch = compact.match(
        /\bdue:\s*[a-z0-9 ,:+-]{6,80}(?:\s*gmt[+-]\d{1,2})?\s+(.+?)(?:\s+task is incomplete\b|\s+click to mark\b|$)/i
      );
      if (inlineTitleMatch?.[1]) {
        title = cleanSummaryText(inlineTitleMatch[1], 80);
      }
    }

    if (!title) {
      const titleMatch = compact.match(/\btask\b\s*[:\-]?\s*([^|]{3,140})/i);
      if (titleMatch) {
        title = cleanSummaryText(titleMatch[1], 80);
      }
    }

    if (!title) {
      let fallback = compact.replace(/\b(task|completed|due|owner|assignee)\b/gi, " ");
      title = cleanSummaryText(fallback, 80);
    }

    if (!title) return "";
    return dueText ? `${title}\nDue: ${dueText}` : title;
  }

  function collectRecentActivity(limit = 1) {
    const selectors = [
      "[data-test-id*='timeline'] [role='listitem']",
      "[data-test-id*='activity']",
      "[data-test-id*='engagement']",
      "[data-test-id*='task']",
      "[data-selenium-test*='timeline'] [role='listitem']",
      "[data-selenium-test*='engagement']",
      "[data-selenium-test*='task']",
      "[aria-label*='task' i]",
      "main [role='listitem']",
      "main article",
      "main li"
    ];

    const seenText = new Set();
    const notes = [];
    const tasks = [];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const text = cleanText(node.innerText || node.textContent || "");
        if (!text || text.length < 8) continue;
        if (seenText.has(text)) continue;
        seenText.add(text);

        const lowered = text.toLowerCase();
        if (notes.length < limit && lowered.includes("note")) {
          const note = extractRecentNotesFromText(text);
          if (note) notes.push(note);
        }
        if (tasks.length < limit && (lowered.includes("task") || lowered.includes("to-do") || lowered.includes("todo"))) {
          const task = extractRecentTaskTitleFromText(text);
          if (task) tasks.push(task);
        }

        if (notes.length >= limit && tasks.length >= limit) {
          return { notes, tasks };
        }
      }
    }

    if (tasks.length < limit) {
      const fallbackNodes = Array.from(document.querySelectorAll("main div, main li, main article"));
      for (const node of fallbackNodes) {
        if (!isVisible(node)) continue;
        const text = cleanText(node.innerText || node.textContent || "");
        if (!text) continue;
        const lowered = text.toLowerCase();
        if (!lowered.includes("task assigned to") && !(lowered.includes("task") && lowered.includes("due:"))) continue;
        const task = extractRecentTaskTitleFromText(text);
        if (task) {
          tasks.push(task);
          break;
        }
      }
    }

    return { notes, tasks };
  }

  function getActiveTabContext(countryPrefix = DEFAULT_COUNTRY_CODE, messageText = "") {
    const portalId = getPortalIdFromPath();
    const recordId = getRecordIdFromPath();
    const kind = inferObjectKindFromPath();

    if (kind !== "contact" || !recordId) {
      return { kind, portalId, recordId: "" };
    }

    const name = findActiveContactName();
    const owner = findActiveContactOwner();
    const email = findActiveContactEmail();
    const phone = findActiveContactPhone();
    const gender = findActiveContactGender();
    const recentActivity = collectRecentActivity(1);
    const phoneDigits = normalizePhone(phone, countryPrefix) || "";
    const baseWaUrl = phoneDigits ? `https://web.whatsapp.com/send/?phone=${phoneDigits}&type=phone_number` : "";
    const messageBody = String(messageText || "")
      .replace(/\[name\]/gi, name ? name.split(" ")[0] : "")
      .replace(/\[gender\]/gi, gender)
      .trim();
    const waUrl = baseWaUrl ? (messageBody ? `${baseWaUrl}&text=${encodeURIComponent(messageBody)}` : baseWaUrl) : "";

    return {
      kind,
      portalId,
      recordId,
      contact: {
        key: `record_${recordId}`,
        recordId,
        values: {
          name,
          gender,
          owner,
          email,
          phone,
          record_id: recordId
        },
        phoneDigits,
        waUrl
      },
      owner,
      latestNote: recentActivity.notes[0] || "",
      latestTask: recentActivity.tasks[0] || "",
      recentNotes: recentActivity.notes,
      recentTasks: recentActivity.tasks
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function elementText(element) {
    return cleanText(
      element?.innerText ||
        element?.textContent ||
        element?.getAttribute?.("aria-label") ||
        element?.getAttribute?.("value") ||
        ""
    );
  }

  function isLikelyPropertyFieldHint(hint) {
    const text = String(hint || "").toLowerCase();
    if (!text) return false;
    return (
      text.includes("first name") ||
      text.includes("last name") ||
      text.includes("phone") ||
      text.includes("email") ||
      text.includes("contact owner") ||
      text.includes("city") ||
      text.includes("country") ||
      text.includes("company")
    );
  }

  function hasNoteActionControl(root) {
    if (!root) return false;
    const controls = Array.from(root.querySelectorAll("button, [role='button']"));
    return controls.some((el) => {
      if (!isVisible(el)) return false;
      const text = elementText(el).toLowerCase();
      if (!text) return false;
      return text.includes("save note") || text.includes("create note") || text.includes("log activity") || text.includes("add note");
    });
  }

  function getNoteComposerRoot(editor) {
    const candidates = [
      editor?.closest("[role='dialog']"),
      editor?.closest("form"),
      editor?.closest("section"),
      editor?.closest("article"),
      editor?.closest("div")
    ].filter(Boolean);

    let best = null;
    let bestScore = -Infinity;

    for (const root of candidates) {
      const text = elementText(root).toLowerCase();
      if (!text) continue;

      let score = 0;
      if (text.includes("note")) score += 8;
      if (text.includes("create note") || text.includes("add note")) score += 8;
      if (text.includes("save note") || text.includes("log activity")) score += 6;
      if (hasNoteActionControl(root)) score += 10;
      if (text.includes("first name") || text.includes("last name")) score -= 24;
      if (root.matches("[role='dialog']")) score += 4;

      if (score > bestScore) {
        bestScore = score;
        best = root;
      }
    }

    return bestScore >= 6 ? best : null;
  }

  function findNoteEditor(scope = document, excludedRoot = null) {
    const candidates = Array.from(scope.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']")).filter((el) => {
      if (excludedRoot?.contains(el) || !isVisible(el)) return false;
      if (el.tagName === "INPUT") return false;
      const hint = cleanText(
        el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("data-selenium-test") || ""
      ).toLowerCase();
      if (hint.includes("search")) return false;
      if (isLikelyPropertyFieldHint(hint)) return false;
      return true;
    });

    if (!candidates.length) return null;

    const scored = candidates
      .map((el) => {
        const hint = cleanText(
          el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("data-selenium-test") || ""
        ).toLowerCase();
        const composerRoot = getNoteComposerRoot(el);
        let score = 0;
        if (hint.includes("note")) score += 8;
        if (hint.includes("body")) score += 4;
        if (hint.includes("activity")) score += 3;
        if (hint.includes("comment")) score += 2;
        if (el.closest("[role='dialog']")) score += 4;
        if (el.tagName === "TEXTAREA") score += 3;
        if (composerRoot) score += 12;
        return { el, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0]?.score >= 10 ? scored[0].el : null;
  }

  function clickNoteTrigger() {
    const triggers = Array.from(document.querySelectorAll("button, [role='button']")).filter((el) => {
      if (!isVisible(el)) return false;

      const text = elementText(el).toLowerCase();
      if (!text) return false;
      if (text.includes("cancel") || text.includes("close")) return false;
      if (text.includes("first name") || text.includes("last name")) return false;
      return text === "note" || text.includes("add note") || text.includes("create note");
    });

    if (!triggers.length) return false;
    triggers[0].click();
    return true;
  }

  function findHubSpotCenterTabControl(targetLabel) {
    const desired = String(targetLabel || "").trim().toLowerCase();
    if (!desired) return null;

    const controls = Array.from(document.querySelectorAll("button, [role='button'], [role='tab'], a"));
    let best = null;
    let bestScore = -Infinity;

    for (const el of controls) {
      if (!isVisible(el)) continue;

      const label = elementText(el).toLowerCase();
      if (!label) continue;
      if (label !== desired) continue;

      // Never use side menus/popovers.
      if (el.closest("[role='menu'], [role='listbox'], [data-test-id*='menu'], [data-testid*='menu']")) continue;

      const container = el.closest("[role='tablist'], nav, section, article, main, div") || document.body;
      const scopeText = elementText(container).toLowerCase();

      let score = 0;
      if (scopeText.includes("overview") && scopeText.includes("activities") && scopeText.includes("intelligence")) score += 30;
      if (scopeText.includes("activity") && scopeText.includes("notes") && scopeText.includes("emails")) score += 22;
      if (scopeText.includes("search activities")) score += 16;
      if (scopeText.includes("about this contact")) score -= 30;
      if (scopeText.includes("reorder activity buttons")) score -= 30;
      if (scopeText.includes("log whatsapp message")) score -= 30;
      if (scopeText.includes("more")) score -= 12;
      if (el.getAttribute("role") === "tab") score += 8;
      if (el.closest("main")) score += 6;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return bestScore >= 8 ? best : null;
  }

  function clickActivitiesTab() {
    const tab = findHubSpotCenterTabControl("activities");
    if (!tab) return false;
    tab.click();
    return true;
  }

  function clickNotesActivityTab() {
    const tab = findHubSpotCenterTabControl("notes");
    if (!tab) return false;
    tab.click();
    return true;
  }

  function clickEmailActivityTab() {
    const labels = ["emails", "email"];
    for (const label of labels) {
      const tab = findHubSpotCenterTabControl(label);
      if (!tab) continue;
      tab.click();
      return true;
    }
    return false;
  }

  function setEditorContent(editor, noteBody, noteHtml = "") {
    const richHtml = toInsertableHtml(noteHtml || noteBody);
    const text = htmlToPlainText(richHtml || noteBody).trim();
    if (!text && !richHtml) return false;

    editor.focus();

    if (editor.tagName === "TEXTAREA") {
      editor.value = text;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    if (richHtml && prependEditorHtml(editor, richHtml)) {
      return true;
    }

    editor.textContent = text;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function findCreateNoteButton(editor) {
    const composerRoot = getNoteComposerRoot(editor);
    if (!composerRoot) return null;

    const roots = [composerRoot, editor?.closest("[role='dialog']"), editor?.closest("form")].filter(Boolean);
    const seen = new Set();
    let best = null;
    let bestScore = -Infinity;

    for (const root of roots) {
      const buttons = Array.from(root.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']"));
      for (const button of buttons) {
        if (seen.has(button)) continue;
        seen.add(button);
        if (!isVisible(button)) continue;
        const text = elementText(button).toLowerCase();
        if (!text) continue;
        if (text !== "create note") continue;

        let score = 20;
        const classText = String(button.className || "").toLowerCase();
        if (classText.includes("primary")) score += 4;

        const rootText = elementText(root).toLowerCase();
        if (rootText.includes("first name") || rootText.includes("last name")) score -= 28;
        if (hasNoteActionControl(root)) score += 6;

        if (score > bestScore) {
          bestScore = score;
          best = button;
        }
      }
    }

    return bestScore >= 10 ? best : null;
  }


  async function createNoteOnPage(noteBody, noteHtml = "", existingEditor = null) {
    const richHtml = toInsertableHtml(noteHtml || noteBody);
    const text = htmlToPlainText(richHtml || noteBody).trim();
    if (!text) throw new Error("Note text is empty.");

    let editor = existingEditor;
    for (let i = 0; !existingEditor && i < TIMING.noteComposerOpenAttempts; i += 1) {
      editor = findNoteEditor();
      if (editor && getNoteComposerRoot(editor)) break;

      // Move to contact Activities > Notes context before opening composer.
      if (i === 0 || i % 3 === 0) clickActivitiesTab();
      if (i === 1 || i % 3 === 1) clickNotesActivityTab();
      clickNoteTrigger();
      await sleep(TIMING.noteComposerOpenDelayMs);
    }

    if (!editor?.isConnected || !getNoteComposerRoot(editor)) {
      throw new Error("Could not find note editor on contact page.");
    }

    clearEditorContent(editor);
    if (!setEditorContent(editor, text, richHtml)) {
      throw new Error("Could not write content into the note field.");
    }
    await sleep(TIMING.noteEditorSettleDelayMs);
    return { ok: true };
  }

  function isEditorElement(element) {
    if (!element) return false;
    if (element.matches("textarea, input, [contenteditable='true'], [role='textbox']")) return true;
    return !!element.querySelector("textarea, input, [contenteditable='true'], [role='textbox']");
  }

  function normalizeNoteText(rawText) {
    const lines = String(rawText || "")
      .split(/\n+/)
      .map((line) => cleanText(line))
      .filter(Boolean)
      .filter((line) => {
        const lower = line.toLowerCase();
        if (lower === "note") return false;
        if (lower === "add note") return false;
        if (lower.includes("save note")) return false;
        if (lower === "cancel") return false;
        return true;
      });

    return cleanText(lines.join(" "));
  }

  function getNotesFromPage(limit = 25) {
    const max = Math.max(1, Math.min(100, Number(limit) || 25));
    const selectors = [
      "[data-engagement-type='NOTE']",
      "[data-engagement-type='note']",
      "[data-activity-type='NOTE']",
      "[data-activity-type='note']",
      "[data-testid*='note']",
      "[data-test-id*='note']",
      "[data-selenium-test*='note']",
      "[aria-label*='note' i]"
    ];

    const candidateSet = new Set();
    const candidates = [];

    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const element of elements) {
        if (!(element instanceof Element)) continue;
        const card = element.closest("[role='listitem'], article, li, section") || element;
        if (candidateSet.has(card)) continue;
        candidateSet.add(card);
        candidates.push(card);
      }
    }

    const fallbackCards = Array.from(document.querySelectorAll("[role='listitem'], article"));
    for (const card of fallbackCards) {
      if (candidateSet.has(card)) continue;
      const text = elementText(card).toLowerCase();
      if (!text || !text.includes("note")) continue;
      candidateSet.add(card);
      candidates.push(card);
      if (candidates.length >= 220) break;
    }

    const seen = new Set();
    const notes = [];

    for (const card of candidates) {
      if (!isVisible(card)) continue;
      if (isEditorElement(card)) continue;

      const raw = elementText(card);
      if (!raw) continue;
      if (raw.length < 8 || raw.length > 1400) continue;

      const normalized = normalizeNoteText(raw);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      notes.push(normalized);
      if (notes.length >= max) break;
    }

    return notes;
  }

  async function getNotesOnPage(limit = 25) {
    for (let i = 0; i < TIMING.noteReadRetryAttempts; i += 1) {
      const notes = getNotesFromPage(limit);
      if (notes.length) return notes;
      await sleep(TIMING.noteReadRetryDelayMs);
    }
    return [];
  }

  function findOpenEmailDialog() {
    const dialogs = Array.from(document.querySelectorAll("[role='dialog']")).filter((dialog) => isVisible(dialog));
    if (!dialogs.length) return null;

    let best = null;
    let bestScore = -Infinity;

    for (const dialog of dialogs) {
      const text = elementText(dialog).toLowerCase();
      let score = 0;
      if (text.includes("subject")) score += 6;
      if (text.includes("send")) score += 6;
      if (text.includes("to")) score += 2;
      if (text.includes("email")) score += 4;
      if (text.includes("bcc")) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = dialog;
      }
    }

    return bestScore > 5 ? best : null;
  }

  function getEmailComposerTriggers() {
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], a")).filter(
      (el) => isVisible(el)
    );
    const matches = [];

    for (const el of candidates) {
      const text = elementText(el).toLowerCase();
      const aria = cleanText(el.getAttribute?.("aria-label") || "").toLowerCase();
      const testId = cleanText(
        el.getAttribute?.("data-test-id") || el.getAttribute?.("data-testid") || el.getAttribute?.("data-selenium-test") || ""
      ).toLowerCase();
      const title = cleanText(el.getAttribute?.("title") || "").toLowerCase();
      const hint = `${text} ${aria} ${testId} ${title}`.replace(/\s+/g, " ").trim();
      if (!hint) continue;

      const root = el.closest("[role='dialog'], [role='menu'], [role='toolbar'], [role='tablist'], section, article, li, div") || el;
      const rootText = elementText(root).toLowerCase();

      const opensEmailComposer =
        hint.includes("send email") ||
        hint.includes("create email") ||
        hint.includes("log email") ||
        hint.includes("write email") ||
        hint.includes("new email") ||
        hint === "email" ||
        (hint.includes("compose") && (hint.includes("email") || rootText.includes("emails")));
      if (!opensEmailComposer) continue;

      let score = 0;
      if (hint.includes("send email")) score += 42;
      if (hint.includes("create email")) score += 40;
      if (hint.includes("log email")) score += 34;
      if (hint.includes("write email")) score += 30;
      if (hint.includes("new email")) score += 28;
      if (hint === "email") score += 20;
      if (hint.includes("compose")) score += 12;

      if (hint.includes("note")) score -= 60;
      if (hint.includes("task")) score -= 50;
      if (hint.includes("call")) score -= 40;
      if (hint.includes("meeting")) score -= 40;
      if (hint.includes("whatsapp")) score -= 60;
      if (hint.includes("save")) score -= 28;
      if (hint.includes("cancel") || hint.includes("close")) score -= 50;
      if (hint.includes("more")) score -= 18;

      if (rootText.includes("activity") && rootText.includes("notes") && rootText.includes("emails")) score += 16;
      if (rootText.includes("activities") && rootText.includes("intelligence")) score += 14;
      if (rootText.includes("about this contact")) score -= 40;
      if (rootText.includes("log whatsapp message")) score -= 60;
      if (rootText.includes("save note") || rootText.includes("create note")) score -= 70;
      if (el.getAttribute("role") === "tab") score -= 40;
      if (el.closest("[role='menu'], [role='listbox']")) score -= 26;

      if (score < 18) continue;
      matches.push({ el, score });
    }

    return matches.sort((a, b) => b.score - a.score).map((item) => item.el);
  }

  function getElementHint(el) {
    if (!el) return "";
    const parts = [
      el.getAttribute?.("placeholder"),
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("name"),
      el.getAttribute?.("id"),
      el.getAttribute?.("title"),
      el.getAttribute?.("data-selenium-test"),
      el.getAttribute?.("data-test-id"),
      el.getAttribute?.("data-testid")
    ]
      .map((v) => cleanText(v || ""))
      .filter(Boolean);

    const labelledBy = cleanText(el.getAttribute?.("aria-labelledby") || "");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const labelNode = document.getElementById(id);
        if (labelNode) parts.push(elementText(labelNode));
      }
    }

    const elementId = cleanText(el.id || "");
    if (elementId) {
      try {
        const linkedLabel = document.querySelector(`label[for="${CSS.escape(elementId)}"]`);
        if (linkedLabel) parts.push(elementText(linkedLabel));
      } catch (_error) {
        // Ignore malformed IDs.
      }
    }

    const parentLabel = el.closest?.("label");
    if (parentLabel) parts.push(elementText(parentLabel));

    const fieldRoot = el.closest?.("[data-field], [data-field-name], [data-selenium-test], [data-test-id], [data-testid]");
    if (fieldRoot && fieldRoot !== el) {
      parts.push(cleanText(fieldRoot.getAttribute("data-field-name") || ""));
      const labelInRoot = fieldRoot.querySelector?.("label");
      if (labelInRoot) parts.push(elementText(labelInRoot));
    }

    return cleanText(parts.join(" ")).toLowerCase();
  }

  function isRecipientFieldHint(hint) {
    const text = String(hint || "").toLowerCase();
    return /\b(to|recipient|recipients|from|cc|bcc)\b/.test(text);
  }

  function findSubjectInput(dialog) {
    const candidates = Array.from(dialog.querySelectorAll("input, textarea, [role='textbox']")).filter(
      (el) => isVisible(el) && !el.hasAttribute("disabled") && !el.hasAttribute("readonly")
    );
    if (!candidates.length) return null;

    let best = null;
    let bestScore = -Infinity;

    for (const el of candidates) {
      const hint = getElementHint(el);
      const tag = String(el.tagName || "").toLowerCase();
      const type = String(el.getAttribute("type") || "").toLowerCase();
      let score = 0;

      if (hint.includes("subject")) score += 28;
      if (hint.includes("email subject")) score += 12;
      if (hint === "subject") score += 8;
      if (hint.includes("title")) score += 4;
      if (isRecipientFieldHint(hint)) score -= 40;
      if (hint.includes("search")) score -= 18;
      if (type === "email") score -= 20;
      if (tag === "input") score += 16;
      if (tag === "textarea") score -= 12;
      if (!type || type === "text") score += 2;
      if (el.getAttribute("contenteditable") === "true") score -= 10;
      if (el.getAttribute("role") === "textbox") score -= 8;

      const rect = el.getBoundingClientRect();
      if (rect.height <= 64) score += 2;
      if (rect.width >= 220) score += 1;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return bestScore >= 10 ? best : null;
  }

  async function waitForSubjectInput(dialog, attempts = 5, delayMs = 160) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const subjectInput = findSubjectInput(dialog);
      if (subjectInput) return subjectInput;
      await sleep(delayMs);
    }
    return null;
  }

  function getIframeEditorElement(iframe) {
    if (!(iframe instanceof HTMLIFrameElement)) return null;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return null;

      if (doc.body && doc.body.isContentEditable) {
        return doc.body;
      }

      const candidates = Array.from(doc.querySelectorAll("[contenteditable='true'], textarea, [role='textbox']")).filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = doc.defaultView?.getComputedStyle(el);
        if (!style) return true;
        if (style.display === "none" || style.visibility === "hidden") return false;
        return true;
      });
      return candidates[0] || null;
    } catch (_error) {
      return null;
    }
  }

  function scoreBodyEditorCandidate(el) {
    const hint = getElementHint(el);
    const tag = String(el.tagName || "").toLowerCase();
    const classText = cleanText(
      `${el.className || ""} ${el.getAttribute?.("data-slate-editor") || ""} ${el.getAttribute?.("data-editor") || ""}`
    ).toLowerCase();
    const contentEditableAttr = String(el.getAttribute?.("contenteditable") || "").toLowerCase();

    let score = 0;
    if (hint.includes("message") || hint.includes("body") || hint.includes("email") || hint.includes("content")) score += 12;
    if (hint.includes("rich text") || hint.includes("editor")) score += 8;
    if (hint.includes("subject")) score -= 20;
    if (isRecipientFieldHint(hint)) score -= 24;
    if (hint.includes("search")) score -= 14;
    if (el.closest("[role='toolbar']")) score -= 16;
    if (classText.includes("prosemirror")) score += 18;
    if (classText.includes("ql-editor")) score += 16;
    if (classText.includes("slate")) score += 12;
    if (classText.includes("prosemirror__dom")) score -= 28;
    if (contentEditableAttr === "false") score -= 26;
    if (tag !== "iframe" && tag !== "textarea" && tag !== "input" && contentEditableAttr !== "true") {
      const hasEditableDescendant = !!el.querySelector?.("[contenteditable='true'], textarea, input, [role='textbox']");
      if (!hasEditableDescendant) score -= 14;
    }

    if (tag === "iframe") {
      if (getIframeEditorElement(el)) score += 12;
      else score -= 12;
    } else {
      if (el.getAttribute("contenteditable") === "true") score += 8;
      if (tag === "textarea") score += 4;
      if (tag === "div") score += 2;
    }

    const rect = el.getBoundingClientRect();
    if (rect.height >= 120) score += 8;
    if (rect.width >= 280) score += 2;
    return score;
  }

  function getBodyEditorCandidates(dialog) {
    const selector = "[contenteditable='true'], textarea, [role='textbox'], iframe, [data-slate-editor='true'], .ProseMirror, .ql-editor";
    const roots = [dialog, document].filter(Boolean);
    const seen = new Set();
    const candidates = [];

    for (const root of roots) {
      const nodes = Array.from(root.querySelectorAll(selector)).filter((el) => isVisible(el));
      for (const node of nodes) {
        if (!(node instanceof Element)) continue;
        if (seen.has(node)) continue;
        seen.add(node);
        candidates.push(node);
      }
    }

    if (!candidates.length) return [];

    return candidates
      .map((el) => ({ el, score: scoreBodyEditorCandidate(el) }))
      .sort((a, b) => b.score - a.score)
      .filter((item) => item.score >= 8)
      .map((item) => item.el);
  }

  function findBodyEditor(dialog) {
    const candidates = getBodyEditorCandidates(dialog);
    if (!candidates?.length) return null;
    return candidates[0] || null;
  }

  function setInputValue(input, value) {
    const next = String(value || "");
    input.focus();

    if (input.tagName === "INPUT" || input.tagName === "TEXTAREA") {
      const proto = input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
      const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
      if (typeof setter === "function") {
        setter.call(input, next);
      } else {
        input.value = next;
      }
    } else {
      input.textContent = next;
    }
    dispatchInputLikeEvents(input);
  }

  function dispatchInputLikeEvents(element) {
    if (!element) return;
    const ownerWin = element.ownerDocument?.defaultView || window;
    const EventCtor = ownerWin.Event || Event;
    const InputEventCtor = ownerWin.InputEvent;
    if (typeof InputEventCtor === "function") {
      element.dispatchEvent(new InputEventCtor("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText" }));
      element.dispatchEvent(new InputEventCtor("input", { bubbles: true, inputType: "insertText" }));
    } else {
      element.dispatchEvent(new EventCtor("input", { bubbles: true }));
    }
    element.dispatchEvent(new EventCtor("change", { bubbles: true }));
  }

  function decodeHtmlEntities(value) {
    const raw = String(value || "");
    if (!raw.includes("&")) return raw;
    // A textarea's content is RCDATA: entities decode, markup does not become
    // elements. Safe for strings we can't prove are markup.
    const holder = document.createElement("textarea");
    holder.innerHTML = raw;
    return holder.value;
  }

  function htmlToPlainText(value) {
    const raw = String(value || "");
    if (!raw) return "";
    if (!/<[a-z][\s\S]*>/i.test(raw)) return cleanText(decodeHtmlEntities(raw));
    const container = document.createElement("div");
    container.innerHTML = raw;
    return cleanText(container.textContent || "");
  }

  function sanitizeEditorHtml(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const template = document.createElement("template");
    template.innerHTML = raw;
    template.content.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((node) => node.remove());
    template.content.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) {
          el.removeAttribute(attr.name);
        }
      }
    });
    return template.innerHTML.trim();
  }

  function toInsertableHtml(value) {
    const cleaned = sanitizeEditorHtml(value);
    if (!cleaned) return "";
    if (!/<[a-z][\s\S]*>/i.test(cleaned)) {
      return escapeHtml(cleaned).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
    }
    return cleaned;
  }

  function resolveEditorTarget(editor) {
    if (editor instanceof HTMLIFrameElement) return getIframeEditorElement(editor);
    if (!(editor instanceof Element)) return null;
    if (editor.matches("textarea, input") || editor.getAttribute("contenteditable") === "true") return editor;

    const ancestorEditable = editor.closest("[contenteditable='true'], textarea, input, [role='textbox']");
    if (ancestorEditable instanceof Element) return ancestorEditable;

    const nestedEditable = editor.querySelector("[contenteditable='true'], textarea, input, [role='textbox']");
    if (nestedEditable instanceof Element) return nestedEditable;
    return editor;
  }

  function prependInContentEditable(target, insertHtml) {
    if (!target) return false;

    if (!target.isContentEditable) {
      return false;
    }
    const ownerDoc = target.ownerDocument || document;
    const ownerWin = ownerDoc.defaultView || window;
    const before = cleanText(target.textContent || "");

    target.focus();

    const selection = ownerWin.getSelection?.();
    if (selection) {
      if (!selection.anchorNode || !target.contains(selection.anchorNode)) {
        const range = ownerDoc.createRange();
        range.selectNodeContents(target);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    let applied = false;
    if (insertHtml && typeof ownerDoc.execCommand === "function") {
      applied = ownerDoc.execCommand("insertHTML", false, `${insertHtml}<p><br></p>`);
    }
    if (!applied) {
      const sig = target.querySelector(".hs-signature");
      if (sig) sig.remove();
      const currentHtml = String(target.innerHTML || "");
      target.innerHTML = currentHtml ? `${insertHtml}<p><br></p>${currentHtml}` : insertHtml;
      if (sig) target.appendChild(sig);
      applied = true;
    }
    if (!applied) return false;

    const after = cleanText(target.textContent || "");
    dispatchInputLikeEvents(target);
    return after.length > before.length;
  }

  function activateBodyEditor(dialog) {
    const selector = "[class*='ProseMirror'], [data-slate-editor='true'], [role='textbox'], textarea, iframe";
    const elements = Array.from(dialog.querySelectorAll(selector)).filter((el) => isVisible(el));
    if (!elements.length) return false;

    const sorted = elements
      .map((el) => ({ el, score: scoreBodyEditorCandidate(el) }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.el);

    let clicked = false;
    for (const el of sorted.slice(0, 5)) {
      try {
        el.focus?.();
        el.click?.();
        clicked = true;
      } catch (_error) {
        // Keep trying.
      }
    }
    return clicked;
  }

  function prependEditorHtml(editor, html) {
    const value = toInsertableHtml(html);
    if (!value) return false;
    const target = resolveEditorTarget(editor);
    if (!target) return false;
    const plain = htmlToPlainText(value);

    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      if (!plain) return false;
      const current = String(target.value || "");
      target.value = current ? `${plain}\n\n${current}` : plain;
      dispatchInputLikeEvents(target);
      return true;
    }

    if (prependInContentEditable(target, value)) return true;
    return false;
  }

  function clearEditorContent(editor) {
    const target = resolveEditorTarget(editor);
    if (!target) return false;

    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      if (String(target.value || "").length === 0) return true;
      target.value = "";
      dispatchInputLikeEvents(target);
      return true;
    }

    const root = target.closest(".ProseMirror") || target;
    if (!(root instanceof Element)) return false;

    const signature = root.querySelector(".hs-signature");
    if (signature instanceof Element && root.contains(signature)) {
      while (root.firstChild && root.firstChild !== signature) {
        root.removeChild(root.firstChild);
      }
      dispatchInputLikeEvents(root);
      return true;
    }

    if (root.innerHTML) {
      root.innerHTML = "";
      dispatchInputLikeEvents(root);
    }
    return true;
  }

  function shouldPreserveEmailBodyNode(node) {
    if (!(node instanceof Node)) return false;
    if (node.nodeType !== Node.ELEMENT_NODE) return false;

    const element = node;
    if (!(element instanceof Element)) return false;
    return element.classList.contains("hs-signature");
  }

  function clearEditorContentPreservingEmbeds(editor) {
    const target = resolveEditorTarget(editor);
    if (!target) return false;

    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      return clearEditorContent(editor);
    }

    const root = target.closest(".ProseMirror") || target;
    if (!(root instanceof Element)) return false;

    const nodesToRemove = [];
    for (const child of Array.from(root.childNodes)) {
      if (!shouldPreserveEmailBodyNode(child)) {
        nodesToRemove.push(child);
      }
    }

    if (nodesToRemove.length) {
      for (const child of nodesToRemove) {
        root.removeChild(child);
      }
      dispatchInputLikeEvents(root);
    }
    return true;
  }

  async function applyEmailTemplateOnPage(subject, body, bodyHtml = "") {
    const dialog = findOpenEmailDialog();
    if (!dialog) {
      throw new Error("Open a HubSpot Email composer first.");
    }

    const subjectText = String(subject || "").trim();
    if (subjectText) {
      const subjectInput = await waitForSubjectInput(dialog);
      if (!subjectInput) {
        throw new Error("Could not find the email Subject field.");
      }
      setInputValue(subjectInput, subjectText);
    }

    const bodyText = String(body || "").trim();
    const bodyRichHtml = String(bodyHtml || "").trim();
    const bodyInsertHtml = toInsertableHtml(bodyRichHtml || bodyText);
    if (bodyInsertHtml) {
      let bodyApplied = false;
      for (let attempt = 0; attempt < 6 && !bodyApplied; attempt += 1) {
        const bodyEditors = getBodyEditorCandidates(dialog);
        for (const bodyEditor of bodyEditors) {
          clearEditorContentPreservingEmbeds(bodyEditor);
          if (prependEditorHtml(bodyEditor, bodyInsertHtml)) {
            bodyApplied = true;
            break;
          }
        }
        if (bodyApplied) break;

        activateBodyEditor(dialog);
        await sleep(180);
        if (attempt === 2) {
          const fallbackEditor = findBodyEditor(dialog);
          if (fallbackEditor) {
            clearEditorContentPreservingEmbeds(fallbackEditor);
          }
          if (fallbackEditor && prependEditorHtml(fallbackEditor, bodyInsertHtml)) {
            bodyApplied = true;
            break;
          }
        }
      }

      if (!bodyApplied) {
        throw new Error("Could not write content into the email body field.");
      }
    }
  }

  function clickEmailComposerTrigger() {
    const triggers = getEmailComposerTriggers();
    if (!triggers.length) return false;
    triggers[0].click();
    return true;
  }

  async function openEmailComposerOnPage() {
    for (let i = 0; i < TIMING.emailComposerOpenAttempts; i += 1) {
      const existing = findOpenEmailDialog();
      if (existing) return;
      if (i === 0 || i % 3 === 0) clickActivitiesTab();
      if (i === 1 || i % 3 === 1) clickEmailActivityTab();
      clickEmailComposerTrigger();
      await sleep(TIMING.emailComposerOpenDelayMs);
    }
  }

  async function openEmailAndApplyTemplateOnPage(subject, body, bodyHtml = "") {
    await openEmailComposerOnPage();
    await applyEmailTemplateOnPage(subject, body, bodyHtml);
  }

  const contactTemplateState = {
    templates: {
      email: [],
      note: [],
      whatsapp: []
    },
    cloudAuthList: [],
    templateUsageByContact: {},
    countryPrefix: DEFAULT_COUNTRY_CODE,
    phoneFlagsEnabled: true,
    phoneFlagsExcludedIsos: []
  };

  function normalizePhoneFlagsExcludedIsos(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((iso) => String(iso || "").trim().toLowerCase())
      .filter((iso) => /^[a-z]{2}$/.test(iso));
  }

  function applyContactEnhancerSettings(settings) {
    const source = settings && typeof settings === "object" ? settings : null;
    if (source) {
      if (Object.prototype.hasOwnProperty.call(source, "countryPrefix")) {
        contactTemplateState.countryPrefix = String(source.countryPrefix || DEFAULT_COUNTRY_CODE);
      }
      const flagSignatureBefore = `${contactTemplateState.phoneFlagsEnabled}|${contactTemplateState.phoneFlagsExcludedIsos.join(",")}`;
      if (Object.prototype.hasOwnProperty.call(source, "phoneFlagsEnabled")) {
        contactTemplateState.phoneFlagsEnabled = source.phoneFlagsEnabled !== false;
      }
      if (Object.prototype.hasOwnProperty.call(source, "phoneFlagsExcludedIsos")) {
        contactTemplateState.phoneFlagsExcludedIsos = normalizePhoneFlagsExcludedIsos(source.phoneFlagsExcludedIsos);
      }
      const flagSignatureAfter = `${contactTemplateState.phoneFlagsEnabled}|${contactTemplateState.phoneFlagsExcludedIsos.join(",")}`;
      if (flagSignatureBefore !== flagSignatureAfter) {
        hidePhoneFlagTooltip();
        for (const flag of document.querySelectorAll(".cp-phone-flag")) flag.remove();
        scheduleContactEnhancers();
      }
    }
  }

  function normalizeInlineUsageKind(kind) {
    const key = String(kind || "").toLowerCase();
    return key === "whatsapp" ? "whatsapp" : "email";
  }

  function normalizeInlineTemplateUsageMap(rawUsage) {
    if (!rawUsage || typeof rawUsage !== "object") return {};
    const normalized = {};

    for (const [contactKeyInput, usageInput] of Object.entries(rawUsage)) {
      const contactKey = String(contactKeyInput || "").trim();
      if (!contactKey) continue;
      const usage = usageInput && typeof usageInput === "object" ? usageInput : {};
      const emailRaw = usage.email && typeof usage.email === "object" ? usage.email : {};
      const whatsappRaw = usage.whatsapp && typeof usage.whatsapp === "object" ? usage.whatsapp : {};

      const email = {};
      for (const [templateIdInput, usedInput] of Object.entries(emailRaw)) {
        const templateId = String(templateIdInput || "").trim();
        if (!templateId || usedInput !== true) continue;
        email[templateId] = true;
      }

      const whatsapp = {};
      for (const [templateIdInput, usedInput] of Object.entries(whatsappRaw)) {
        const templateId = String(templateIdInput || "").trim();
        if (!templateId || usedInput !== true) continue;
        whatsapp[templateId] = true;
      }

      normalized[contactKey] = { email, whatsapp };
    }

    return normalized;
  }

  function normalizeInlineCloudAuthList(rawList, rawPrimary) {
    const source = [];
    if (Array.isArray(rawList)) source.push(...rawList);
    if (rawPrimary && typeof rawPrimary === "object") source.push(rawPrimary);

    const normalized = [];
    const seen = new Set();
    for (const item of source) {
      const organizationId = cleanText(item?.organizationId || "");
      if (!organizationId || seen.has(organizationId)) continue;
      seen.add(organizationId);
      normalized.push({
        organizationId,
        apiToken: cleanText(item?.apiToken || ""),
        apiBaseUrl: cleanText(item?.apiBaseUrl || "") || CLOUD_API_BASE_URL,
        organizationName: cleanText(item?.organizationName || ""),
        organizationSlug: cleanText(item?.organizationSlug || ""),
        templatesPaused: item?.templatesPaused === true
      });
    }
    return normalized;
  }

  function isInlinePlaceholderTemplate(template) {
    return cleanText(template?.name || "") === "Template 1";
  }

  function filterInlineTemplates(templates, kind) {
    const source = Array.isArray(templates) ? templates : [];
    return source.filter((template) => !isInlinePlaceholderTemplate(template, kind));
  }

  function getInlineCloudCacheKeys(organizationIdInput) {
    const organizationId = cleanText(organizationIdInput || "");
    if (!organizationId) return null;
    return {
      emailKey: `${CLOUD_EMAIL_CACHE_PREFIX}${organizationId}`,
      whatsappKey: `${CLOUD_WHATSAPP_CACHE_PREFIX}${organizationId}`,
      noteKey: `${CLOUD_NOTE_CACHE_PREFIX}${organizationId}`
    };
  }

  function getInlineRawCloudTemplateId(item, organizationIdInput = "") {
    const organizationId = cleanText(item?.organizationId || organizationIdInput || "");
    const directCloudId = cleanText(item?.cloudId || "").replace(new RegExp(`^${CLOUD_TEMPLATE_ID_PREFIX}`), "");
    if (directCloudId) {
      if (organizationId && directCloudId.startsWith(`${organizationId}_`)) {
        return directCloudId.slice(organizationId.length + 1);
      }
      return directCloudId;
    }

    const directId = cleanText(item?.id || "").replace(new RegExp(`^${CLOUD_TEMPLATE_ID_PREFIX}`), "");
    if (!directId) return "";
    if (organizationId && directId.startsWith(`${organizationId}_`)) {
      return directId.slice(organizationId.length + 1);
    }
    return directId;
  }

  function buildInlineCloudTemplateId(item, organizationIdInput = "") {
    const cloudId = getInlineRawCloudTemplateId(item, organizationIdInput);
    if (!cloudId) return "";
    const orgId = cleanText(item?.organizationId || organizationIdInput || "");
    if (orgId) return `${CLOUD_TEMPLATE_ID_PREFIX}${orgId}_${cloudId}`;
    return `${CLOUD_TEMPLATE_ID_PREFIX}${cloudId}`;
  }

  function normalizeInlineCloudEmailTemplates(rawTemplates, organizationIdInput = "") {
    const source = Array.isArray(rawTemplates) ? rawTemplates : [];
    const templates = [];
    const seen = new Set();

    for (const item of source) {
      const id = buildInlineCloudTemplateId(item, organizationIdInput);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const cloudId = getInlineRawCloudTemplateId(item, organizationIdInput);
      templates.push({
        id,
        cloudId,
        organizationId: cleanText(item?.organizationId || organizationIdInput || ""),
        name: cleanText(item?.name || "Untitled") || "Untitled",
        subject: String(item?.subject || ""),
        body: String(item?.body || ""),
        source: "cloud"
      });
    }

    return templates;
  }

  function normalizeInlineCloudWhatsappTemplates(rawTemplates, organizationIdInput = "") {
    const source = Array.isArray(rawTemplates) ? rawTemplates : [];
    const templates = [];
    const seen = new Set();

    for (const item of source) {
      const id = buildInlineCloudTemplateId(item, organizationIdInput);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const cloudId = getInlineRawCloudTemplateId(item, organizationIdInput);
      templates.push({
        id,
        cloudId,
        organizationId: cleanText(item?.organizationId || organizationIdInput || ""),
        name: cleanText(item?.name || "Untitled") || "Untitled",
        body: String(item?.body || ""),
        source: "cloud"
      });
    }

    return templates;
  }

  function normalizeInlineCloudNoteTemplates(rawTemplates, organizationIdInput = "") {
    const source = Array.isArray(rawTemplates) ? rawTemplates : [];
    const templates = [];
    const seen = new Set();

    for (const item of source) {
      const id = buildInlineCloudTemplateId(item, organizationIdInput);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const cloudId = getInlineRawCloudTemplateId(item, organizationIdInput);
      templates.push({
        id,
        cloudId,
        organizationId: cleanText(item?.organizationId || organizationIdInput || ""),
        name: cleanText(item?.name || "Untitled") || "Untitled",
        body: String(item?.body || ""),
        source: "cloud"
      });
    }

    return templates;
  }

  function mergeInlineTemplates(localTemplates, cloudTemplates) {
    const merged = [];
    const seen = new Set();
    const source = [...(Array.isArray(localTemplates) ? localTemplates : []), ...(Array.isArray(cloudTemplates) ? cloudTemplates : [])];

    for (const template of source) {
      const id = cleanText(template?.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(template);
    }

    return merged;
  }

  function readStorageArea(areaName, keys) {
    return new Promise((resolve) => {
      try {
        const area = chrome.storage?.[areaName];
        if (!area || typeof area.get !== "function") {
          resolve({});
          return;
        }
        area.get(keys, (result) => {
          if (chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(result || {});
        });
      } catch (_error) {
        resolve({});
      }
    });
  }

  function getInlineUsageContactKey() {
    const recordId = String(getRecordIdFromPath() || "").replace(/\D/g, "");
    if (!recordId) return "";
    return `record_${recordId}`;
  }

  function getInlineTemplateUsageForContact(contactKey) {
    const key = String(contactKey || "").trim();
    if (!key) return null;
    if (!contactTemplateState.templateUsageByContact[key]) {
      contactTemplateState.templateUsageByContact[key] = {
        email: Object.create(null),
        whatsapp: Object.create(null)
      };
    }
    return contactTemplateState.templateUsageByContact[key];
  }

  function hasInlineWhatsappTemplateBeenUsed(templateIdInput) {
    const contactKey = getInlineUsageContactKey();
    const templateId = String(templateIdInput || "").trim();
    if (!contactKey || !templateId) return false;

    return contactTemplateState.templateUsageByContact[contactKey]?.whatsapp[templateId] === true;
  }

  function persistInlineTemplateUsage() {
    const payload = normalizeInlineTemplateUsageMap(contactTemplateState.templateUsageByContact);
    contactTemplateState.templateUsageByContact = payload;
    try {
      chrome.storage.local.set({ [TEMPLATE_USAGE_LOCAL_KEY]: payload });
    } catch (_error) {
      // Ignore storage write failures.
    }
  }

  function normalizeInlineTemplateStatsMap(rawStats) {
    const source = rawStats && typeof rawStats === "object" ? rawStats : {};
    const normalized = { email: {}, whatsapp: {} };

    for (const kind of ["email", "whatsapp"]) {
      const kindStats = source[kind] && typeof source[kind] === "object" ? source[kind] : {};
      for (const [templateIdInput, statsInput] of Object.entries(kindStats)) {
        const templateId = cleanText(templateIdInput || "");
        if (!templateId || !statsInput || typeof statsInput !== "object") continue;
        const count = Number(statsInput.count);
        const lastUsedAt = Number(statsInput.lastUsedAt);
        if (!Number.isFinite(count) || count <= 0) continue;
        normalized[kind][templateId] = {
          count: Math.max(1, Math.floor(count)),
          lastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt > 0 ? Math.floor(lastUsedAt) : 0
        };
      }
    }

    return normalized;
  }

  async function recordInlineTemplateStatsUse(kind, templateIdInput) {
    const usageKind = normalizeInlineUsageKind(kind);
    const templateId = cleanText(templateIdInput || "");
    if (!templateId) return;

    try {
      const current = await chrome.storage.local.get([TEMPLATE_STATS_LOCAL_KEY]);
      const stats = normalizeInlineTemplateStatsMap(current?.[TEMPLATE_STATS_LOCAL_KEY]);
      const existing = stats[usageKind]?.[templateId] || { count: 0, lastUsedAt: 0 };
      stats[usageKind][templateId] = {
        count: Math.max(0, Number(existing.count || 0)) + 1,
        lastUsedAt: Date.now()
      };
      await chrome.storage.local.set({ [TEMPLATE_STATS_LOCAL_KEY]: stats });
    } catch (_error) {
      // Ignore storage write failures.
    }
  }

  function markInlineWhatsappTemplateUsed(templateIdInput) {
    const contactKey = getInlineUsageContactKey();
    const templateId = String(templateIdInput || "").trim();
    if (!contactKey || !templateId) return;

    const usage = getInlineTemplateUsageForContact(contactKey);
    if (!usage) return;
    usage.whatsapp[templateId] = true;
    persistInlineTemplateUsage();
    void recordInlineTemplateStatsUse("whatsapp", templateId);
  }

  function findInlineCloudAuthByOrganizationId(organizationIdInput) {
    const organizationId = cleanText(organizationIdInput || "");
    if (!organizationId) return null;
    return (contactTemplateState.cloudAuthList || []).find((item) => cleanText(item?.organizationId || "") === organizationId) || null;
  }

  // Background checks the website for template changes (throttled per team);
  // new templates arrive through the storage listener above.
  function requestCloudTemplateRefresh() {
    try {
      void chrome.runtime.sendMessage({ type: MESSAGE_TYPES.REFRESH_CLOUD_TEMPLATES }).catch(() => {});
    } catch (_error) {
      // Extension was reloaded; this page's script is orphaned.
    }
  }

  async function trackInlineCloudTemplateUse(template) {
    if (!template || String(template?.source || "").toLowerCase() !== "cloud") return false;

    const cloudId = cleanText(template?.cloudId || "");
    const organizationId = cleanText(template?.organizationId || "");
    if (!cloudId || !organizationId) return false;

    const auth = findInlineCloudAuthByOrganizationId(organizationId);
    const apiToken = cleanText(auth?.apiToken || "");
    const apiBaseUrl = cleanText(auth?.apiBaseUrl || "");
    if (!apiToken || !apiBaseUrl) return false;

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.TRACK_CLOUD_TEMPLATE_USE,
        organizationId,
        apiBaseUrl,
        apiToken,
        templateId: cloudId
      });
      return !!response?.ok;
    } catch (_error) {
      return false;
    }
  }

  function inlineTokenKey(input) {
    return String(input || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function applyInlineTemplateTokens(text, tokens) {
    return String(text || "").replace(/\[([a-z0-9_]+)\]/gi, (_match, tokenName) => {
      const key = inlineTokenKey(tokenName);
      if (!Object.prototype.hasOwnProperty.call(tokens, key)) return "";
      return String(tokens[key] || "");
    });
  }

  function buildInlineTemplateTokens(context) {
    const values = context?.contact?.values || {};
    const fullName = cleanText(values.name || "");
    const firstName = fullName ? fullName.split(" ")[0] : "";
    const resolvedName = firstName || fullName;
    const gender = resolveGenderValue(values);
    const owner = cleanText(values.owner || context?.owner || "");
    const email = cleanText(values.email || "");
    const phone = cleanText(values.phone || "");
    const recordId = cleanText(context?.recordId || values.record_id || "");

    const tokens = {
      name: resolvedName,
      gender,
      first_name: resolvedName,
      firstname: resolvedName,
      full_name: fullName,
      fullname: fullName,
      owner,
      email,
      phone,
      record_id: recordId,
      recordid: recordId
    };

    for (const [rawKey, rawValue] of Object.entries(values)) {
      const key = inlineTokenKey(rawKey);
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(tokens, key)) continue;
      tokens[key] = cleanText(rawValue || "");
    }

    return tokens;
  }

  // Tokens the extension computes itself; HubSpot's raw properties never
  // replace them (e.g. [firstname] is the first word of the shown name).
  const BUILT_IN_TOKEN_KEYS = new Set([
    "name", "gender", "first_name", "firstname", "full_name", "fullname",
    "owner", "email", "phone", "record_id", "recordid"
  ]);

  // Sidebar tokens plus every property on the record, keyed by HubSpot's
  // internal name ([program_interest]), which is what the website's property
  // picker inserts. If HubSpot can't be read, the sidebar tokens still work.
  async function buildFullTemplateTokens(context) {
    const tokens = buildInlineTemplateTokens(context);
    try {
      const [props, defs] = await Promise.all([
        fetchHubSpotContactProperties(context?.recordId),
        fetchHubSpotPropertyDefinitions().catch(() => null)
      ]);
      if (!props) return tokens;
      const defByName = new Map((defs || []).map((def) => [def.name, def]));
      for (const [name, raw] of Object.entries(props)) {
        const key = inlineTokenKey(name);
        if (!key || BUILT_IN_TOKEN_KEYS.has(key)) continue;
        tokens[key] = formatPropertyForTemplate(raw, defByName.get(name));
      }
    } catch (_error) {
      // Sidebar tokens only.
    }
    return tokens;
  }

  function escapeTokenValues(tokens) {
    const escaped = {};
    for (const [key, value] of Object.entries(tokens || {})) {
      escaped[key] = escapeHtml(String(value || ""));
    }
    return escaped;
  }

  function normalizeInlineEmailTemplates(rawTemplates) {
    const source = Array.isArray(rawTemplates) ? rawTemplates : [];
    return source
      .map((template, index) => ({
        id: cleanText(template?.id || `email_template_${index + 1}`),
        name: cleanText(template?.name || `Email ${index + 1}`) || `Email ${index + 1}`,
        subject: String(template?.subject || ""),
        body: String(template?.body || ""),
        source: "local"
      }))
      .filter((template) => !!template.id);
  }

  function normalizeInlineNoteTemplates(rawTemplates) {
    const source = Array.isArray(rawTemplates) ? rawTemplates : [];
    return source
      .map((template, index) => ({
        id: cleanText(template?.id || `note_template_${index + 1}`),
        name: cleanText(template?.name || `Note ${index + 1}`) || `Note ${index + 1}`,
        body: String(template?.body || ""),
        source: "local"
      }))
      .filter((template) => !!template.id);
  }

  function normalizeInlineWhatsappTemplates(rawTemplates) {
    const source = Array.isArray(rawTemplates) ? rawTemplates : [];
    return source
      .map((template, index) => ({
        id: cleanText(template?.id || `wa_template_${index + 1}`),
        name: cleanText(template?.name || `WhatsApp ${index + 1}`) || `WhatsApp ${index + 1}`,
        body: String(template?.body || ""),
        source: "local"
      }))
      .filter((template) => !!template.id);
  }

  async function refreshContactTemplateData() {
    const local = await readStorageArea("local", [
      EMAIL_TEMPLATES_LOCAL_KEY,
      NOTE_TEMPLATES_LOCAL_KEY,
      WHATSAPP_TEMPLATES_LOCAL_KEY,
      TEMPLATE_USAGE_LOCAL_KEY,
      CLOUD_AUTH_LIST_LOCAL_KEY,
      CLOUD_AUTH_LOCAL_KEY
    ]);
    const cloudAuthList = normalizeInlineCloudAuthList(local?.[CLOUD_AUTH_LIST_LOCAL_KEY], local?.[CLOUD_AUTH_LOCAL_KEY]);
    contactTemplateState.cloudAuthList = cloudAuthList;
    const cacheKeys = [];
    for (const auth of cloudAuthList) {
      if (auth?.templatesPaused === true) continue;
      const keys = getInlineCloudCacheKeys(auth.organizationId);
      if (!keys) continue;
      cacheKeys.push(keys.emailKey, keys.whatsappKey, keys.noteKey);
    }
    const cloudCache = cacheKeys.length ? await readStorageArea("local", cacheKeys) : {};

    const cloudEmailTemplates = [];
    const cloudWhatsappTemplates = [];
    const cloudNoteTemplates = [];
    for (const auth of cloudAuthList) {
      if (auth?.templatesPaused === true) continue;
      const keys = getInlineCloudCacheKeys(auth.organizationId);
      if (!keys) continue;
      cloudEmailTemplates.push(...normalizeInlineCloudEmailTemplates(cloudCache?.[keys.emailKey], auth.organizationId));
      cloudWhatsappTemplates.push(...normalizeInlineCloudWhatsappTemplates(cloudCache?.[keys.whatsappKey], auth.organizationId));
      cloudNoteTemplates.push(...normalizeInlineCloudNoteTemplates(cloudCache?.[keys.noteKey], auth.organizationId));
    }

    contactTemplateState.templates.email = mergeInlineTemplates(
      filterInlineTemplates(normalizeInlineEmailTemplates(local?.[EMAIL_TEMPLATES_LOCAL_KEY]), "email"),
      cloudEmailTemplates
    );
    contactTemplateState.templates.note = mergeInlineTemplates(
      filterInlineTemplates(normalizeInlineNoteTemplates(local?.[NOTE_TEMPLATES_LOCAL_KEY]), "note"),
      cloudNoteTemplates
    );
    contactTemplateState.templates.whatsapp = mergeInlineTemplates(
      filterInlineTemplates(normalizeInlineWhatsappTemplates(local?.[WHATSAPP_TEMPLATES_LOCAL_KEY]), "whatsapp"),
      cloudWhatsappTemplates
    );
    contactTemplateState.templateUsageByContact = normalizeInlineTemplateUsageMap(local?.[TEMPLATE_USAGE_LOCAL_KEY]);
  }

  function whatsappIcon() {
    return "<svg viewBox='0 0 24 24' aria-hidden='true' style='fill:currentColor;stroke:none'><path d='M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.36c0-4.54 3.7-8.23 8.24-8.23a8.2 8.2 0 0 1 8.23 8.24c0 4.54-3.7 8.25-8.23 8.25zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.79.98-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43l-.48-.01c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.25 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z'></path></svg>";
  }

  function isContactRecordPage() {
    return inferObjectKindFromPath() === "contact" && !!getRecordIdFromPath();
  }

  function getInlineContactContextOrThrow() {
    const context = getActiveTabContext(contactTemplateState.countryPrefix, "");
    if (context?.kind !== "contact" || !context?.recordId) {
      throw new Error("Open a HubSpot contact record page first.");
    }
    return context;
  }

  async function applyInlineEmailTemplate(template) {
    const context = getInlineContactContextOrThrow();
    const tokens = await buildFullTemplateTokens(context);
    const escapedTokens = escapeTokenValues(tokens);
    const subject = applyInlineTemplateTokens(template?.subject || "", tokens).trim();
    const bodyHtml = applyInlineTemplateTokens(template?.body || "", escapedTokens).trim();
    const bodyText = applyInlineTemplateTokens(template?.body || "", tokens).trim();
    const bodyPlainText = htmlToPlainText(bodyText);

    await applyEmailTemplateOnPage(subject, bodyPlainText, bodyHtml);
  }

  async function applyInlineNoteTemplate(template, dialog) {
    const context = getInlineContactContextOrThrow();
    const tokens = await buildFullTemplateTokens(context);
    const filledBodyHtml = applyInlineTemplateTokens(template?.body || "", tokens).trim();
    const noteBody = htmlToPlainText(filledBodyHtml) || filledBodyHtml;
    if (!noteBody) throw new Error("Selected note template is empty.");

    const taskRoot = dialog?.closest("[role='dialog']") || dialog;
    if (isTaskComposerRoot(taskRoot)) {
      if (!applyTemplateToTaskComposer(taskRoot, template, filledBodyHtml, noteBody)) {
        throw new Error("Could not find the fields in the HubSpot task composer.");
      }
      return;
    }

    const editor = dialog?.isConnected ? findNoteEditor(dialog) : null;
    if (!editor) throw new Error("Open a HubSpot note composer first.");
    await createNoteOnPage(noteBody, filledBodyHtml, editor);
  }

  async function applyInlineWhatsappTemplate(template) {
    const context = getInlineContactContextOrThrow();
    const tokens = await buildFullTemplateTokens(context);
    const phoneDigits =
      String(context?.contact?.phoneDigits || "").replace(/\D/g, "") ||
      String(normalizePhone(context?.contact?.values?.phone || "", contactTemplateState.countryPrefix) || "").replace(/\D/g, "");
    if (!phoneDigits) throw new Error("No phone number found on this contact.");

    const filledMessage = applyInlineTemplateTokens(template?.body || "", tokens).trim();
    let url = `https://web.whatsapp.com/send/?phone=${phoneDigits}&type=phone_number`;
    if (filledMessage) {
      url += `&text=${encodeURIComponent(filledMessage)}`;
    }
    await openOrReuseWhatsappTab(url);
  }

  function getTaskComposerMarkerScore(root) {
    if (!(root instanceof Element) || !isVisible(root)) return false;
    const text = elementText(root).toLowerCase();
    if (!text) return 0;

    let score = 0;
    if (text.includes("enter your task")) score += 30;
    if (text.includes("task title")) score += 26;
    if (text.includes("activity date")) score += 10;
    if (text.includes("send reminder")) score += 10;
    if (text.includes("set to repeat")) score += 8;
    if (text.includes("task type")) score += 8;
    if (text.includes("activity assigned to")) score += 8;
    if (text.includes("associated with")) score += 6;
    if (text.includes("task due date")) score += 10;
    if (text.includes("queue")) score += 4;
    if (text.includes("mark task as complete")) score += 4;
    if (root.querySelector("textarea, input, [contenteditable='true'], [role='textbox']")) score += 4;
    return score;
  }

  function isTaskComposerDialog(dialog) {
    if (!(dialog instanceof Element) || !isVisible(dialog) || dialog.getAttribute("role") !== "dialog") return false;
    return getTaskComposerMarkerScore(dialog) >= 28;
  }

  function isTaskComposerRoot(root) {
    if (!(root instanceof Element) || !isVisible(root)) return false;
    if (root.getAttribute("role") === "dialog") return isTaskComposerDialog(root);
    return getTaskComposerMarkerScore(root) >= 36;
  }

  function scoreTaskTitleFieldCandidate(element) {
    if (!(element instanceof Element) || !isVisible(element)) return -Infinity;
    if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return -Infinity;
    if (element.getAttribute("readonly") === "true") return -Infinity;

    const hint = getElementHint(element);
    const placeholder = cleanText(element.getAttribute?.("placeholder") || "").toLowerCase();
    const text = `${hint} ${placeholder}`.trim();
    let score = 0;

    if (text.includes("enter your task")) score += 40;
    if (text.includes("task title")) score += 34;
    if (text === "task") score += 12;
    if (text.includes("notes")) score -= 28;
    if (text.includes("reminder")) score -= 20;
    if (text.includes("queue")) score -= 18;
    if (text.includes("assigned")) score -= 18;
    if (text.includes("date")) score -= 20;

    const tag = String(element.tagName || "").toLowerCase();
    if (tag === "textarea") score += 8;
    if (tag === "input") score += 6;
    if (element.getAttribute("contenteditable") === "true") score += 10;

    const rect = element.getBoundingClientRect();
    if (rect.width >= 220) score += 4;
    if (rect.height >= 32 && rect.height <= 96) score += 4;

    return score;
  }

  function findTaskTitleField(root) {
    if (!(root instanceof Element)) return null;
    const candidates = Array.from(root.querySelectorAll("textarea, input, [contenteditable='true'], [role='textbox']"));
    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const score = scoreTaskTitleFieldCandidate(candidate);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return bestScore >= 16 ? best : null;
  }

  function scoreTaskBodyFieldCandidate(element, titleField) {
    if (!(element instanceof Element) || !isVisible(element)) return -Infinity;
    if (element === titleField) return -Infinity;
    if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return -Infinity;

    const hint = getElementHint(element);
    const placeholder = cleanText(element.getAttribute?.("placeholder") || "").toLowerCase();
    const text = `${hint} ${placeholder}`.trim();
    let score = 0;

    if (text.includes("task description")) score += 40;
    if (text.includes("description")) score += 20;
    if (text.includes("notes") || text.includes("note")) score += 16;
    if (text.includes("body")) score += 10;
    // The subject field and the date/time inputs are never the body.
    if (text.includes("enter your task")) score -= 40;
    if (text.includes("task title")) score -= 34;
    if (text.includes("reminder") || text.includes("date") || text.includes("queue")) score -= 24;

    if (element.getAttribute("contenteditable") === "true") score += 14;
    if (element.closest("[data-selenium-test='rich-text-editor'], .ProseMirror")) score += 12;
    if (String(element.tagName || "").toLowerCase() === "input") score -= 12;

    const rect = element.getBoundingClientRect();
    if (rect.height >= 60) score += 6;

    return score;
  }

  function findTaskBodyField(root, titleField) {
    if (!(root instanceof Element)) return null;
    const candidates = Array.from(root.querySelectorAll("textarea, input, [contenteditable='true'], [role='textbox']"));
    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const score = scoreTaskBodyFieldCandidate(candidate, titleField);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return bestScore >= 16 ? best : null;
  }

  // A note template applied while the task composer is open splits across the
  // two fields: template name into the subject, body into the description.
  // Notes have no title, so the note composer keeps taking body only.
  function applyTemplateToTaskComposer(composerRoot, template, filledBodyHtml, plainBody) {
    const titleField = findTaskTitleField(composerRoot);
    const bodyField = findTaskBodyField(composerRoot, titleField);
    if (!titleField && !bodyField) return false;

    const title = cleanText(template?.name || "");
    if (titleField && title) setInputValue(titleField, title);

    if (bodyField && (plainBody || filledBodyHtml)) {
      clearEditorContent(bodyField);
      setEditorContent(bodyField, plainBody, filledBodyHtml);
    }

    return true;
  }

  function findSignatureInEmailComposer() {
    const dialog = findOpenEmailDialog();
    if (!dialog) return null;
    const bodyEditors = getBodyEditorCandidates(dialog);
    for (const bodyEditor of bodyEditors) {
      const target = resolveEditorTarget(bodyEditor);
      if (!target) continue;
      const root = target.closest(".ProseMirror") || target;
      const sig = root?.querySelector(".hs-signature");
      if (sig instanceof Element) return { sig, root };
    }
    return null;
  }

  const SIGNATURE_TOGGLE_ID = "cp-signature-toggle";
  const SIGNATURE_TOGGLE_STYLE_ID = "cp-signature-toggle-styles";

  // Remove only. Putting the signature back means appending a node HubSpot's
  // ProseMirror has no record of, so the editor drops it on the next
  // transaction; undo already covers the mistake case.
  function ensureSignatureToggleStyles() {
    if (document.getElementById(SIGNATURE_TOGGLE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SIGNATURE_TOGGLE_STYLE_ID;
    style.textContent = `
      .cp-sig-toggle {
        display: inline-flex;
        align-items: center;
        height: 24px;
        margin: 0 0 0 4px;
        padding: 0 10px;
        border: 1px solid #b9c8d9;
        border-radius: 999px;
        background: #ffffff;
        color: #33475b;
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        white-space: nowrap;
        cursor: pointer;
        transition: background-color 100ms ease, border-color 100ms ease;
      }

      .cp-sig-toggle:hover {
        background: #f2f6fa;
        border-color: #7c93ac;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function findAttachFileControl(dialog) {
    const controls = Array.from(dialog.querySelectorAll("button, [role='button']"));
    for (const control of controls) {
      if (!isVisible(control)) continue;
      const hint = `${control.getAttribute("aria-label") || ""} ${control.getAttribute("data-test-id") || ""} ${
        control.getAttribute("title") || ""
      }`.toLowerCase();
      if (hint.includes("attach") || hint.includes("select-file-dropdown")) return control;
    }
    return null;
  }

  function removeEmailSignature() {
    const found = findSignatureInEmailComposer();
    if (!found) return;
    found.sig.remove();
    dispatchInputLikeEvents(found.root);
  }

  function syncSignatureToggleIfNeeded() {
    const dialog = findOpenEmailDialog();
    const existing = document.getElementById(SIGNATURE_TOGGLE_ID);

    // No composer, or nothing left to remove: the pill has no job.
    if (!dialog || !findSignatureInEmailComposer()) {
      existing?.remove();
      return;
    }

    let btn = existing;
    if (!btn || !dialog.contains(btn)) {
      const anchor = findAttachFileControl(dialog);
      if (!anchor) {
        existing?.remove();
        return;
      }
      ensureSignatureToggleStyles();
      existing?.remove();

      btn = document.createElement("button");
      btn.type = "button";
      btn.id = SIGNATURE_TOGGLE_ID;
      btn.className = "cp-sig-toggle";
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeEmailSignature();
        syncSignatureToggleIfNeeded();
      });

      // Climb out of any single-child wrappers so the pill lands beside the
      // attach control as a toolbar item, not inside its button box.
      let anchorItem = anchor;
      while (anchorItem.parentElement && anchorItem.parentElement.children.length === 1 && anchorItem.parentElement !== dialog) {
        anchorItem = anchorItem.parentElement;
      }
      anchorItem.parentElement?.insertBefore(btn, anchorItem.nextSibling);
    }

    if (btn.textContent !== "Remove signature") btn.textContent = "Remove signature";
    btn.title = "Remove signature";
    btn.setAttribute("aria-label", "Remove signature");
  }

  applyHubSpotThemeFromSettingsStorage();
  subscribeHubSpotThemeChanges();
  loadSidebarDeclutterLocalState();
  startContactIndexEnhancerWatcher();
  const signatureWatcher = window.setInterval(syncSignatureToggleIfNeeded, 900);
  window.addEventListener("pagehide", () => window.clearInterval(signatureWatcher));

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === MESSAGE_TYPES.GET_CONTACTS) {
      const countryPrefix = String(message.countryPrefix || DEFAULT_COUNTRY_CODE);
      const messageText = String(message.messageText || "");
      const loadAll = !!message.loadAll;

      const run = loadAll ? extractTableContactsWithAutoScroll(countryPrefix, messageText) : Promise.resolve(extractTableContacts(countryPrefix, messageText));
      run
        .then((payload) => sendResponse({ ok: true, ...payload }))
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.GET_ACTIVE_TAB_CONTEXT) {
      const countryPrefix = String(message.countryPrefix || DEFAULT_COUNTRY_CODE);
      const messageText = String(message.messageText || "");
      try {
        const payload = getActiveTabContext(countryPrefix, messageText);
        sendResponse({ ok: true, ...payload });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
      return;
    }

    // From the website's Fields page (relayed by background): the account's
    // property list, read fresh through this tab's HubSpot session.
    if (message.type === MESSAGE_TYPES.GET_HUBSPOT_PROPERTIES) {
      const portalId = getHubSpotPortalId();
      if (!portalId) {
        sendResponse({ ok: false, code: "no_portal" });
        return;
      }
      fetchHubSpotPropertyDefinitions({ force: true })
        .then((defs) =>
          defs ? sendResponse({ ok: true, portalId, defs }) : sendResponse({ ok: false, code: "not_signed_in", portalId })
        )
        .catch((error) => sendResponse({ ok: false, code: "fetch_failed", portalId, error: String(error?.message || error) }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.GET_PORTAL_ID) {
      sendResponse({ ok: true, portalId: getPortalIdFromPath() });
      return;
    }

    if (message.type === MESSAGE_TYPES.CREATE_NOTE_ON_PAGE) {
      const noteBody = String(message.noteBody || "");
      const noteHtml = String(message.noteHtml || "");
      createNoteOnPage(noteBody, noteHtml)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.GET_NOTES_ON_PAGE) {
      const limit = Number(message.limit || 25);
      getNotesOnPage(limit)
        .then((notes) => sendResponse({ ok: true, notes }))
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.APPLY_EMAIL_TEMPLATE_ON_PAGE) {
      const subject = String(message.subject || "");
      const body = String(message.body || "");
      const bodyHtml = String(message.bodyHtml || "");
      applyEmailTemplateOnPage(subject, body, bodyHtml)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.OPEN_EMAIL_AND_APPLY_TEMPLATE_ON_PAGE) {
      const subject = String(message.subject || "");
      const body = String(message.body || "");
      const bodyHtml = String(message.bodyHtml || "");
      openEmailAndApplyTemplateOnPage(subject, body, bodyHtml)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }
  });
})();
