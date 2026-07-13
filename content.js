// LinkedIn Job Filter Content Script
(function () {
  "use strict";

  // --- Constants ---
  // /jobs/search-results (SDUI search page): class names are hashed,
  // but componentkey and role are stable. The classic selectors below it
  // cover the older /jobs/search/ page.
  const SEARCH_RESULTS_CARD_SELECTOR =
    'div[role="button"][componentkey^="job-card-component-ref-"]';

  const JOB_CARD_SELECTOR = [
    "li[data-occludable-job-id]",
    ".job-card-container",
    ".base-search-card",
    ".job-card-list__item",
    SEARCH_RESULTS_CARD_SELECTOR,
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

  const TITLE_SELECTORS = [
    ".job-card-list__title--link span[aria-hidden='true']",
    ".job-card-list__title--link",
    ".job-card-list__title",
    ".job-card-container__link span[aria-hidden='true']",
    ".job-card-container__link",
    ".artdeco-entity-lockup__title",
    ".base-search-card__title",
    "[data-test-job-title]",
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
      .querySelectorAll("[data-linkedin-filter-hidden-hr]")
      .forEach(function (divider) {
        divider.style.display = "";
        divider.removeAttribute("data-linkedin-filter-hidden-hr");
      });
    document
      .querySelectorAll(".linkedin-filter-hidden-count")
      .forEach(function (badge) {
        badge.remove();
      });
    document
      .querySelectorAll(".linkedin-filter-blacklist-btn")
      .forEach(function (btn) {
        btn.remove();
      });
    var snackbar = document.getElementById("linkedin-filter-snackbar");
    if (snackbar) snackbar.remove();
    window._linkedinFilterInitialized = false;
  }

  // Set up a keep-alive port: when the extension reloads / is disabled,
  // onDisconnect fires and we tear everything down — zero polling.
  //
  // CAUTION: onDisconnect ALSO fires when Chrome terminates the idle
  // service worker (~30s of inactivity), which does NOT invalidate this
  // context. Tearing down on that signal alone permanently disables
  // filtering in the tab, so verify the context first and simply
  // reconnect (waking the worker) when it's still alive.
  function setupKeepAlivePort() {
    if (_contextInvalid) return;

    try {
      var port = chrome.runtime.connect({ name: "linkedin-filter-keepalive" });
      port.onDisconnect.addListener(function () {
        var stillValid = false;
        try {
          stillValid = !!(chrome.runtime && chrome.runtime.id);
        } catch {
          stillValid = false;
        }

        if (stillValid) {
          setTimeout(setupKeepAlivePort, 1000);
        } else {
          teardownCompletely();
        }
      });
    } catch {
      // connect() itself threw — the context really is gone
      teardownCompletely();
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
    hideKeywords: false,
    blacklistedCompanies: [],
    blacklistedKeywords: [],
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
          "hideKeywords",
          "blacklistedCompanies",
          "blacklistedKeywords",
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
            hideKeywords: result.hideKeywords || false,
            blacklistedCompanies: result.blacklistedCompanies || [],
            blacklistedKeywords: result.blacklistedKeywords || [],
          };
          settingsLoaded = true;
          filterJobs();
        },
      );
    } catch (error) {
      console.warn("LinkedIn Filter: Error loading settings:", error.message);
    }
  }

  function isSearchResultsCard(jobCard) {
    return jobCard.matches?.(SEARCH_RESULTS_CARD_SELECTOR) || false;
  }

  // --- Company detection ---
  function getCompanyName(jobCard) {
    if (isSearchResultsCard(jobCard)) {
      // /jobs/search-results has no semantic classes; the card renders its
      // <p> elements in a fixed order: title, company, location, …
      const ps = jobCard.querySelectorAll("p");
      const text = ps.length > 1 ? ps[1].textContent.trim() : "";
      if (text) return text;
    }
    for (const selector of COMPANY_SELECTORS) {
      const element = jobCard.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text) return text;
    }
    return null;
  }

  // --- Job title detection ---
  function getJobTitle(jobCard) {
    if (isSearchResultsCard(jobCard)) {
      // Most reliable source on /jobs/search-results: the per-card dismiss
      // button, labelled "Dismiss <job title> job". English-only by design —
      // localizing every "Dismiss …" sentence pattern is not worth it; on
      // non-English UIs the selector simply never matches and the structural
      // fallback below (first <p> = title, per the fixed SDUI card layout)
      // takes over.
      const dismiss = jobCard.querySelector('button[aria-label^="Dismiss "]');
      const label = dismiss?.getAttribute("aria-label");
      if (label) {
        let title = label.slice("Dismiss ".length);
        if (title.endsWith(" job")) title = title.slice(0, -" job".length);
        title = title.trim();
        if (title) return title;
      }
      // Fallback: the visible (aria-hidden) part of the title paragraph
      const hiddenSpan = jobCard.querySelector('p span[aria-hidden="true"]');
      const text = hiddenSpan?.textContent?.trim();
      if (text) return text;
    }
    for (const selector of TITLE_SELECTORS) {
      const element = jobCard.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text) return text;
    }
    return null;
  }

  // --- Status labels ("Applied", "Viewed", "Promoted") ---
  // LinkedIn renders these in the user's LinkedIn UI language (a linkedin.com
  // setting, independent of Chrome's language), so every LinkedIn-supported
  // language needs an entry. All entries are lowercase; some are stems
  // ("visualizzat" covers visualizzato/visualizzata) matched with includes()
  // so grammatical suffixes and word order ("Applied 2d ago" vs German
  // "Vor 2 Wochen beworben") don't matter. includes() is safe ONLY because
  // getStatusTexts feeds it status/metadata rows and never the company name —
  // but SDUI metadata rows DO include the location, so never add an entry
  // that can occur in a place name (e.g. Spanish "vista" would hide every
  // job in Chula Vista; "visto" is kept, "vista" deliberately isn't).
  // "promoted" list verified against winterhazel/hide-promoted-jobs
  // langs.json (cross-checked with canklot/Linkedin_Promoted_Hider);
  // "applied" list seeded from Robert01101101/hide-applied-jobs-linkedin.
  // Entries marked (unverified) are best-effort — confirm against the live
  // UI when a report comes in.
  const STATUS_LABELS = {
    applied: [
      "applied", // en
      "solicitado", // es (also matches "Solicitados")
      "candidature envoyée", // fr
      "beworben", // de
      "applicato", // it (verified live UI 2026-07: "Applicato · 1 giorno fa")
      "candidature inoltrate", // it classic UI (verified live 2026-07)
      "candidatura inoltrata", // it singular variant
      "candidatura inviata", // it variant (older UI)
      "candidatou-se", // pt classic UI (verified live 2026-07)
      "candidatura enviada", // pt variant
      "sollicitatie verzonden", // nl
      "ansökt", // sv
      "søgt", // da
      "søkt", // no
      "haettu", // fi
      "zaaplikowano", // pl
      "přihlášeno", // cs
      "jelentkezett", // hu
      "başvurulan", // tr stem (verified live 2026-07: "Başvurulanlar"; also covers "başvurulan")
      "başvuruldu", // tr variant (unverified)
      "candidatură depusă", // ro (verified live 2026-07: "Candidatură depusă · cu 1 zi în urmă")
      "candidaturi depuse", // ro plural variant
      "aplicat", // ro variant (unverified)
      "已应用", // zh-CN (verified live 2026-07: "已应用 · 的时间: 1 天前")
      "已申请", // zh-CN variant (unverified)
      "заявка подана", // ru classic UI (verified live 2026-07)
      "выполнено", // ru SDUI (verified live 2026-07: "Выполнено · 1 день назад")
      "отклик отправлен", // ru variant (unverified)
      "вы откликнулись", // ru variant (unverified)
    ],
    viewed: [
      "viewed", // en
      "visto", // es
      "consulté", // fr (covers Consulté/Consultée)
      "angesehen", // de
      "visualizzat", // it (visualizzato/visualizzata)
      "visualizad", // pt (visualizada/visualizado)
      "bekeken", // nl
      "wyświetlon", // pl (wyświetlone/wyświetlona)
      "megtekintve", // hu
      "görüntülen", // tr stem (verified live 2026-07: "Görüntülenen"; also covers "görüntülendi")
      "vizualizat", // ro (also matches "vizualizată")
      "просмотрен", // ru (просмотрено/просмотрена)
      "已查看", // zh-CN
      "已浏览", // zh-CN variant
    ],
    promoted: [
      "promoted", // en
      "الترويج", // ar
      "propagováno", // cs
      "promoveret", // da
      "anzeige", // de
      "promocionado", // es
      "promu(e)", // fr
      "sponsorisé", // fr variant
      "प्रमोट किया गया", // hi
      "dipromosikan", // id/ms
      "promosso", // it
      "プロモーション", // ja
      "프로모션", // ko
      "gepromoot", // nl
      "promotert", // no
      "promowana oferta pracy", // pl
      "promovida", // pt
      "promovat", // ro
      "продвигается", // ru
      "marknadsfört", // sv
      "โปรโมทแล้ว", // th
      "nai-promote", // tl
      "na-promote", // tl variant
      "öne çıkarılan içerik", // tr
      "tanıtılan", // tr variant
      "tanıtıldı", // tr variant
      "просувається", // uk
      "广告", // zh
      "推广", // zh variant
      "已宣傳", // zh-TW
    ],
  };

  function matchesStatus(statusTextLower, labels) {
    return labels.some((label) => statusTextLower.includes(label));
  }

  function getStatusTexts(jobCard) {
    const texts = [];
    jobCard.querySelectorAll(FOOTER_ITEM_SELECTOR).forEach(function (item) {
      texts.push(item.textContent.trim());
    });
    if (texts.length === 0 && isSearchResultsCard(jobCard)) {
      // Status labels are bare <p> elements in the metadata row. Skip the
      // company paragraph so companies like "Applied Materials" never
      // match the "Applied" status prefix.
      const company = getCompanyName(jobCard);
      jobCard.querySelectorAll("p").forEach(function (p) {
        const text = p.textContent.trim();
        if (!text || text.length > 40) return;
        if (company && text === company) return;
        texts.push(text);
      });
    }
    return texts;
  }

  // --- Hide target ---
  // On /jobs/search-results the role="button" card sits inside a styled
  // wrapper that is a direct child of the lazy-column list; hiding only
  // the inner card would leave an empty bordered shell behind.
  function getHideTarget(jobCard) {
    if (isSearchResultsCard(jobCard)) {
      const wrapper = jobCard.closest('[data-testid="lazy-column"] > *');
      if (wrapper) return wrapper;
    }
    return jobCard;
  }

  // /jobs/search-results renders an <hr> divider between cards as a sibling
  // of the card wrapper; hide it together with the card so dividers don't
  // stack.
  function setDividerHidden(target, hidden) {
    const divider = target.nextElementSibling;
    if (!divider || divider.tagName !== "HR") return;
    if (hidden) {
      divider.style.display = "none";
      divider.setAttribute("data-linkedin-filter-hidden-hr", "true");
    } else if (divider.hasAttribute("data-linkedin-filter-hidden-hr")) {
      divider.style.display = "";
      divider.removeAttribute("data-linkedin-filter-hidden-hr");
    }
  }

  // --- Snackbar ---
  let snackbarTimer = null;

  function showSnackbar(message, actionLabel, actionFn) {
    let bar = document.getElementById("linkedin-filter-snackbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "linkedin-filter-snackbar";
      document.body.appendChild(bar);
    }

    bar.textContent = "";
    const text = document.createElement("span");
    text.textContent = message;
    bar.appendChild(text);

    if (actionLabel) {
      const action = document.createElement("button");
      action.type = "button";
      action.textContent = actionLabel;
      action.addEventListener("click", function () {
        hideSnackbar();
        actionFn();
      });
      bar.appendChild(action);
    }

    bar.classList.add("visible");
    clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(hideSnackbar, 5000);
  }

  function hideSnackbar() {
    clearTimeout(snackbarTimer);
    const bar = document.getElementById("linkedin-filter-snackbar");
    if (bar) bar.classList.remove("visible");
  }

  // --- Per-card blacklist button ---
  const BLACKLIST_ICON_SVG =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none"' +
    ' stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="6.2"/>' +
    '<line x1="3.8" y1="3.8" x2="12.2" y2="12.2"/></svg>';

  // Idempotent: called from every filterJobs pass, so buttons survive
  // LinkedIn's React re-renders and card recycling in the virtual list.
  function ensureBlacklistButton(jobCard) {
    if (jobCard.querySelector(".linkedin-filter-blacklist-btn")) return;

    const btn = document.createElement("button");
    btn.className = "linkedin-filter-blacklist-btn";
    btn.type = "button";
    btn.title = "Add this company to the blacklist";
    btn.innerHTML = BLACKLIST_ICON_SVG;
    btn.addEventListener("click", function (event) {
      onBlacklistClick(jobCard, event);
    });

    // The button is absolutely positioned relative to the card
    if (getComputedStyle(jobCard).position === "static") {
      jobCard.style.position = "relative";
    }
    jobCard.appendChild(btn);
  }

  function onBlacklistClick(jobCard, event) {
    // The whole card is a link — don't navigate to the job
    event.preventDefault();
    event.stopPropagation();

    if (_contextInvalid) return;

    const company = getCompanyName(jobCard);
    if (!company) {
      showSnackbar("Couldn't detect the company name for this job");
      return;
    }

    try {
      chrome.storage.sync.get(["blacklistedCompanies"], function (result) {
        if (chrome.runtime.lastError) return;

        const companies = result.blacklistedCompanies || [];
        const alreadyListed = companies.some(function (c) {
          return c.toLowerCase() === company.toLowerCase();
        });
        if (alreadyListed) {
          notifyBlacklisted(company, true);
          return;
        }

        companies.push(company);
        chrome.storage.sync.set(
          { blacklistedCompanies: companies },
          function () {
            if (chrome.runtime.lastError) {
              showSnackbar(
                "Couldn't save: " + chrome.runtime.lastError.message,
              );
              return;
            }
            // storage.onChanged re-filters every tab; we only show feedback
            notifyBlacklisted(company, false);
          },
        );
      });
    } catch {
      _contextInvalid = true;
    }
  }

  function notifyBlacklisted(company, alreadyListed) {
    const base = alreadyListed
      ? '"' + company + '" is already blacklisted'
      : '"' + company + '" added to blacklist';

    // If nothing will visibly happen, say why and offer to fix it
    if (!settings.enabled) {
      showSnackbar(
        base + " — the extension is turned off",
        "Turn on",
        function () {
          chrome.storage.sync.set({
            extensionEnabled: true,
            hideCompanies: true,
          });
        },
      );
    } else if (!settings.hideCompanies) {
      showSnackbar(
        base + ' — "Hide Blacklisted Companies" is off',
        "Turn on",
        function () {
          chrome.storage.sync.set({ hideCompanies: true });
        },
      );
    } else if (!alreadyListed) {
      showSnackbar(base, "Undo", function () {
        chrome.storage.sync.get(["blacklistedCompanies"], function (result) {
          const list = (result.blacklistedCompanies || []).filter(
            function (c) {
              return c !== company;
            },
          );
          chrome.storage.sync.set({ blacklistedCompanies: list });
        });
      });
    } else {
      showSnackbar(base);
    }
  }

  // --- Filtering ---
  function filterJobs() {
    if (!settingsLoaded) return;

    const jobCards = document.querySelectorAll(JOB_CARD_SELECTOR);
    let newlyHidden = 0;

    jobCards.forEach((jobCard) => {
      // On the classic UI, JOB_CARD_SELECTOR matches nested elements — the
      // <li data-occludable-job-id> AND its inner .job-card-container.
      // Process only the outermost match so a card can't be hidden, counted,
      // or given a blacklist button twice. The skipped inner element must
      // still be marked processed or the anti-flicker CSS holds it at
      // opacity 0 until the fail-safe reveal.
      if (jobCard.parentElement?.closest(JOB_CARD_SELECTOR)) {
        jobCard.setAttribute("data-linkedin-filter-processed", "true");
        return;
      }

      ensureBlacklistButton(jobCard);

      // Collect all matching reasons — a card can match multiple filters.
      // When the global switch is off no reasons are collected, so every
      // card is unhidden below while still being marked as processed
      // (the anti-flicker CSS relies on that attribute).
      const reasons = [];

      if (settings.enabled) {
        // Check status labels against every LinkedIn UI language (see
        // STATUS_LABELS). Substring match, not prefix/equality: LinkedIn
        // renders variants like "Applied 2d ago" and some languages put the
        // label last ("Vor 2 Wochen beworben").
        getStatusTexts(jobCard).forEach((text) => {
          const lower = text.toLowerCase();
          if (settings.hideApplied && matchesStatus(lower, STATUS_LABELS.applied))
            reasons.push("Applied");
          if (settings.hideViewed && matchesStatus(lower, STATUS_LABELS.viewed))
            reasons.push("Viewed");
          if (settings.hidePromoted && matchesStatus(lower, STATUS_LABELS.promoted))
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

        // Check title keywords (case-insensitive substring match)
        if (
          settings.hideKeywords &&
          settings.blacklistedKeywords.length > 0
        ) {
          const title = getJobTitle(jobCard);
          if (title) {
            const titleLower = title.toLowerCase();
            const matched = settings.blacklistedKeywords.find((kw) => {
              const kwLower = kw.toLowerCase().trim();
              // An empty entry would match every title via includes("")
              return kwLower && titleLower.includes(kwLower);
            });
            if (matched) {
              reasons.push("Keyword: " + matched);
            }
          }
        }
      }

      const shouldHide = reasons.length > 0;
      const target = getHideTarget(jobCard);
      if (shouldHide) {
        if (target.getAttribute("data-linkedin-filter-hidden") !== "true") {
          newlyHidden++;
        }
        target.style.display = "none";
        target.setAttribute("data-linkedin-filter-hidden", "true");
        target.setAttribute("data-linkedin-filter-reason", reasons.join(", "));
        setDividerHidden(target, true);
      } else {
        target.style.display = "";
        target.removeAttribute("data-linkedin-filter-hidden");
        target.removeAttribute("data-linkedin-filter-reason");
        setDividerHidden(target, false);
      }
      jobCard.setAttribute("data-linkedin-filter-processed", "true");
    });

    recordHiddenJobs(newlyHidden);
    updateJobCounter();
  }

  // --- Lifetime hidden counter (chrome.storage.local) ---
  // Feeds the popup's review ask. Incremented only when a card transitions
  // to hidden, so filter re-runs don't inflate it — but LinkedIn's virtual
  // list recycles DOM nodes, so a job re-rendered after scrolling can be
  // counted again. Approximate by design; display only. storage.local, not
  // sync: writes happen on filter passes and would burn sync's write quota.
  function recordHiddenJobs(count) {
    if (count <= 0 || !isExtensionContextValid()) return;
    try {
      chrome.storage.local.get({ totalHiddenJobs: 0 }, function (result) {
        if (chrome.runtime.lastError) return;
        chrome.storage.local.set({
          totalHiddenJobs: (result.totalHiddenJobs || 0) + count,
        });
      });
    } catch {
      // Context died between the validity check and the call; the
      // keep-alive port's onDisconnect handles teardown.
    }
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
    // Classic pages also render "discovery" job cards (similar jobs, jobs
    // for you, hiring in your network) below the main results. Those are
    // filtered like any other card, but the counter sits next to LinkedIn's
    // "N results" header, so it must only count the main list — its cards
    // are the li[data-occludable-job-id] items, which discovery cards lack.
    // Pages without occludable <li>s (SDUI, logged-out layouts) fall back
    // to counting every card.
    const mainListCards = document.querySelectorAll(
      "li[data-occludable-job-id]",
    );
    let totalJobs, hiddenJobs;
    if (mainListCards.length > 0) {
      totalJobs = mainListCards.length;
      hiddenJobs = document.querySelectorAll(
        'li[data-occludable-job-id][data-linkedin-filter-hidden="true"]',
      ).length;
    } else {
      totalJobs = document.querySelectorAll(JOB_CARD_SELECTOR).length;
      hiddenJobs = document.querySelectorAll(
        '[data-linkedin-filter-hidden="true"]',
      ).length;
    }

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

    updateSearchResultsCounter(totalJobs, hiddenJobs);
  }

  // /jobs/search-results has no counter/subtitle element to append to, so
  // we render our own banner at the top of the results list. Re-inserted
  // on every filter pass, so it survives LinkedIn's re-renders.
  function updateSearchResultsCounter(totalJobs, hiddenJobs) {
    if (!document.querySelector(SEARCH_RESULTS_CARD_SELECTOR)) return;

    const list =
      document.querySelector(
        '[data-testid="lazy-column"][componentkey="SearchResultsMainContent"]',
      ) || document.querySelector('[data-testid="lazy-column"]');
    if (!list) return;

    let banner = list.querySelector(
      ":scope > .linkedin-filter-hidden-count",
    );

    if (hiddenJobs > 0 && totalJobs > 0) {
      if (!banner) {
        banner = document.createElement("div");
        banner.className =
          "linkedin-filter-hidden-count linkedin-filter-hidden-count--banner";
        list.insertBefore(banner, list.firstChild);
      }
      banner.textContent =
        hiddenJobs + (hiddenJobs === 1 ? " job" : " jobs") +
        " hidden by filter";
    } else if (banner) {
      banner.remove();
    }
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
              ".jobs-search-results, .jobs-search-results-list, [data-testid='lazy-column']",
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
      ".job-card-list__item:not([data-linkedin-filter-processed])," +
      'div[role="button"][componentkey^="job-card-component-ref-"]:not([data-linkedin-filter-processed])' +
      "{ opacity: 0; animation: linkedin-filter-reveal 0.2s ease-in-out 3s forwards; }" +
      "@keyframes linkedin-filter-reveal { to { opacity: 1; } }" +
      "li[data-occludable-job-id][data-linkedin-filter-processed]," +
      ".job-card-container[data-linkedin-filter-processed]," +
      ".base-search-card[data-linkedin-filter-processed]," +
      ".job-card-list__item[data-linkedin-filter-processed]," +
      'div[role="button"][componentkey^="job-card-component-ref-"][data-linkedin-filter-processed]' +
      "{ opacity: 1 !important; transition: opacity 0.2s ease-in-out; }" +
      '[data-linkedin-filter-hidden="true"]' +
      "{ display: none !important; }" +
      // Hidden-count banner on /jobs/search-results
      ".linkedin-filter-hidden-count--banner" +
      "{ padding: 8px 16px; font-size: 13px; font-weight: 600;" +
      " color: #b74700; background: rgba(183, 71, 0, 0.06);" +
      " border-bottom: 1px solid rgba(0, 0, 0, 0.08); }" +
      // Per-card blacklist button, revealed on card hover
      ".linkedin-filter-blacklist-btn" +
      "{ position: absolute; top: 8px; right: 44px; width: 28px; height: 28px;" +
      " display: flex; align-items: center; justify-content: center;" +
      " border: none; border-radius: 50%; background: transparent; color: #666;" +
      " cursor: pointer; opacity: 0; padding: 0; z-index: 10;" +
      " transition: opacity 0.15s ease, background 0.15s ease; }" +
      "[data-linkedin-filter-processed]:hover .linkedin-filter-blacklist-btn," +
      ".linkedin-filter-blacklist-btn:focus-visible" +
      "{ opacity: 1; }" +
      ".linkedin-filter-blacklist-btn:hover" +
      "{ background: rgba(0, 0, 0, 0.08); color: #b74700; }" +
      // Snackbar
      "#linkedin-filter-snackbar" +
      "{ position: fixed; bottom: 24px; left: 50%;" +
      " transform: translateX(-50%) translateY(8px);" +
      " background: #1d1d1d; color: #fff; padding: 10px 16px;" +
      " border-radius: 8px; font-size: 13px; display: flex;" +
      " align-items: center; gap: 16px; max-width: 480px;" +
      " box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); z-index: 2147483647;" +
      " opacity: 0; pointer-events: none;" +
      " transition: opacity 0.2s ease, transform 0.2s ease; }" +
      "#linkedin-filter-snackbar.visible" +
      "{ opacity: 1; transform: translateX(-50%) translateY(0);" +
      " pointer-events: auto; }" +
      "#linkedin-filter-snackbar button" +
      "{ background: none; border: none; color: #70b5f9; font-weight: 600;" +
      " font-size: 13px; cursor: pointer; padding: 4px; white-space: nowrap; }";

    // Safely append even at document_start
    (document.head || document.documentElement).appendChild(style);
  }

  // --- Initialization ---
  function cleanup() {
    cleanupEventListeners();
    hideSnackbar();
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
