(() => {
  const shared = (globalThis.ContactPilotShared = globalThis.ContactPilotShared || {});

  shared.CLOUD_API_BASE_URL = "https://contactpoint.vercel.app";

  shared.TIMING = Object.freeze({
    popup: Object.freeze({
      waitForTabCompleteTimeoutMs: 30000,
      messageRetryAttempts: 5,
      messageRetryDelayMs: 700,
      contactTabPostLoadDelayMs: 1200,
      emailComposerReadyDelayMs: 900,
      // How often the popup asks the website for teams added since sign-in.
      cloudTeamDiscoveryIntervalMs: 5 * 60 * 1000
    }),
    content: Object.freeze({
      tableScrollDelayMs: 240,
      noteComposerOpenAttempts: 20,
      noteComposerOpenDelayMs: 400,
      noteEditorSettleDelayMs: 250,
      noteSaveSettleDelayMs: 1200,
      noteReadRetryAttempts: 14,
      noteReadRetryDelayMs: 450,
      emailComposerOpenAttempts: 20,
      emailComposerOpenDelayMs: 300,
      // HubSpot's property list (names, labels, dropdown options) changes
      // rarely; re-read it at most this often per account.
      hubspotPropertyDefsCacheMs: 6 * 60 * 60 * 1000
    }),
    background: Object.freeze({
      // Opening template search in HubSpot asks the website whether a team's
      // templates changed, at most this often per team. The answer is served
      // from the website's cache, so checks are cheap.
      cloudTemplateCheckIntervalMs: 60 * 1000,
      cloudRequestTimeoutMs: 12000
    })
  });
})();
