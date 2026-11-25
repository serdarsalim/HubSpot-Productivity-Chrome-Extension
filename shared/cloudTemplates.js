// Cloud template cache format, shared by the popup and the background worker
// so both write exactly what content.js reads.
(() => {
  const shared = (globalThis.ContactPilotShared = globalThis.ContactPilotShared || {});

  const ID_PREFIX = "cloud_";
  // Even with no change reported, re-download once a day as a safety net.
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  function cacheKeys(organizationIdInput) {
    const organizationId = String(organizationIdInput || "").trim();
    if (!organizationId) return null;
    return {
      emailKey: `popupCloudEmailTemplates::${organizationId}`,
      whatsappKey: `popupCloudWhatsappTemplates::${organizationId}`,
      noteKey: `popupCloudNoteTemplates::${organizationId}`,
      metaKey: `popupCloudTemplatesMeta::${organizationId}`
    };
  }

  function stripPrefix(value) {
    return String(value || "").replace(new RegExp(`^${ID_PREFIX}`), "");
  }

  function rawTemplateId(item, organizationIdInput = "") {
    const organizationId = String(item?.organizationId || organizationIdInput || "").trim();
    const candidate = stripPrefix(String(item?.cloudId || "").trim()) || stripPrefix(String(item?.id || "").trim());
    if (!candidate) return "";
    if (organizationId && candidate.startsWith(`${organizationId}_`)) {
      return candidate.slice(organizationId.length + 1);
    }
    return candidate;
  }

  function normalizeArray(rawTemplates, expectedType, organizationIdInput = "") {
    const templates = [];
    const seen = new Set();
    const source = Array.isArray(rawTemplates) ? rawTemplates : [];

    for (const item of source) {
      const organizationId = String(item?.organizationId || organizationIdInput || "").trim();
      const baseId = rawTemplateId(item, organizationId);
      if (!baseId) continue;
      const compositeId = organizationId ? `${organizationId}_${baseId}` : baseId;
      const id = `${ID_PREFIX}${compositeId}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const type = String(item?.type || expectedType || "").toUpperCase();
      if (!type) continue;

      templates.push({
        id,
        cloudId: baseId,
        organizationId,
        type,
        source: "cloud",
        readOnly: true,
        name: String(item?.name || "").trim() || "Untitled",
        subject: String(item?.subject || "").trim(),
        body: String(item?.body || "").trim(),
        createdAt: String(item?.createdAt || "").trim() || null,
        updatedAt: String(item?.updatedAt || "").trim() || null
      });
    }

    return templates;
  }

  function splitByType(templates) {
    const email = [];
    const whatsapp = [];
    const note = [];
    for (const template of Array.isArray(templates) ? templates : []) {
      const type = String(template?.type || "").toUpperCase();
      if (type === "EMAIL") email.push(template);
      else if (type === "WHATSAPP") whatsapp.push(template);
      else if (type === "NOTE") note.push(template);
    }
    return { email, whatsapp, note };
  }

  // The website answers "latest edit + count" from its cache; only a
  // difference (or a missing/day-old local copy) triggers a full download.
  function needsFullSync(localMeta, remoteMeta, hasCachedTemplates, force) {
    if (force) return true;
    if (!hasCachedTemplates) return true;

    const localLatest = String(localMeta?.latestUpdatedAt || "");
    const remoteLatest = String(remoteMeta?.latestUpdatedAt || "");
    const localCount = Number(localMeta?.templateCount || 0);
    const remoteCount = Number(remoteMeta?.templateCount || 0);
    if (localLatest !== remoteLatest || localCount !== remoteCount) return true;

    const lastFullSyncMs = Date.parse(String(localMeta?.lastFullSyncAt || ""));
    if (!Number.isFinite(lastFullSyncMs)) return true;
    return Date.now() - lastFullSyncMs >= CACHE_TTL_MS;
  }

  shared.cloudTemplates = Object.freeze({
    ID_PREFIX,
    CACHE_TTL_MS,
    cacheKeys,
    rawTemplateId,
    normalizeArray,
    splitByType,
    needsFullSync
  });
})();
