(() => {
  // "@" field picker and label chips for the personal template editors.
  //
  // A saved template keeps `[internal_name]`, which content.js replaces at
  // send time. Inside an editor a known key reads as a chip with the field's
  // label, and typing "@" offers every field. The conversions run only at the
  // editor's edge, so nothing saved, imported or exported ever holds a chip.
  //
  // Ported from the website (src/lib/tokens, token-text-field.tsx,
  // tinymce-editor.tsx) with one deliberate difference: chip text in the plain
  // fields starts with a word joiner (U+2060). Text someone typed, such as
  // `[Email]` or `[First name]`, can then never be read back as the chip for
  // `[email]` or `[name]`, so every saved template round-trips unchanged.
  const App = window.PopupApp;
  const state = App.state;

  // content.js caches HubSpot's property list here, one entry per portal
  // (HUBSPOT_PROPERTY_DEFS_PREFIX): { fetchedAt, defs: [{ name, label, hidden, ... }] }.
  const PROPERTY_DEFS_PREFIX = "hubspotPropertyDefs::";
  // Enough to browse, short enough to scan; typing narrows it.
  const MAX_MENU_MATCHES = 50;
  const MENU_WIDTH_PX = 260;
  const MENU_MAX_HEIGHT_PX = 256;
  const MENU_EDGE_PX = 8;

  const WORD_JOINER = "\u2060";
  const NBSP = "\u00a0";
  const ZERO_WIDTH_SPACE = "\u200b";
  const KEY_RE = /^[A-Za-z0-9_]+$/;
  // `[key]`, the format content.js replaces.
  const STORED_TOKEN_RE = /\[([A-Za-z0-9_]+)\]/g;
  // Anything printable in brackets: what a plain field shows while editing.
  const SHOWN_TOKEN_RE = /\[([^[\]\n]+)\]/g;
  // A chip as TinyMCE serialises it. Non-greedy to the first `</span>`, which
  // is safe because a chip holds a bare escaped label and no nested tags.
  const CHIP_SPAN_RE = /<span\b[^>]*\sdata-token="([A-Za-z0-9_]+)"[^>]*>[\s\S]*?<\/span>/g;
  const TOKEN_CHIP_CLASS = "cp-token";

  // Keys content.js fills itself. `[name]` is the FIRST name, a historical
  // quirk the extension keeps, hence the label. Labels match the website's.
  const BUILT_IN_TEMPLATE_VARIABLES = Object.freeze([
    { key: "name", label: "First name" },
    { key: "fullname", label: "Full name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "owner", label: "Owner" },
    { key: "gender", label: "Gender" }
  ]);

  // content.js's BUILT_IN_TOKEN_KEYS: never filled from HubSpot, so a HubSpot
  // property with one of these keys would only be another name for a built-in.
  const RESERVED_TOKEN_KEYS = new Set([
    "name",
    "gender",
    "first_name",
    "firstname",
    "full_name",
    "fullname",
    "owner",
    "email",
    "phone",
    "record_id",
    "recordid"
  ]);

  // Chip look inside the TinyMCE iframe, which can't see popup.html's styles.
  const TINYMCE_CONTENT_STYLE = `
.${TOKEN_CHIP_CLASS} { display: inline-block; background: #e0ecff; color: #1d4ed8; border-radius: 999px;
  padding: 0 8px; font-weight: 500; line-height: 1.5; white-space: nowrap; cursor: default; }
.${TOKEN_CHIP_CLASS}[data-mce-selected] { outline: 2px solid #93c5fd; outline-offset: 1px; }
`;

  // ---------------------------------------------------------------------------
  // Conversions (no DOM)
  // ---------------------------------------------------------------------------

  // Accent-insensitive folding so "o" finds "ö", "s" finds "ş" and "i" finds
  // "ı"/"İ". NFD splits an accented letter into base + mark and \p{M} drops the
  // mark; the dotless ı is its own letter NFD won't split, so it is mapped by hand.
  function foldSearch(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/ı/g, "i");
  }

  function normLabel(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  // Same key content.js gives a HubSpot property (inlineTokenKey).
  function tokenKeyFromPropertyName(name) {
    return String(name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  // For a token with no usable label: underscores to spaces, first letter up.
  function prettyTokenName(key) {
    const words = String(key ?? "")
      .replace(/_/g, " ")
      .trim();
    return words ? words[0].toUpperCase() + words.slice(1) : String(key ?? "");
  }

  // Built-ins first, then every visible HubSpot property by label.
  function buildTemplateVariables(defs) {
    const out = BUILT_IN_TEMPLATE_VARIABLES.map((variable) => ({ ...variable, hint: `[${variable.key}]` }));
    const keys = new Set(out.map((variable) => variable.key));
    const fields = [];
    for (const def of Array.isArray(defs) ? defs : []) {
      if (!def || def.hidden === true) continue;
      const key = tokenKeyFromPropertyName(def.name);
      if (!key || keys.has(key) || RESERVED_TOKEN_KEYS.has(key)) continue;
      keys.add(key);
      const label =
        String(def.label ?? "")
          .replace(/[[\]{}\r\n]/g, " ")
          .replace(/\s+/g, " ")
          .trim() || key;
      fields.push({ key, label });
    }
    fields.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key));

    // Two variables sharing a label would both lose it (the chip mapping must
    // be one-to-one), so the later one carries its key.
    const labels = new Set(out.map((variable) => normLabel(variable.label)));
    for (const field of fields) {
      let label = field.label;
      if (labels.has(normLabel(label))) label = `${label} (${field.key})`;
      labels.add(normLabel(label));
      out.push({ key: field.key, label, hint: `[${field.key}]` });
    }
    return out;
  }

  // The bracket contents a plain field shows for a labelled chip. Spaces turn
  // into no-break spaces so a chip never wraps across lines (the label is
  // painted over this text and only works on ONE line).
  function chipInner(label) {
    return WORD_JOINER + String(label).replace(/\s/g, NBSP);
  }

  // key -> label, and the shown chip text -> key. A label only counts when it
  // is unique and bracket-free; otherwise that key keeps its `[key]` spelling.
  function buildTokenLabelMap(variableList) {
    const byKey = new Map();
    for (const variable of Array.isArray(variableList) ? variableList : []) {
      const key = String(variable?.key ?? "");
      if (KEY_RE.test(key) && !byKey.has(key)) byKey.set(key, variable);
    }

    // Count first, decide second: deciding as we go would let the first of
    // two same-named fields keep a label its twin also claims.
    const labelCount = new Map();
    for (const variable of byKey.values()) {
      const n = normLabel(variable.label);
      if (n) labelCount.set(n, (labelCount.get(n) || 0) + 1);
    }

    const display = new Map();
    const shownKey = new Map();
    for (const [key, variable] of byKey) {
      const label = String(variable.label ?? "").trim();
      const n = normLabel(label);
      if (!n || /[[\]{}\r\n]/.test(label) || labelCount.get(n) !== 1) continue;
      display.set(key, label);
      shownKey.set(chipInner(label), key);
    }
    return { byKey, display, shownKey };
  }

  // The chip's text for a key: its label, or the key made readable.
  function tokenChipLabel(key, map) {
    return map.display.get(key) || prettyTokenName(key);
  }

  // Stored -> what a plain field shows. Unknown keys stay exactly as written,
  // so a typo stays visible.
  function storedToDisplay(stored, map) {
    return String(stored ?? "").replace(STORED_TOKEN_RE, (whole, key) => {
      const label = map.display.get(key);
      return label ? `[${chipInner(label)}]` : whole;
    });
  }

  // What a plain field shows -> stored. Only exact chip text (it carries the
  // word joiner) is rewritten; everything else, a bare `[email]` included, is
  // kept byte for byte. The caret can't rest inside a chip (see
  // normalizeSelection), so chip text is not edited by hand in practice.
  function displayToStored(shown, map) {
    return String(shown ?? "").replace(SHOWN_TOKEN_RE, (whole, inner) => {
      if (!inner.includes(WORD_JOINER)) return whole;
      const key = map.shownKey.get(inner);
      return key ? `[${key}]` : whole;
    });
  }

  // The key behind bracket contents in a plain field, or "" for plain text.
  function resolveShownToken(inner, map) {
    if (inner.includes(WORD_JOINER)) return map.shownKey.get(inner) || "";
    return KEY_RE.test(inner) && map.byKey.has(inner) ? inner : "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tokenChipHtml(key, map) {
    return `<span class="${TOKEN_CHIP_CLASS} mceNonEditable" data-token="${key}" contenteditable="false">${escapeHtml(
      tokenChipLabel(key, map)
    )}</span>`;
  }

  // Stored HTML -> editable. Only TEXT is rewritten: a `[…]` inside a tag is
  // part of an attribute (a link, a style) and a chip there would corrupt the
  // markup. Unknown keys stay literal text.
  function tokensToHtml(html, map) {
    if (!html) return html;
    return String(html)
      .split(/(<[^>]*>)/g)
      .map((segment) =>
        segment.startsWith("<")
          ? segment
          : segment.replace(STORED_TOKEN_RE, (whole, key) => (map.byKey.has(key) ? tokenChipHtml(key, map) : whole))
      )
      .join("");
  }

  // Editable HTML -> stored.
  function htmlToTokens(html) {
    if (!html) return html;
    return String(html).replace(CHIP_SPAN_RE, (_match, key) => `[${key}]`);
  }

  // A rich editor node's text with each chip as `[key]` (textContent would
  // give the label, and writing that back loses the field).
  function textWithTokens(node) {
    if (!node) return "";
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1 && node.nodeType !== 11) return "";
    const key = node.nodeType === 1 ? node.getAttribute("data-token") : "";
    if (key && KEY_RE.test(key)) return `[${key}]`;
    let text = "";
    for (const child of node.childNodes) text += textWithTokens(child);
    return text;
  }

  // Plain text -> rich editor HTML, known `[key]`s as chips.
  function textToChipHtml(text) {
    return tokensToHtml(escapeHtml(text), currentMap);
  }

  const searchFoldCache = new WeakMap();

  function searchFolds(variable) {
    let folds = searchFoldCache.get(variable);
    if (!folds) {
      const key = foldSearch(variable.key);
      folds = {
        label: foldSearch(variable.label),
        key,
        keySpaced: key.replace(/_/g, " "),
        keyFlat: key.replace(/_/g, "")
      };
      searchFoldCache.set(variable, folds);
    }
    return folds;
  }

  // Matched against the label, the raw key, and the key without underscores,
  // so the words you read are typeable as you read them. Label starts first,
  // then word starts, then key starts, then anything containing the text.
  function matchTokenVariables(variableList, fragment, limit = MAX_MENU_MATCHES) {
    const list = Array.isArray(variableList) ? variableList : [];
    const f = foldSearch(String(fragment ?? "").trim());
    if (!f) return list.slice(0, limit);
    const ranked = [];
    list.forEach((variable, index) => {
      const folds = searchFolds(variable);
      let rank = -1;
      if (folds.label.startsWith(f)) rank = 0;
      else if (` ${folds.label}`.includes(` ${f}`)) rank = 1;
      else if (folds.key.startsWith(f) || folds.keySpaced.startsWith(f)) rank = 2;
      else if (folds.label.includes(f) || folds.key.includes(f) || folds.keySpaced.includes(f) || folds.keyFlat.includes(f)) {
        rank = 3;
      }
      if (rank >= 0) ranked.push({ variable, rank, index });
    });
    ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
    return ranked.slice(0, limit).map((entry) => entry.variable);
  }

  // Everything after an "@" at a word boundary, up to the caret, or null when
  // it isn't a pick. A newline or bracket closes it, and a mid-word "@" is an
  // email address. Labels are words, so a space may stay inside the fragment,
  // but "@ " with only blanks after it closes, or "call me @ 5" would open it.
  function atFragment(before) {
    const text = String(before ?? "");
    const at = text.lastIndexOf("@");
    if (at < 0) return null;
    const fragment = text.slice(at + 1);
    if (/[\n{}[\]]/.test(fragment)) return null;
    if (fragment.length > 0 && !fragment.trim()) return null;
    if (at > 0 && /\S/.test(text[at - 1])) return null;
    return { start: at, fragment };
  }

  // ---------------------------------------------------------------------------
  // The field list: built-ins plus the cached HubSpot properties
  // ---------------------------------------------------------------------------

  let variables = buildTemplateVariables([]);
  let currentMap = buildTokenLabelMap(variables);
  let variablesSignature = variablesSignatureOf(variables);
  let loadedPortalId = "";
  let cachedPortalIds = new Set();
  let refreshSeq = 0;

  function variablesSignatureOf(list) {
    return list.map((variable) => `${variable.key}\u0000${variable.label}`).join("\u0001");
  }

  async function readPropertyDefCaches() {
    const area = globalThis.chrome?.storage?.local;
    if (!area || typeof area.get !== "function") return [];
    let stored = {};
    if (typeof area.getKeys === "function") {
      const keys = (await area.getKeys()).filter((key) => String(key).startsWith(PROPERTY_DEFS_PREFIX));
      stored = keys.length ? await area.get(keys) : {};
    } else {
      stored = await area.get(null);
    }
    const entries = [];
    for (const [key, value] of Object.entries(stored || {})) {
      if (!key.startsWith(PROPERTY_DEFS_PREFIX) || !value || !Array.isArray(value.defs)) continue;
      entries.push({
        portalId: key.slice(PROPERTY_DEFS_PREFIX.length),
        fetchedAt: Number(value.fetchedAt) || 0,
        defs: value.defs
      });
    }
    return entries;
  }

  // The account the popup is working in when it has a cached list, otherwise
  // the list content.js refreshed last.
  function pickPropertyDefCache(entries, preferredPortalId) {
    const preferred = String(preferredPortalId || "");
    if (preferred) {
      const match = entries.find((entry) => entry.portalId === preferred);
      if (match) return match;
    }
    return entries.reduce((best, entry) => (!best || entry.fetchedAt > best.fetchedAt ? entry : best), null);
  }

  async function refreshVariables() {
    const seq = ++refreshSeq;
    let entries;
    try {
      entries = await readPropertyDefCaches();
    } catch (_error) {
      // Keep whatever list we have; built-ins always work.
      return variables;
    }
    if (seq !== refreshSeq) return variables;
    cachedPortalIds = new Set(entries.map((entry) => entry.portalId));
    const pick = pickPropertyDefCache(entries, state?.currentPortalId);
    loadedPortalId = pick?.portalId || "";
    const next = buildTemplateVariables(pick?.defs || []);
    const signature = variablesSignatureOf(next);
    if (signature === variablesSignature) return variables;
    variables = next;
    variablesSignature = signature;
    currentMap = buildTokenLabelMap(next);
    applyVariablesToEditors();
    return variables;
  }

  function refreshIfPortalChanged() {
    const portalId = String(state?.currentPortalId || "");
    if (portalId && portalId !== loadedPortalId && cachedPortalIds.has(portalId)) void refreshVariables();
  }

  // New labels: plain fields re-render at once (keeping the caret), rich
  // editors when they next lose focus, because setContent moves the caret.
  function applyVariablesToEditors() {
    for (const field of textFields.values()) reseedField(field);
    for (const editor of tinyEditors) {
      if (!editor?.initialized || editor.removed) continue;
      if (typeof editor.hasFocus === "function" && editor.hasFocus()) pendingTinyRerender.add(editor);
      else rerenderTinyEditor(editor);
    }
    if (menuOwner) updateMenu(menuOwner);
  }

  // ---------------------------------------------------------------------------
  // Rich editors (TinyMCE: email and note bodies)
  // ---------------------------------------------------------------------------

  const tinyEditors = new Set();
  const pendingTinyRerender = new WeakSet();

  function rerenderTinyEditor(editor) {
    if (!editor?.initialized || editor.removed) return;
    // getContent() already returns `[key]` (see GetContent below), so this
    // re-renders every chip from the stored form with the current labels.
    editor.setContent(editor.getContent());
  }

  // The highlighted row of TinyMCE's own "@" list (it lives in the editor's
  // popup sink in the main document, not in the iframe).
  function activeAutocompleterItem() {
    const items = document.querySelectorAll(".tox-autocompleter .tox-collection__item--active");
    for (const item of items) {
      if (item.getClientRects().length) return item;
    }
    return null;
  }

  // The selection as plain text with chips as `[key]`. Laid out off-screen
  // the way TinyMCE does it, because innerText needs layout to turn
  // paragraphs into line breaks.
  function selectionTextWithTokens(editor) {
    const rng = editor.selection?.getRng?.();
    if (!rng || rng.collapsed) return "";
    const doc = editor.getDoc();
    const bin = doc.createElement("div");
    bin.setAttribute("data-mce-bogus", "all");
    bin.style.cssText = "position: fixed; left: -9999999px; top: 0;";
    bin.appendChild(rng.cloneContents());
    for (const chip of bin.querySelectorAll("[data-token]")) {
      const key = chip.getAttribute("data-token");
      if (KEY_RE.test(key)) chip.replaceWith(doc.createTextNode(`[${key}]`));
    }
    editor.getBody().appendChild(bin);
    const text = bin.innerText;
    bin.remove();
    return text.replace(/[​﻿]/g, "");
  }

  // `[email]` typed by hand becomes a chip the moment its bracket closes.
  function convertTypedTokenAtCaret(editor) {
    const rng = editor.selection?.getRng?.();
    if (!rng || !rng.collapsed) return false;
    const node = rng.startContainer;
    if (!node || node.nodeType !== 3) return false;
    const match = node.data.slice(0, rng.startOffset).match(/\[([A-Za-z0-9_]+)\]$/);
    if (!match || !currentMap.byKey.has(match[1])) return false;
    const range = editor.dom.createRng();
    range.setStart(node, rng.startOffset - match[0].length);
    range.setEnd(node, rng.startOffset);
    editor.selection.setRng(range);
    editor.insertContent(tokenChipHtml(match[1], currentMap));
    return true;
  }

  // Call from TinyMCE's setup(editor). `onChange` runs after a chip goes in,
  // because a mouse pick fires no keyup.
  function setupTinyMceEditor(editor, options = {}) {
    if (!editor) return;
    const onChange = typeof options.onChange === "function" ? options.onChange : null;
    let autocompleterOpen = false;
    tinyEditors.add(editor);

    // Every way content comes IN (setContent, insertContent, paste) turns
    // known `[key]` text into chips...
    editor.on("BeforeSetContent", (event) => {
      if (typeof event.content === "string" && event.format !== "text") {
        event.content = tokensToHtml(event.content, currentMap);
      }
    });
    // ...and every way it goes OUT turns chips back into `[key]`, so
    // getContent() and the saved body hold no chip markup. "raw" is TinyMCE's
    // own undo copy and keeps the chips.
    editor.on("GetContent", (event) => {
      if (typeof event.content === "string" && event.format !== "text" && event.format !== "raw") {
        event.content = htmlToTokens(event.content);
      }
    });

    editor.ui.registry.addAutocompleter("cp-fields", {
      trigger: "@",
      minChars: 0,
      columns: 1,
      maxResults: MAX_MENU_MATCHES,
      fetch: (pattern) =>
        Promise.resolve(
          matchTokenVariables(variables, pattern).map((variable) => ({
            type: "autocompleteitem",
            value: variable.key,
            text: variable.label
          }))
        ),
      onAction: (api, rng, key) => {
        editor.selection.setRng(rng);
        // A trailing space so typing continues as text after the chip
        // instead of fighting the non-editable boundary.
        editor.insertContent(`${tokenChipHtml(key, currentMap)}&nbsp;`);
        api.hide();
        onChange?.();
      }
    });

    editor.on("AutocompleterStart AutocompleterUpdate", () => {
      autocompleterOpen = true;
    });
    editor.on("AutocompleterEnd", () => {
      autocompleterOpen = false;
    });
    // TinyMCE picks with Enter only; Tab picks too, as in the plain fields.
    editor.on("keydown", (event) => {
      if (!autocompleterOpen || event.key !== "Tab") return;
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const item = activeAutocompleterItem();
      if (!item) return;
      event.preventDefault();
      item.click();
    });
    editor.on("input", (event) => {
      if (event?.inputType !== "insertText" || event?.data !== "]") return;
      if (convertTypedTokenAtCaret(editor)) onChange?.();
    });
    // TinyMCE writes the clipboard's plain text from what chips SHOW, so a
    // copy pasted into the WhatsApp editor would arrive as "First name". Copy
    // and cut bubble from the body up to the window after TinyMCE has filled
    // the clipboard; swap the stored form in there. (Its HTML copy already
    // carries `[key]`, through GetContent.)
    editor.on("init", () => {
      const putStoredText = (event) => {
        if (!event.defaultPrevented || !event.clipboardData) return;
        const text = selectionTextWithTokens(editor);
        if (text) event.clipboardData.setData("text/plain", text);
      };
      const win = editor.getWin();
      win.addEventListener("copy", putStoredText);
      win.addEventListener("cut", putStoredText);
    });
    editor.on("focus", refreshIfPortalChanged);
    editor.on("blur", () => {
      if (!pendingTinyRerender.has(editor)) return;
      pendingTinyRerender.delete(editor);
      rerenderTinyEditor(editor);
    });
    editor.on("remove", () => {
      tinyEditors.delete(editor);
    });
  }

  // ---------------------------------------------------------------------------
  // Plain fields (WhatsApp body, email subject)
  //
  // Two layers, exactly aligned: a mirror div paints the chips, the real
  // <textarea> sits on top with transparent text and a visible caret. Both
  // share the `cp-token-field` metrics in popup.html, including a reserved
  // scrollbar gutter, so they wrap at the same points. The field EDITS the
  // display string and the template modules read and write the stored one
  // through getStoredValue / setStoredValue.
  // ---------------------------------------------------------------------------

  const textFields = new Map();
  let documentListenersBound = false;
  let menuEl = null;
  let menuOwner = null;

  function readSelection(el) {
    return {
      start: el.selectionStart ?? 0,
      end: el.selectionEnd ?? 0,
      direction: el.selectionDirection || "none"
    };
  }

  function isEditable(el) {
    return !el.disabled && !el.readOnly;
  }

  // Where each chip sits in the field's text.
  function chipRanges(field) {
    const ranges = [];
    const value = field.el.value;
    if (!value.includes("[")) return ranges;
    for (const match of value.matchAll(SHOWN_TOKEN_RE)) {
      if (resolveShownToken(match[1], field.map)) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
      }
    }
    return ranges;
  }

  function renderMirror(field) {
    const { el, mirror } = field;
    const text = el.value;
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(SHOWN_TOKEN_RE)) {
      const key = resolveShownToken(match[1], field.map);
      // Unknown tokens stay plain: they ship literally, and dressing them up
      // as chips is how a typo hides.
      if (!key) continue;
      if (match.index > last) fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
      // The shown text renders transparent at its own width and the label
      // floats over it, so the pill is exactly as wide as the text the caret
      // walks past.
      const chip = document.createElement("span");
      chip.className = "cp-token-mirror-chip";
      chip.textContent = match[0];
      const label = document.createElement("span");
      label.className = "cp-token-mirror-label";
      label.textContent = tokenChipLabel(key, field.map);
      chip.appendChild(label);
      fragment.appendChild(chip);
      last = match.index + match[0].length;
    }
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
    // Keeps a trailing empty line from collapsing out of the mirror.
    fragment.appendChild(document.createTextNode(ZERO_WIDTH_SPACE));
    mirror.replaceChildren(fragment);
    syncMirrorScroll(field);
  }

  function syncMirrorScroll(field) {
    field.mirror.scrollTop = field.el.scrollTop;
    field.mirror.scrollLeft = field.el.scrollLeft;
  }

  // The subject grows with its content instead of scrolling (a scrollbar
  // would narrow only the textarea and the layers would wrap apart).
  function growField(field) {
    if (!field.singleLine) return;
    const el = field.el;
    if (!el.isConnected || !el.getClientRects().length) return;
    const style = window.getComputedStyle(el);
    const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight + borders}px`;
  }

  // Re-derive the shown text with the current labels. Saved text is
  // unchanged by construction; the caret keeps its place.
  function reseedField(field) {
    const el = field.el;
    const display = el.value;
    const oldMap = field.map;
    const next = storedToDisplay(displayToStored(display, oldMap), currentMap);
    field.map = currentMap;
    if (next !== display) {
      const focused = document.activeElement === el;
      const selection = readSelection(el);
      const mapPos = (pos) => storedToDisplay(displayToStored(display.slice(0, pos), oldMap), currentMap).length;
      el.value = next;
      if (focused) {
        el.setSelectionRange(mapPos(selection.start), mapPos(selection.end), selection.direction);
        field.lastSel = readSelection(el);
      }
    }
    renderMirror(field);
    growField(field);
  }

  // Replace a range through the browser's editing commands so the change
  // lands on the textarea's own undo stack and fires a normal input event.
  function replaceRange(field, start, end, text) {
    const el = field.el;
    if (start === end && !text) return;
    if (document.activeElement !== el) el.focus();
    el.setSelectionRange(start, end);
    let applied = false;
    try {
      applied = text ? document.execCommand("insertText", false, text) : document.execCommand("delete", false);
    } catch (_error) {
      applied = false;
    }
    if (!applied) {
      el.setRangeText(text, start, end, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    field.lastSel = readSelection(el);
  }

  // A chip is one unit: the caret never rests inside one. Keyboard moves
  // jump to the side they were heading for, clicks to the nearer side, and a
  // selection that cuts a chip grows (or, when shrinking, backs off) to its
  // edge.
  function normalizeSelection(field, mode) {
    const el = field.el;
    const selection = readSelection(el);
    const ranges = chipRanges(field);
    const prev = field.lastSel || selection;
    let { start, end } = selection;
    if (ranges.length) {
      const inside = (pos) => ranges.find((range) => pos > range.start && pos < range.end);
      const keyboard = mode === "keyboard";
      if (start === end) {
        const range = inside(start);
        if (range) {
          const prevCollapsed = prev.start === prev.end;
          if (keyboard && prevCollapsed && prev.start <= range.start) start = range.end;
          else if (keyboard && prevCollapsed && prev.start >= range.end) start = range.start;
          else start = start - range.start <= range.end - start ? range.start : range.end;
          end = start;
        }
      } else {
        const startRange = inside(start);
        if (startRange) start = keyboard && start > prev.start ? startRange.end : startRange.start;
        const endRange = inside(end);
        if (endRange) end = keyboard && end < prev.end ? endRange.start : endRange.end;
        if (end < start) end = start;
      }
      if (start !== selection.start || end !== selection.end) {
        el.setSelectionRange(start, end, selection.direction);
      }
    }
    field.lastSel = { start, end };
  }

  // Left/Right next to a chip step over all of it (Shift extends over it).
  function stepOverChip(field, forward, extend) {
    const el = field.el;
    const selection = readSelection(el);
    const collapsed = selection.start === selection.end;
    if (!extend && !collapsed) return false;
    const backward = !collapsed && selection.direction === "backward";
    const anchor = backward ? selection.end : selection.start;
    const focus = collapsed ? selection.start : backward ? selection.start : selection.end;
    const range = chipRanges(field).find((candidate) => (forward ? candidate.start === focus : candidate.end === focus));
    if (!range) return false;
    const nextFocus = forward ? range.end : range.start;
    if (extend) {
      el.setSelectionRange(Math.min(anchor, nextFocus), Math.max(anchor, nextFocus), nextFocus < anchor ? "backward" : "forward");
    } else {
      el.setSelectionRange(nextFocus, nextFocus);
    }
    field.lastSel = readSelection(el);
    return true;
  }

  // Backspace flush against a chip removes the whole chip, never one bracket.
  // Only for a collapsed caret, so a selection deletes as usual.
  function deleteChipAtCaret(field, backward) {
    const { start, end } = readSelection(field.el);
    if (start !== end) return false;
    const range = chipRanges(field).find(
      (candidate) => (backward ? candidate.end === start : candidate.start === start) || (start > candidate.start && start < candidate.end)
    );
    if (!range) return false;
    closeMenu(field);
    replaceRange(field, range.start, range.end, "");
    return true;
  }

  // --- "@" menu -------------------------------------------------------------

  function ensureMenuEl() {
    if (menuEl) return menuEl;
    menuEl = document.createElement("div");
    menuEl.id = "cpTokenMenu";
    menuEl.className = "cp-token-menu";
    menuEl.setAttribute("role", "listbox");
    menuEl.setAttribute("aria-label", "Fields");
    menuEl.hidden = true;
    // mousedown, not click: the field would blur and close the menu first.
    menuEl.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const item = event.target instanceof Element ? event.target.closest("[data-index]") : null;
      if (item && menuOwner) acceptMatch(menuOwner, Number(item.dataset.index));
    });
    menuEl.addEventListener("mousemove", (event) => {
      const item = event.target instanceof Element ? event.target.closest("[data-index]") : null;
      if (!item || !menuOwner?.menu) return;
      const index = Number(item.dataset.index);
      if (index !== menuOwner.menu.active) setActiveMatch(menuOwner, index, false);
    });
    document.body.appendChild(menuEl);
    return menuEl;
  }

  function isMenuOpenFor(field) {
    return !!field.menu && menuOwner === field && !!menuEl && !menuEl.hidden;
  }

  function closeMenu(field) {
    if (field) {
      field.menu = null;
      field.el.setAttribute("aria-expanded", "false");
      field.el.removeAttribute("aria-activedescendant");
    }
    if (menuEl && (!field || menuOwner === field)) {
      menuEl.hidden = true;
      menuEl.replaceChildren();
      menuOwner = null;
    }
  }

  function updateMenu(field) {
    const el = field.el;
    if (!isEditable(el) || document.activeElement !== el || field.composing) return closeMenu(field);
    const { start, end } = readSelection(el);
    if (start !== end) return closeMenu(field);
    const hit = atFragment(el.value.slice(0, start));
    if (!hit) {
      field.dismissedAt = -1;
      return closeMenu(field);
    }
    // Escape keeps this "@" closed until a new one is typed.
    if (hit.start === field.dismissedAt) return closeMenu(field);
    const matches = matchTokenVariables(variables, hit.fragment);
    if (!matches.length) return closeMenu(field);
    const previous = field.menu;
    const sameQuery = !!previous && previous.start === hit.start && previous.fragment === hit.fragment;
    field.menu = {
      start: hit.start,
      fragment: hit.fragment,
      matches,
      active: sameQuery ? Math.min(previous.active, matches.length - 1) : 0
    };
    renderMenu(field);
  }

  function renderMenu(field) {
    const menu = ensureMenuEl();
    if (menuOwner && menuOwner !== field) closeMenu(menuOwner);
    menuOwner = field;
    const { matches, active } = field.menu;
    menu.replaceChildren(
      ...matches.map((variable, index) => {
        const item = document.createElement("div");
        item.id = `cpTokenMenuItem${index}`;
        item.className = index === active ? "cp-token-menu-item active" : "cp-token-menu-item";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", index === active ? "true" : "false");
        item.dataset.index = String(index);
        const label = document.createElement("span");
        label.className = "cp-token-menu-label";
        label.textContent = variable.label;
        const hint = document.createElement("span");
        hint.className = "cp-token-menu-hint";
        hint.textContent = variable.hint || `[${variable.key}]`;
        item.append(label, hint);
        return item;
      })
    );
    menu.hidden = false;
    field.el.setAttribute("aria-expanded", "true");
    field.el.setAttribute("aria-controls", menu.id);
    field.el.setAttribute("aria-activedescendant", `cpTokenMenuItem${active}`);
    positionMenu(field);
    scrollMenuTo(menu.children[active]);
  }

  // Scrolls the list only; scrollIntoView could also move the page.
  function scrollMenuTo(item) {
    if (!item || !menuEl) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < menuEl.scrollTop) menuEl.scrollTop = top;
    else if (bottom > menuEl.scrollTop + menuEl.clientHeight) menuEl.scrollTop = bottom - menuEl.clientHeight;
  }

  function setActiveMatch(field, index, scroll = true) {
    if (!isMenuOpenFor(field)) return;
    const previous = menuEl.children[field.menu.active];
    if (previous) {
      previous.classList.remove("active");
      previous.setAttribute("aria-selected", "false");
    }
    field.menu.active = index;
    const next = menuEl.children[index];
    if (next) {
      next.classList.add("active");
      next.setAttribute("aria-selected", "true");
      if (scroll) scrollMenuTo(next);
    }
    field.el.setAttribute("aria-activedescendant", `cpTokenMenuItem${index}`);
  }

  function acceptMatch(field, index) {
    const menu = field.menu;
    const variable = menu?.matches?.[index];
    if (!variable) return;
    const caret = Math.max(field.el.selectionEnd ?? 0, menu.start + 1);
    const text = storedToDisplay(`[${variable.key}]`, field.map);
    closeMenu(field);
    replaceRange(field, menu.start, caret, text);
  }

  // Where the caret is ON SCREEN, via a throwaway copy of the field's text
  // (a textarea exposes no coordinates for it). The copy takes every
  // property that affects wrapping, or the menu lands on the wrong line.
  function caretViewportRect(el) {
    const style = window.getComputedStyle(el);
    const probe = document.createElement("div");
    for (const prop of [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "fontVariant",
      "fontStretch",
      "lineHeight",
      "letterSpacing",
      "wordSpacing",
      "textTransform",
      "textIndent",
      "tabSize",
      "wordBreak",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft"
    ]) {
      probe.style[prop] = style[prop];
    }
    const paddingX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    probe.style.position = "fixed";
    probe.style.left = "0";
    probe.style.top = "0";
    probe.style.visibility = "hidden";
    probe.style.boxSizing = "content-box";
    probe.style.border = "0";
    probe.style.whiteSpace = "pre-wrap";
    probe.style.overflowWrap = "break-word";
    probe.style.width = `${Math.max(0, el.clientWidth - paddingX)}px`;
    probe.textContent = el.value.slice(0, el.selectionEnd ?? 0);
    const marker = document.createElement("span");
    // Zero-width space: it has a position but no width of its own.
    marker.textContent = ZERO_WIDTH_SPACE;
    probe.appendChild(marker);
    document.body.appendChild(probe);
    const box = el.getBoundingClientRect();
    const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 14) * 1.4;
    const left = box.left + (parseFloat(style.borderLeftWidth) || 0) + marker.offsetLeft - el.scrollLeft;
    const top = box.top + (parseFloat(style.borderTopWidth) || 0) + marker.offsetTop - el.scrollTop;
    probe.remove();
    return { left, top, bottom: top + lineHeight };
  }

  // Below the caret line when it fits, above when that fits better, always
  // inside the popup window.
  function positionMenu(field) {
    if (!isMenuOpenFor(field)) return;
    const caret = caretViewportRect(field.el);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(MENU_WIDTH_PX, viewportWidth - MENU_EDGE_PX * 2);
    menuEl.style.width = `${width}px`;
    let maxHeight = Math.min(MENU_MAX_HEIGHT_PX, viewportHeight - MENU_EDGE_PX * 2);
    menuEl.style.maxHeight = `${maxHeight}px`;
    const height = menuEl.offsetHeight;
    const roomBelow = viewportHeight - MENU_EDGE_PX - caret.bottom;
    const roomAbove = caret.top - MENU_EDGE_PX;
    let top;
    if (height <= roomBelow) {
      top = caret.bottom;
    } else if (height <= roomAbove) {
      top = caret.top - height;
    } else if (roomBelow >= roomAbove) {
      maxHeight = Math.max(roomBelow, 0);
      top = caret.bottom;
    } else {
      maxHeight = Math.max(roomAbove, 0);
      top = MENU_EDGE_PX;
    }
    menuEl.style.maxHeight = `${maxHeight}px`;
    const finalHeight = Math.min(height, maxHeight);
    top = Math.min(Math.max(MENU_EDGE_PX, top), Math.max(MENU_EDGE_PX, viewportHeight - MENU_EDGE_PX - finalHeight));
    const left = Math.min(Math.max(MENU_EDGE_PX, caret.left), Math.max(MENU_EDGE_PX, viewportWidth - MENU_EDGE_PX - width));
    menuEl.style.left = `${Math.round(left)}px`;
    menuEl.style.top = `${Math.round(top)}px`;
  }

  // --- Field events ---------------------------------------------------------

  function onInput(field) {
    const el = field.el;
    if (field.singleLine && el.value.includes("\n")) {
      // Same length, so the caret stays where it was.
      const selection = readSelection(el);
      el.value = el.value.replace(/\n/g, " ");
      el.setSelectionRange(selection.start, selection.end, selection.direction);
    }
    renderMirror(field);
    growField(field);
    field.lastSel = readSelection(el);
    updateMenu(field);
  }

  function onBeforeInput(field, event) {
    const el = field.el;
    if (!isEditable(el)) return;
    if (field.singleLine && (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph")) {
      event.preventDefault();
      return;
    }
    // `[email]` typed by hand becomes a chip the moment its bracket closes.
    if (event.inputType !== "insertText" || event.data !== "]" || field.composing) return;
    const { start, end } = readSelection(el);
    if (start !== end) return;
    const match = el.value.slice(0, start).match(/\[([A-Za-z0-9_]+)$/);
    if (!match || !field.map.display.has(match[1])) return;
    event.preventDefault();
    replaceRange(field, start - match[0].length, start, storedToDisplay(`[${match[1]}]`, field.map));
  }

  function onKeyDown(field, event) {
    const el = field.el;
    if (event.isComposing || field.composing || !isEditable(el)) return;
    if (isMenuOpenFor(field)) {
      const count = field.menu.matches.length;
      const plain = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveMatch(field, (field.menu.active + step + count) % count);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && plain) {
        event.preventDefault();
        acceptMatch(field, field.menu.active);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        field.dismissedAt = field.menu.start;
        closeMenu(field);
        return;
      }
    }
    if ((event.key === "Backspace" || event.key === "Delete") && deleteChipAtCaret(field, event.key === "Backspace")) {
      event.preventDefault();
      return;
    }
    if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      stepOverChip(field, event.key === "ArrowRight", event.shiftKey)
    ) {
      event.preventDefault();
      return;
    }
    if (field.singleLine && event.key === "Enter") event.preventDefault();
  }

  function onSelectionChange(field) {
    if (field.pointerDown || field.composing || document.activeElement !== field.el) return;
    normalizeSelection(field, "keyboard");
    if (field.menu) updateMenu(field);
  }

  // Copy and cut put the stored form on the clipboard, so a field pasted
  // anywhere else reads `[name]`, and pasted back here becomes a chip again.
  function onCopy(field, event, cut) {
    const el = field.el;
    const { start, end } = readSelection(el);
    if (start === end || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", displayToStored(el.value.slice(start, end), field.map));
    if (cut && isEditable(el)) replaceRange(field, start, end, "");
  }

  function onPaste(field, event) {
    const el = field.el;
    if (!isEditable(el)) return;
    const raw = event.clipboardData?.getData("text/plain");
    if (typeof raw !== "string" || !raw) return;
    let text = raw.replace(/\r\n?/g, "\n");
    if (field.singleLine) text = text.replace(/\n/g, " ");
    text = storedToDisplay(text, field.map);
    if (text === raw) return;
    event.preventDefault();
    const { start, end } = readSelection(el);
    replaceRange(field, start, end, text);
  }

  function onBlur(field) {
    closeMenu(field);
    field.pointerDown = false;
    field.composing = false;
    reseedField(field);
  }

  function bindDocumentListeners() {
    if (documentListenersBound) return;
    documentListenersBound = true;
    document.addEventListener("selectionchange", () => {
      const field = textFields.get(document.activeElement);
      if (field) onSelectionChange(field);
    });
    document.addEventListener(
      "mouseup",
      () => {
        for (const field of textFields.values()) {
          if (!field.pointerDown) continue;
          field.pointerDown = false;
          if (document.activeElement !== field.el) continue;
          normalizeSelection(field, "pointer");
          updateMenu(field);
        }
      },
      true
    );
    document.addEventListener(
      "mousedown",
      (event) => {
        if (!menuEl || menuEl.hidden || !menuOwner) return;
        if (menuEl.contains(event.target) || event.target === menuOwner.el) return;
        closeMenu(menuOwner);
      },
      true
    );
    window.addEventListener("resize", () => {
      for (const field of textFields.values()) growField(field);
      if (menuOwner) positionMenu(menuOwner);
    });
  }

  // Turn a template textarea into a chip field. `singleLine` (the subject):
  // Enter is swallowed, pasted newlines become spaces and the field grows
  // with its content.
  function attachTextField(el, options = {}) {
    if (!el || !el.parentNode || textFields.has(el) || typeof document === "undefined") return null;
    bindDocumentListeners();
    const singleLine = options.singleLine === true;
    const wrap = document.createElement("div");
    wrap.className = singleLine ? "cp-token-field-wrap single-line" : "cp-token-field-wrap";
    const mirror = document.createElement("div");
    mirror.className = "cp-token-field cp-token-field-mirror";
    mirror.setAttribute("aria-hidden", "true");
    el.parentNode.insertBefore(wrap, el);
    wrap.append(mirror, el);
    el.classList.add("cp-token-field", "cp-token-field-input");
    // Squiggles would land under chip labels the field can't change.
    el.spellcheck = false;
    el.setAttribute("autocomplete", "off");
    el.setAttribute("aria-autocomplete", "list");
    el.setAttribute("aria-expanded", "false");

    const field = {
      el,
      wrap,
      mirror,
      singleLine,
      map: currentMap,
      menu: null,
      dismissedAt: -1,
      lastSel: null,
      pointerDown: false,
      composing: false
    };
    textFields.set(el, field);

    el.addEventListener("beforeinput", (event) => onBeforeInput(field, event));
    el.addEventListener("input", () => onInput(field));
    el.addEventListener("keydown", (event) => onKeyDown(field, event));
    el.addEventListener("mousedown", (event) => {
      if (event.button === 0) field.pointerDown = true;
    });
    el.addEventListener("scroll", () => {
      syncMirrorScroll(field);
      positionMenu(field);
    });
    el.addEventListener("focus", () => {
      field.lastSel = readSelection(el);
      refreshIfPortalChanged();
    });
    el.addEventListener("blur", () => onBlur(field));
    el.addEventListener("copy", (event) => onCopy(field, event, false));
    el.addEventListener("cut", (event) => onCopy(field, event, true));
    el.addEventListener("paste", (event) => onPaste(field, event));
    el.addEventListener("compositionstart", () => {
      field.composing = true;
    });
    el.addEventListener("compositionend", () => {
      field.composing = false;
    });

    renderMirror(field);
    growField(field);
    return field;
  }

  // The stored value (`[key]`) of a field, chip field or not.
  function getStoredValue(el) {
    if (!el) return "";
    const field = textFields.get(el);
    return field ? displayToStored(el.value, field.map) : String(el.value ?? "");
  }

  // Load a stored value into a field. A field being typed in keeps its text
  // and caret when the value is what it already holds.
  function setStoredValue(el, stored) {
    if (!el) return;
    const next = String(stored ?? "");
    const field = textFields.get(el);
    if (!field) {
      el.value = next;
      return;
    }
    if (document.activeElement === el) {
      const current = displayToStored(el.value, field.map);
      if (current === next || current.trim() === next.trim()) {
        reseedField(field);
        return;
      }
    }
    field.map = currentMap;
    const display = storedToDisplay(next, currentMap);
    if (el.value !== display) el.value = display;
    field.dismissedAt = -1;
    field.lastSel = null;
    closeMenu(field);
    renderMirror(field);
    growField(field);
  }

  if (globalThis.chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes) return;
      if (Object.keys(changes).some((key) => key.startsWith(PROPERTY_DEFS_PREFIX))) void refreshVariables();
    });
  }
  void refreshVariables();

  App.tokenFields = {
    // Conversions
    foldSearch,
    buildTemplateVariables,
    buildTokenLabelMap,
    storedToDisplay,
    displayToStored,
    tokenChipHtml,
    tokensToHtml,
    htmlToTokens,
    textWithTokens,
    textToChipHtml,
    matchTokenVariables,
    atFragment,
    // Field list
    getVariables: () => variables,
    getLabelMap: () => currentMap,
    refreshVariables,
    // Editors
    attachTextField,
    getStoredValue,
    setStoredValue,
    setupTinyMceEditor,
    tinyMceContentStyle: TINYMCE_CONTENT_STYLE
  };
})();
