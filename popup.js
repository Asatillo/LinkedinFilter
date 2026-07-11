// LinkedIn Job Filter Popup Script
document.addEventListener("DOMContentLoaded", function () {
  // --- Constants ---
  var TOGGLE_IDS = [
    "hideApplied",
    "hideViewed",
    "hidePromoted",
    "hideCompanies",
    "hideKeywords",
  ];
  var STORAGE_KEYS = TOGGLE_IDS.concat([
    "blacklistedCompanies",
    "blacklistedKeywords",
    "extensionEnabled",
  ]);

  var masterToggle = document.getElementById("extensionEnabled");

  // --- Load saved settings ---
  chrome.storage.sync.get(STORAGE_KEYS, function (result) {
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
  });

  // --- Master switch ---
  function setDisabledUI(off) {
    document.body.classList.toggle("extension-off", off);
    document.getElementById("switchState").textContent = off ? "OFF" : "ON";
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

    function persist(items) {
      var update = {};
      update[opts.storageKey] = items;
      chrome.storage.sync.set(update, function () {
        if (chrome.runtime.lastError) {
          // Most likely the 8KB-per-item sync quota — surface it
          showSaveError(chrome.runtime.lastError.message);
          return;
        }
        display(items);
        updateStatus();
      });
    }

    function addItem(value) {
      chrome.storage.sync.get([opts.storageKey], function (result) {
        var items = result[opts.storageKey] || [];

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
      chrome.storage.sync.get([opts.storageKey], function (result) {
        var items = (result[opts.storageKey] || []).filter(function (item) {
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
        removeBtn.title = "Remove";
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
    emptyText: "No companies blacklisted",
  });

  var keywordList = setupListManager({
    inputId: "keywordInput",
    listId: "keywordsList",
    storageKey: "blacklistedKeywords",
    emptyText: "No keywords added",
  });

  // Content scripts pick up changes via chrome.storage.onChanged in every
  // tab, so no explicit notification message is needed after a save.

  function showSaveError(message) {
    var status = document.getElementById("status");
    status.textContent = "Couldn't save settings: " + (message || "unknown error");
    status.classList.remove("active");
    status.classList.add("error");
  }

  function updateStatus() {
    var status = document.getElementById("status");
    status.classList.remove("error");

    if (!masterToggle.classList.contains("active")) {
      status.textContent = "Extension disabled — all jobs visible";
      status.classList.remove("active");
      return;
    }

    var activeFilters = TOGGLE_IDS.filter(function (id) {
      return document.getElementById(id).classList.contains("active");
    }).map(function (id) {
      return id.replace("hide", "").toLowerCase();
    });

    if (activeFilters.length === 0) {
      status.textContent = "All jobs visible";
      status.classList.remove("active");
    } else {
      status.textContent = "Hiding " + activeFilters.join(", ") + " jobs";
      status.classList.add("active");
    }
  }
});
