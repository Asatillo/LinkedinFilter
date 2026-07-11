// LinkedIn Job Filter Content Script
(function () {
  "use strict";

  // --- Constants ---
  const JOB_CARD_SELECTOR = [
    "li[data-occludable-job-id]",
    ".job-card-container",
    ".base-search-card",
    ".job-card-list__item",
  ].join(", ");

  const FOOTER_ITEM_SELECTOR = [
    ".job-card-container__footer-item",
    ".job-card-container__footer .artdeco-inline-feedback",
  ].join(", ");

  const COMPANY_SELECTORS = [
    ".artdeco-entity-lockup__subtitle span",
    ".artdeco-entity-lockup__subtitle",
    ".job-card-container__primary-description",
    ".job-card-container__company-name",
    ".job-card-container__link-subtitle",
    ".base-search-card__subtitle a",
    ".base-search-card__subtitle span",
    ".base-search-card__subtitle",
    ".job-card-list__company-name",
    "[data-test-job-company-name]",
  ];

  const COUNTER_SELECTOR = [
    ".jobs-search-results-list__subtitle",
    ".jobs-search-results__subtitle",
    ".jobs-search-two-pane__header-description",
    ".jobs-search-results-list__text",
    ".jobs-search-results__text",
  ].join(", ");

  const FILTER_DEBOUNCE_MS = 200;
  const SCROLL_DEBOUNCE_MS = 300;

  // --- Extension context validation ---
  // NEVER access chrome.runtime from high-frequency callbacks (MutationObserver,
  // scroll, etc.). Each access on an invalidated context triggers a
  // GET chrome-extension://invalid/ network request.
  // Instead, we open a long-lived port and listen for onDisconnect once.
  let _contextInvalid = false;

  function isExtensionContextValid() {
    if (_contextInvalid) return false;
    try {
      if (chrome && chrome.runtime && chrome.runtime.id) return true;
      _contextInvalid = true;
      return false;
    } catch {
      _contextInvalid = true;
      return false;
    }
  }

  // Full teardown: disconnect observers, remove listeners, clear DOM artifacts
  function teardownCompletely() {
    if (_contextInvalid) return; // already torn down
    _contextInvalid = true;
    cleanupEventListeners();
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    if (_navCleanup) {
      _navCleanup();
      _navCleanup = null;
    }
    var css = document.getElementById("linkedin-filter-css");
    if (css) css.remove();
    // Leave the page as we found it: unhide filtered cards, drop our markers
    document
      .querySelectorAll("[data-linkedin-filter-hidden]")
      .forEach(function (card) {
        card.style.display = "";
        card.removeAttribute("data-linkedin-filter-hidden");
        card.removeAttribute("data-linkedin-filter-reason");
      });
    document
      .querySelectorAll(".linkedin-filter-hidden-count")
      .forEach(function (badge) {
        badge.remove();
      });
    window._linkedinFilterInitialized = false;
  }

  // Set up a keep-alive port: when the extension reloads / is disabled,
  // onDisconnect fires ONCE and we tear everything down — zero polling.
  function setupKeepAlivePort() {
    try {
      var port = chrome.runtime.connect({ name: "linkedin-filter-keepalive" });
      port.onDisconnect.addListener(function () {
        teardownCompletely();
      });
    } catch {
      _contextInvalid = true;
    }
  }

  if (!isExtensionContextValid()) {
    return;
  }

  function isJobsPage() {
    return window.location.pathname.includes("/jobs");
  }

  // --- State ---
  let settings = {
    enabled: true,
    hideApplied: false,
    hideViewed: false,
    hideCompanies: false,
    hidePromoted: false,
    blacklistedCompanies: [],
  };
  let settingsLoaded = false;
  let filterDebounceTimer = null;
  let scrollDebounceTimer = null;
  let domObserver = null;
  let _navCleanup = null;
  let eventListenerCleanups = [];

  // --- Settings ---
  function loadSettings() {
    if (_contextInvalid) return;

    try {
      chrome.storage.sync.get(
        [
          "extensionEnabled",
          "hideApplied",
          "hideViewed",
          "hideCompanies",
          "hidePromoted",
          "blacklistedCompanies",
        ],
        function (result) {
          if (chrome.runtime.lastError) {
            console.warn("LinkedIn Filter:", chrome.runtime.lastError.message);
            return;
          }

          settings = {
            // Default ON: only an explicit false disables the extension
            enabled: result.extensionEnabled !== false,
            hideApplied: result.hideApplied || false,
            hideViewed: result.hideViewed || false,
            hideCompanies: result.hideCompanies || false,
            hidePromoted: result.hidePromoted || false,
            blacklistedCompanies: result.blacklistedCompanies || [],
          };
          settingsLoaded = true;
          filterJobs();
        },
      );
    } catch (error) {
      console.warn("LinkedIn Filter: Error loading settings:", error.message);
    }
  }

  // --- Company detection ---
  function getCompanyName(jobCard) {
    for (const selector of COMPANY_SELECTORS) {
      const element = jobCard.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text) return text;
    }
    return null;
  }

  // --- Filtering ---
  function filterJobs() {
    if (!settingsLoaded) return;

    const jobCards = document.querySelectorAll(JOB_CARD_SELECTOR);

    jobCards.forEach((jobCard) => {
      // Collect all matching reasons — a card can match multiple filters.
      // When the global switch is off no reasons are collected, so every
      // card is unhidden below while still being marked as processed
      // (the anti-flicker CSS relies on that attribute).
      const reasons = [];

      if (settings.enabled) {
        // Check status labels. Prefix match, not equality: LinkedIn renders
        // variants like "Applied 2d ago".
        const footerItems = jobCard.querySelectorAll(FOOTER_ITEM_SELECTOR);
        footerItems.forEach((item) => {
          const text = item.textContent.trim();
          if (settings.hideApplied && text.startsWith("Applied"))
            reasons.push("Applied");
          if (settings.hideViewed && text.startsWith("Viewed"))
            reasons.push("Viewed");
          if (settings.hidePromoted && text.startsWith("Promoted"))
            reasons.push("Promoted");
        });

        // Check company blacklist. One-directional match only: the card's
        // company name must contain the blacklisted term, not the reverse,
        // so short blacklist entries can't match unrelated companies.
        if (
          settings.hideCompanies &&
          settings.blacklistedCompanies.length > 0
        ) {
          const companyName = getCompanyName(jobCard);
          if (companyName) {
            const companyLower = companyName.toLowerCase();
            const isBlacklisted = settings.blacklistedCompanies.some((bl) => {
              const blLower = bl.toLowerCase().trim();
              // An empty entry would match every company via includes("")
              if (!blLower) return false;
              return companyLower === blLower || companyLower.includes(blLower);
            });
            if (isBlacklisted) {
              reasons.push("Blacklisted: " + companyName);
            }
          }
        }
      }

      const shouldHide = reasons.length > 0;
      if (shouldHide) {
        jobCard.style.display = "none";
        jobCard.setAttribute("data-linkedin-filter-hidden", "true");
        jobCard.setAttribute("data-linkedin-filter-reason", reasons.join(", "));
      } else {
        jobCard.style.display = "";
        jobCard.removeAttribute("data-linkedin-filter-hidden");
        jobCard.removeAttribute("data-linkedin-filter-reason");
      }
      jobCard.setAttribute("data-linkedin-filter-processed", "true");
    });

    updateJobCounter();
  }

  function debouncedFilterJobs() {
    if (!settingsLoaded) return;
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(filterJobs, FILTER_DEBOUNCE_MS);
  }

  // --- Job counter ---
  // Append a badge next to LinkedIn's counter rather than rewriting its
  // text: LinkedIn updates the counter in place (pagination, live counts),
  // so any cached "original text" we restore would go stale.
  function updateJobCounter() {
    const totalJobs = document.querySelectorAll(
      "li[data-occludable-job-id]",
    ).length;
    const hiddenJobs = document.querySelectorAll(
      'li[data-occludable-job-id][data-linkedin-filter-hidden="true"]',
    ).length;

    const counters = document.querySelectorAll(COUNTER_SELECTOR);

    counters.forEach((counter) => {
      let badge = counter.querySelector(".linkedin-filter-hidden-count");

      if (hiddenJobs > 0 && totalJobs > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "linkedin-filter-hidden-count";
          counter.appendChild(badge);
        }
        badge.textContent = " (" + hiddenJobs + " hidden by filter)";
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // --- DOM observation ---
  function setupDOMObserver() {
    if (domObserver) {
      domObserver.disconnect();
    }

    domObserver = new MutationObserver(function (mutations) {
      // Only check the cached flag — never access chrome.runtime here
      if (_contextInvalid) return;

      let shouldFilter = false;

      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          if (
            node.matches?.(JOB_CARD_SELECTOR) ||
            node.querySelector?.(JOB_CARD_SELECTOR) ||
            node.querySelector?.(
              ".jobs-search-results, .jobs-search-results-list",
            )
          ) {
            shouldFilter = true;
            break;
          }
        }
        if (shouldFilter) break;
      }

      if (shouldFilter) {
        debouncedFilterJobs();
      }
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // --- SPA navigation handling ---
  // Prefers the Navigation API (Chrome 102+); falls back to a lightweight
  // 1-second URL poll. This watcher survives cleanup() — it must keep
  // detecting route changes — and is only removed by teardownCompletely().
  function setupNavigationWatcher() {
    if (_navCleanup) {
      _navCleanup();
      _navCleanup = null;
    }

    let currentUrl = location.href;

    function onUrlMaybeChanged() {
      if (_contextInvalid) return;
      if (location.href === currentUrl) return;
      currentUrl = location.href;

      if (isJobsPage()) {
        cleanup();
        setTimeout(init, 800);
      } else {
        // Left the jobs section — stop observing/filtering the feed etc.
        cleanup();
      }
    }

    if (window.navigation) {
      window.navigation.addEventListener(
        "currententrychange",
        onUrlMaybeChanged,
      );
      _navCleanup = function () {
        window.navigation.removeEventListener(
          "currententrychange",
          onUrlMaybeChanged,
        );
      };
    } else {
      const intervalId = setInterval(onUrlMaybeChanged, 1000);
      _navCleanup = function () {
        clearInterval(intervalId);
      };
    }
  }

  // --- Event listeners ---
  // Every listener is tracked so cleanup() on SPA navigation removes it;
  // untracked listeners would accumulate across re-inits.
  function setupEventListeners() {
    cleanupEventListeners();

    function addTrackedListener(target, event, handler, options) {
      target.addEventListener(event, handler, options);
      eventListenerCleanups.push(() =>
        target.removeEventListener(event, handler, options),
      );
    }

    addTrackedListener(document, "visibilitychange", function () {
      if (!document.hidden) debouncedFilterJobs();
    });

    addTrackedListener(
      window,
      "scroll",
      function () {
        clearTimeout(scrollDebounceTimer);
        scrollDebounceTimer = setTimeout(function () {
          if (settingsLoaded) filterJobs();
        }, SCROLL_DEBOUNCE_MS);
      },
      { passive: true },
    );

    addTrackedListener(window, "focus", function () {
      debouncedFilterJobs();
    });

    addTrackedListener(window, "popstate", function () {
      if (isJobsPage()) debouncedFilterJobs();
    });
  }

  function cleanupEventListeners() {
    eventListenerCleanups.forEach(function (fn) {
      fn();
    });
    eventListenerCleanups = [];
    clearTimeout(scrollDebounceTimer);
    clearTimeout(filterDebounceTimer);
  }

  // --- Settings change listener ---
  // storage.onChanged fires in every tab, so settings changed from the
  // popup reach background tabs too — no message passing needed.
  function setupStorageListener() {
    if (!isExtensionContextValid()) return;

    try {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (_contextInvalid || areaName !== "sync") return;
        loadSettings();
      });
    } catch (error) {
      console.warn(
        "LinkedIn Filter: Storage listener setup failed:",
        error.message,
      );
    }
  }

  // --- CSS injection ---
  function injectFilterCSS() {
    if (document.getElementById("linkedin-filter-css")) return;

    const style = document.createElement("style");
    style.id = "linkedin-filter-css";
    // Unprocessed cards are held at opacity 0 to avoid a flash of
    // to-be-hidden jobs, with a 3s fail-safe animation that reveals them
    // even if filtering never runs. The base opacity must not be
    // !important — important declarations override CSS animations.
    style.textContent =
      "li[data-occludable-job-id]:not([data-linkedin-filter-processed])," +
      ".job-card-container:not([data-linkedin-filter-processed])," +
      ".base-search-card:not([data-linkedin-filter-processed])," +
      ".job-card-list__item:not([data-linkedin-filter-processed])" +
      "{ opacity: 0; animation: linkedin-filter-reveal 0.2s ease-in-out 3s forwards; }" +
      "@keyframes linkedin-filter-reveal { to { opacity: 1; } }" +
      "li[data-occludable-job-id][data-linkedin-filter-processed]," +
      ".job-card-container[data-linkedin-filter-processed]," +
      ".base-search-card[data-linkedin-filter-processed]," +
      ".job-card-list__item[data-linkedin-filter-processed]" +
      "{ opacity: 1 !important; transition: opacity 0.2s ease-in-out; }" +
      '[data-linkedin-filter-hidden="true"]' +
      "{ display: none !important; }";

    // Safely append even at document_start
    (document.head || document.documentElement).appendChild(style);
  }

  // --- Initialization ---
  function cleanup() {
    cleanupEventListeners();
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    // Navigation watcher persists — it needs to detect future route changes
    window._linkedinFilterInitialized = false;
  }

  function init() {
    if (_contextInvalid) return;
    if (window._linkedinFilterInitialized) return;
    window._linkedinFilterInitialized = true;

    injectFilterCSS();
    loadSettings();

    // document.body must exist for DOM observer
    if (document.body) {
      setupDOMObserver();
    }

    setupEventListeners();
    retryFilterJobs();
  }

  function retryFilterJobs(retriesLeft) {
    if (retriesLeft === undefined) retriesLeft = 5;
    if (_contextInvalid) return;

    if (!settingsLoaded) {
      if (retriesLeft > 0) {
        setTimeout(function () {
          if (_contextInvalid) return;
          retryFilterJobs(retriesLeft - 1);
        }, 500);
      }
      return;
    }

    var jobCards = document.querySelectorAll(JOB_CARD_SELECTOR);
    if (jobCards.length === 0 && retriesLeft > 0) {
      setTimeout(function () {
        if (_contextInvalid) return;
        retryFilterJobs(retriesLeft - 1);
      }, 1000);
    } else {
      filterJobs();
    }
  }

  // --- Debug ---
  window.debugLinkedInFilter = function () {
    var jobCards = document.querySelectorAll(JOB_CARD_SELECTOR);
    console.group(
      "LinkedIn Filter: Company Detection (" + jobCards.length + " cards)",
    );
    jobCards.forEach(function (card, i) {
      var company = getCompanyName(card);
      var hidden = card.getAttribute("data-linkedin-filter-hidden");
      var reason = card.getAttribute("data-linkedin-filter-reason");
      console.log(
        "[" +
          i +
          "] " +
          (company || "(unknown)") +
          (hidden ? " [HIDDEN: " + reason + "]" : ""),
      );
    });
    console.groupEnd();
  };

  // --- Start ---
  setupKeepAlivePort();
  setupStorageListener();
  setupNavigationWatcher();

  // The manifest matches all LinkedIn pages so the navigation watcher can
  // catch SPA routing into /jobs from anywhere, but we only initialize
  // filtering on /jobs pages.
  if (!isJobsPage()) return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(init, 300);
    });
  } else {
    setTimeout(init, 500);
  }
})();
