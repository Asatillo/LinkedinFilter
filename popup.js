// LinkedIn Job Filter Popup Script
document.addEventListener("DOMContentLoaded", function () {
  // --- Constants ---
  var TOGGLE_IDS = ["hideApplied", "hideViewed", "hidePromoted", "hideCompanies"];
  var STORAGE_KEYS = TOGGLE_IDS.concat(["blacklistedCompanies", "extensionEnabled"]);

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

    displayCompanies(result.blacklistedCompanies || []);
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

  // --- Company management ---
  var addCompanyBtn = document.getElementById("addCompanyBtn");
  var addCompanyForm = document.getElementById("addCompanyForm");
  var companyInput = document.getElementById("companyInput");
  var saveCompanyBtn = document.getElementById("saveCompanyBtn");
  var cancelCompanyBtn = document.getElementById("cancelCompanyBtn");

  addCompanyBtn.addEventListener("click", function () {
    addCompanyForm.style.display = "block";
    companyInput.focus();
    this.style.display = "none";
  });

  cancelCompanyBtn.addEventListener("click", hideAddForm);

  saveCompanyBtn.addEventListener("click", function () {
    var companyName = companyInput.value.trim();
    if (companyName) {
      addCompany(companyName);
      hideAddForm();
    }
  });

  // keydown, not keypress — Escape never fires keypress in modern browsers
  companyInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      saveCompanyBtn.click();
    } else if (e.key === "Escape") {
      hideAddForm();
    }
  });

  function hideAddForm() {
    addCompanyForm.style.display = "none";
    addCompanyBtn.style.display = "block";
    companyInput.value = "";
  }

  function addCompany(companyName) {
    chrome.storage.sync.get(["blacklistedCompanies"], function (result) {
      var companies = result.blacklistedCompanies || [];

      // Avoid duplicates (case insensitive)
      var exists = companies.some(function (c) {
        return c.toLowerCase() === companyName.toLowerCase();
      });

      if (!exists) {
        companies.push(companyName);
        chrome.storage.sync.set({ blacklistedCompanies: companies }, function () {
          if (chrome.runtime.lastError) {
            // Most likely the 8KB-per-item sync quota — surface it
            showSaveError(chrome.runtime.lastError.message);
            return;
          }
          displayCompanies(companies);
          updateStatus();
        });
      }
    });
  }

  function removeCompany(companyName) {
    chrome.storage.sync.get(["blacklistedCompanies"], function (result) {
      var companies = result.blacklistedCompanies || [];
      var updated = companies.filter(function (c) {
        return c !== companyName;
      });

      chrome.storage.sync.set({ blacklistedCompanies: updated }, function () {
        if (chrome.runtime.lastError) {
          showSaveError(chrome.runtime.lastError.message);
          return;
        }
        displayCompanies(updated);
        updateStatus();
      });
    });
  }

  // Built programmatically with textContent/closures rather than innerHTML:
  // company names are user input and may contain &, <, ", etc.
  function displayCompanies(companies) {
    var container = document.getElementById("companiesList");

    if (companies.length === 0) {
      container.innerHTML = '<div class="empty-state">No companies blacklisted</div>';
      return;
    }

    container.innerHTML = "";

    companies.forEach(function (company) {
      var item = document.createElement("div");
      item.className = "company-item";

      var nameSpan = document.createElement("span");
      nameSpan.className = "company-name";
      nameSpan.textContent = company; // textContent is XSS-safe

      var removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "\u00d7"; // ×
      // Use closure to capture the raw company name — no data attributes needed
      removeBtn.addEventListener("click", function () {
        removeCompany(company);
      });

      item.appendChild(nameSpan);
      item.appendChild(removeBtn);
      container.appendChild(item);
    });
  }

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
