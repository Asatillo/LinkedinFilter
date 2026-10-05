// LinkedIn Job Filter Popup Script
function t(key, subs) {
  return chrome.i18n.getMessage(key, subs) || key;
}

document.addEventListener("DOMContentLoaded", function () {
  // --- i18n: fill every tagged element from _locales ---
  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });

  // --- Constants ---
  var TOGGLE_IDS = [
    "hideApplied",
    "hideViewed",
    "hidePromoted",
    "hideEasyApply",
    "hideCompanies",
    "hideKeywords",
  ];
  var STORAGE_KEYS = TOGGLE_IDS.concat([
    "blacklistedCompanies",
    "blacklistedKeywords",
    "extensionEnabled",
  ]);

  // Lower-case labels used inside the "Hiding …" status line
  var FILTER_LABELS = {
    hideApplied: t("labelApplied"),
    hideViewed: t("labelViewed"),
    hidePromoted: t("labelPromoted"),
    hideEasyApply: t("labelEasyApply"),
    hideCompanies: t("labelCompanies"),
    hideKeywords: t("labelKeywords"),
  };

  var store = window.LinkedInFilterSettings;

  var masterToggle = document.getElementById("extensionEnabled");
  var importFile = document.getElementById("importFile");
  var lastError = null;
  var importDoneShown = false;

  // --- Load saved settings ---
  // get(null) fetches everything; the lists may be chunked across
  // sibling keys — assembleSettings is the one reader (settings-store.js).
  chrome.storage.sync.get(null, applyLoadedSettings);

  // Renders everything from a raw storage object — used by the initial
  // load and again after a settings import (a sanitized settings object
  // works too: it only contains the base list keys).
  function applyLoadedSettings(all) {
    if (chrome.runtime.lastError) {
      showStatusError(
        t("loadError", chrome.runtime.lastError.message || "unknown error"),
      );
      return;
    }
    var result = store.assembleSettings(all);
    TOGGLE_IDS.forEach(function (id) {
      if (result[id]) {
        document.getElementById(id).classList.add("active");
      }
    });

    // Master switch defaults ON: only an explicit false disables it
    var enabled = result.extensionEnabled !== false;
    masterToggle.classList.toggle("active", enabled);
    setDisabledUI(!enabled);

    companyList.display(result.blacklistedCompanies || []);
    keywordList.display(result.blacklistedKeywords || []);
    updateStatus();
  }

  // --- Master switch ---
  function setDisabledUI(off) {
    document.body.classList.toggle("extension-off", off);
    document.getElementById("switchState").textContent = off
      ? t("switchOff")
      : t("switchOn");
  }

  masterToggle.addEventListener("click", function () {
    var toggle = this;
    toggle.classList.toggle("active");
    var enabled = toggle.classList.contains("active");
    chrome.storage.sync.set({ extensionEnabled: enabled }, function () {
      if (chrome.runtime.lastError) {
        toggle.classList.toggle("active");
        showSaveError(chrome.runtime.lastError.message);
        return;
      }
      setDisabledUI(!enabled);
      updateStatus();
    });
  });

  // --- Toggle handlers ---
  TOGGLE_IDS.forEach(function (id) {
    document.getElementById(id).addEventListener("click", function () {
      var toggle = this;
      toggle.classList.toggle("active");
      var update = {};
      update[id] = toggle.classList.contains("active");
      chrome.storage.sync.set(update, function () {
        if (chrome.runtime.lastError) {
          // Revert the toggle so the UI reflects what's actually stored
          toggle.classList.toggle("active");
          showSaveError(chrome.runtime.lastError.message);
          return;
        }
        updateStatus();
      });
    });
  });

  // --- Blacklist management ---
  // One factory for both lists (companies, keywords): dedupe, storage
  // persistence, and chip rendering are identical apart from element
  // ids and the storage key. Enter adds the typed entry, Escape clears.
  function setupListManager(opts) {
    var input = document.getElementById(opts.inputId);
    var container = document.getElementById(opts.listId);

    // keydown, not keypress — Escape never fires keypress in modern browsers
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var value = input.value.trim();
        if (value) {
          addItem(value);
          input.value = "";
        }
      } else if (e.key === "Escape") {
        input.value = "";
        input.blur();
      }
    });

    // Writes go through buildListWrite: `set` carries the new chunks,
    // `remove` prunes stale chunk keys left over from a longer list.
    function persist(items) {
      chrome.storage.sync.get(null, function (all) {
        if (chrome.runtime.lastError) {
          showSaveError(chrome.runtime.lastError.message);
          return;
        }
        var w = store.buildListWrite(all, opts.storageKey, items);
        chrome.storage.sync.set(w.set, function () {
          if (chrome.runtime.lastError) {
            showSaveError(chrome.runtime.lastError.message);
            return;
          }
          if (w.remove.length) chrome.storage.sync.remove(w.remove);
          display(items);
          updateStatus();
        });
      });
    }

    function addItem(value) {
      chrome.storage.sync.get(null, function (all) {
        var items = store.assembleList(all, opts.storageKey);

        // Avoid duplicates (case insensitive)
        var exists = items.some(function (item) {
          return item.toLowerCase() === value.toLowerCase();
        });

        if (!exists) {
          items.push(value);
          persist(items);
        }
      });
    }

    function removeItem(value) {
      chrome.storage.sync.get(null, function (all) {
        var items = store
          .assembleList(all, opts.storageKey)
          .filter(function (item) {
            return item !== value;
          });
        persist(items);
      });
    }

    // Built programmatically with textContent/closures rather than
    // innerHTML: entries are user input and may contain &, <, ", etc.
    function display(items) {
      if (items.length === 0) {
        container.innerHTML =
          '<div class="empty-state">' + opts.emptyText + "</div>";
        return;
      }

      container.innerHTML = "";

      items.forEach(function (value) {
        var chip = document.createElement("span");
        chip.className = "item-chip";

        var label = document.createElement("span");
        label.className = "item-chip-label";
        label.textContent = value;
        label.title = value; // full text on hover when ellipsized

        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "chip-remove";
        removeBtn.title = t("remove");
        removeBtn.textContent = "×"; // multiplication sign as close icon
        removeBtn.addEventListener("click", function () {
          removeItem(value);
        });

        chip.appendChild(label);
        chip.appendChild(removeBtn);
        container.appendChild(chip);
      });
    }

    return { display: display };
  }

  var companyList = setupListManager({
    inputId: "companyInput",
    listId: "companiesList",
    storageKey: "blacklistedCompanies",
    emptyText: t("noCompanies"),
  });

  var keywordList = setupListManager({
    inputId: "keywordInput",
    listId: "keywordsList",
    storageKey: "blacklistedKeywords",
    emptyText: t("noKeywords"),
  });

  // Content scripts pick up changes via chrome.storage.onChanged in every
  // tab, so no explicit notification message is needed after a save.

  // --- Export / import settings ---
  document
    .getElementById("exportSettings")
    .addEventListener("click", function () {
      chrome.storage.sync.get(null, function (all) {
        if (chrome.runtime.lastError) {
          showSaveError(chrome.runtime.lastError.message);
          return;
        }
        var result = store.assembleSettings(all);
        var exported = {
          app: "linkedin-job-filter",
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          settings: {
            extensionEnabled: result.extensionEnabled !== false,
            hideApplied: !!result.hideApplied,
            hideViewed: !!result.hideViewed,
            hidePromoted: !!result.hidePromoted,
            hideEasyApply: !!result.hideEasyApply,
            hideCompanies: !!result.hideCompanies,
            hideKeywords: !!result.hideKeywords,
            blacklistedCompanies: result.blacklistedCompanies,
            blacklistedKeywords: result.blacklistedKeywords,
          },
        };
        var blob = new Blob([JSON.stringify(exported, null, 2)], {
          type: "application/json",
        });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download =
          "linkedin-job-filter-settings-" +
          new Date().toISOString().slice(0, 10) +
          ".json";
        link.click();
        setTimeout(function () {
          URL.revokeObjectURL(link.href);
        }, 0);
      });
    });

  document
    .getElementById("importSettings")
    .addEventListener("click", function () {
      importFile.click();
    });

  importFile.addEventListener("change", function () {
    var file = importFile.files && importFile.files[0];
    if (!file) return;
    file.text().then(function (text) {
      var raw;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = null;
      }
      if (
        !raw ||
        typeof raw !== "object" ||
        raw.app !== "linkedin-job-filter" ||
        !raw.settings ||
        typeof raw.settings !== "object"
      ) {
        showStatusError(t("importInvalid"));
        importFile.value = "";
        return;
      }
      var clean = store.sanitizeSettings(raw.settings);
      if (!confirm(t("importConfirm"))) {
        importFile.value = "";
        return;
      }
      chrome.storage.sync.get(null, function (all) {
        var w = store.buildSettingsWrite(all, clean);
        chrome.storage.sync.set(w.set, function () {
          if (w.remove.length) chrome.storage.sync.remove(w.remove);
          importFile.value = "";
          if (chrome.runtime.lastError) {
            showSaveError(chrome.runtime.lastError.message);
            return;
          }
          importDoneShown = true;
          applyLoadedSettings(clean);
        });
      });
    });
  });

  // --- Review ask ---
  // Shown once the content script's lifetime hidden-jobs counter
  // (chrome.storage.local, approximate) crosses the threshold, unless the
  // user already dismissed it. Dismissal lives in storage.sync so the ask
  // never comes back on another computer. Clicking the rate link counts as
  // acting on it and dismisses too.
  var REVIEW_ASK_THRESHOLD = 50;

  (function initReviewAsk() {
    var box = document.getElementById("reviewAsk");

    chrome.storage.sync.get(["reviewAskDismissed"], function (syncResult) {
      if (chrome.runtime.lastError || syncResult.reviewAskDismissed) return;

      chrome.storage.local.get(["totalHiddenJobs"], function (localResult) {
        if (chrome.runtime.lastError) return;
        var count = localResult.totalHiddenJobs || 0;
        if (count < REVIEW_ASK_THRESHOLD) return;
        document.getElementById("reviewAskText").textContent = t(
          "reviewAskText",
          count.toLocaleString(),
        );
        box.classList.add("visible");
      });
    });

    function dismissForever() {
      box.classList.remove("visible");
      // Best effort: if the write fails the ask simply reappears next time
      chrome.storage.sync.set({ reviewAskDismissed: true }, function () {
        void chrome.runtime.lastError;
      });
    }

    document
      .getElementById("reviewAskDismiss")
      .addEventListener("click", dismissForever);
    document
      .getElementById("reviewAskLink")
      .addEventListener("click", dismissForever);
  })();

  function showStatusError(message) {
    lastError = message;
    var status = document.getElementById("status");
    status.textContent = message;
    status.classList.remove("active");
    status.classList.add("error");
  }

  function showSaveError(message) {
    showStatusError(t("saveError", message || "unknown error"));
  }

  function updateStatus() {
    var status = document.getElementById("status");
    status.classList.remove("error");
    lastError = null;
    var wasImportDone = importDoneShown;
    importDoneShown = false;

    if (wasImportDone) {
      status.textContent = t("importDone");
      status.classList.add("active");
    } else if (!masterToggle.classList.contains("active")) {
      status.textContent = t("statusDisabled");
      status.classList.remove("active");
    } else {
      var activeFilters = TOGGLE_IDS.filter(function (id) {
        return document.getElementById(id).classList.contains("active");
      }).map(function (id) {
        return FILTER_LABELS[id];
      });

      if (activeFilters.length === 0) {
        status.textContent = t("statusAllVisible");
        status.classList.remove("active");
      } else {
        status.textContent = t("statusHiding", activeFilters.join(", "));
        status.classList.add("active");
      }
    }
  }
});
