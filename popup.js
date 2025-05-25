// LinkedIn Job Filter Popup Script
document.addEventListener("DOMContentLoaded", function () {
  // Load saved settings
  chrome.storage.sync.get(
    [
      "hideApplied",
      "hideViewed",
      "hidePromoted",
      "hideCompanies",
      "blacklistedCompanies",
    ],
    function (result) {
      const hideAppliedToggle = document.getElementById("hideApplied");
      const hideViewedToggle = document.getElementById("hideViewed");
      const hideCompaniesToggle = document.getElementById("hideCompanies");
      const hidePromotedToggle = document.getElementById("hidePromoted");

      if (result.hideApplied) {
        hideAppliedToggle.classList.add("active");
      }
      if (result.hideViewed) {
        hideViewedToggle.classList.add("active");
      }
      if (result.hidePromoted) {
        hidePromotedToggle.classList.add("active");
      }
      if (result.hideCompanies) {
        hideCompaniesToggle.classList.add("active");
      }

      // Load blacklisted companies
      const companies = result.blacklistedCompanies || [];
      displayCompanies(companies);

      updateStatus();
    }
  );

  // Toggle handlers
  document.getElementById("hideApplied").addEventListener("click", function () {
    this.classList.toggle("active");
    const isActive = this.classList.contains("active");

    chrome.storage.sync.set({ hideApplied: isActive });
    sendMessageToContentScript();
    updateStatus();
  });

  document.getElementById("hideViewed").addEventListener("click", function () {
    this.classList.toggle("active");
    const isActive = this.classList.contains("active");

    chrome.storage.sync.set({ hideViewed: isActive });
    sendMessageToContentScript();
    updateStatus();
  });

  document
    .getElementById("hidePromoted")
    .addEventListener("click", function () {
      this.classList.toggle("active");
      const isActive = this.classList.contains("active");
      chrome.storage.sync.set({ hidePromoted: isActive });
      sendMessageToContentScript();
      updateStatus();
    });

  document
    .getElementById("hideCompanies")
    .addEventListener("click", function () {
      this.classList.toggle("active");
      const isActive = this.classList.contains("active");

      chrome.storage.sync.set({ hideCompanies: isActive });
      sendMessageToContentScript();
      updateStatus();
    });

  // Company management
  document
    .getElementById("addCompanyBtn")
    .addEventListener("click", function () {
      const form = document.getElementById("addCompanyForm");
      const input = document.getElementById("companyInput");

      form.style.display = "block";
      input.focus();
      this.style.display = "none";
    });

  document
    .getElementById("cancelCompanyBtn")
    .addEventListener("click", function () {
      hideAddForm();
    });

  document
    .getElementById("saveCompanyBtn")
    .addEventListener("click", function () {
      const input = document.getElementById("companyInput");
      const companyName = input.value.trim();

      if (companyName) {
        addCompany(companyName);
        input.value = "";
        hideAddForm();
      }
    });

  document
    .getElementById("companyInput")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        document.getElementById("saveCompanyBtn").click();
      } else if (e.key === "Escape") {
        document.getElementById("cancelCompanyBtn").click();
      }
    });

  function hideAddForm() {
    document.getElementById("addCompanyForm").style.display = "none";
    document.getElementById("addCompanyBtn").style.display = "block";
    document.getElementById("companyInput").value = "";
  }

  function addCompany(companyName) {
    chrome.storage.sync.get(["blacklistedCompanies"], function (result) {
      const companies = result.blacklistedCompanies || [];

      // Avoid duplicates (case insensitive)
      const exists = companies.some(
        (company) => company.toLowerCase() === companyName.toLowerCase()
      );

      if (!exists) {
        companies.push(companyName);
        chrome.storage.sync.set(
          { blacklistedCompanies: companies },
          function () {
            displayCompanies(companies);
            sendMessageToContentScript();
            updateStatus();
          }
        );
      }
    });
  }

  function removeCompany(companyName) {
    chrome.storage.sync.get(["blacklistedCompanies"], function (result) {
      const companies = result.blacklistedCompanies || [];
      const updatedCompanies = companies.filter(
        (company) => company !== companyName
      );

      chrome.storage.sync.set(
        { blacklistedCompanies: updatedCompanies },
        function () {
          displayCompanies(updatedCompanies);
          sendMessageToContentScript();
          updateStatus();
        }
      );
    });
  }

  function displayCompanies(companies) {
    const container = document.getElementById("companiesList");

    if (companies.length === 0) {
      container.innerHTML =
        '<div class="empty-state">No companies blacklisted</div>';
      return;
    }

    container.innerHTML = companies
      .map(
        (company) => `
      <div class="company-item">
        <span class="company-name">${escapeHtml(company)}</span>
        <button class="remove-btn" data-company="${escapeHtml(
          company
        )}">×</button>
      </div>
    `
      )
      .join("");

    // Add event listeners to remove buttons
    container.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const companyName = this.getAttribute("data-company");
        removeCompany(companyName);
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function sendMessageToContentScript() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && tabs[0].url.includes("linkedin.com/jobs")) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "updateFilters" });
      }
    });
  }

  function updateStatus() {
    const status = document.getElementById("status");
    const hideApplied = document
      .getElementById("hideApplied")
      .classList.contains("active");
    const hideViewed = document
      .getElementById("hideViewed")
      .classList.contains("active");
    const hidePromoted = document
      .getElementById("hidePromoted")
      .classList.contains("active");
    const hideCompanies = document
      .getElementById("hideCompanies")
      .classList.contains("active");

    let activeFilters = [];
    if (hideApplied) activeFilters.push("applied");
    if (hideViewed) activeFilters.push("viewed");
    if (hideCompanies) activeFilters.push("companies");
    if (hidePromoted) activeFilters.push("promoted");

    if (activeFilters.length === 0) {
      status.textContent = "All jobs visible";
      status.classList.remove("active");
    } else {
      status.textContent = `Hiding ${activeFilters.join(", ")} jobs`;
      status.classList.add("active");
    }
  }
});
