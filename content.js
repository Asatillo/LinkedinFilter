// LinkedIn Job Filter Content Script
(function () {
  "use strict";

  let settings = {
    hideApplied: false,
    hideViewed: false,
    hideCompanies: false,
    hidePromoted: false,
    blacklistedCompanies: [],
  };

  // Load settings from storage
  function loadSettings() {
    chrome.storage.sync.get(
      [
        "hideApplied",
        "hideViewed",
        "hideCompanies",
        "hidePromoted",
        "blacklistedCompanies",
      ],
      function (result) {
        settings.hideApplied = result.hideApplied || false;
        settings.hideViewed = result.hideViewed || false;
        settings.hideCompanies = result.hideCompanies || false;
        settings.hidePromoted = result.hidePromoted || false;
        settings.blacklistedCompanies = result.blacklistedCompanies || [];
        filterJobs();
      }
    );
  }

  // Helper function to find company name in job card
  function getCompanyName(jobCard) {
    // Try multiple selectors to find company name
    const selectors = [
      ".artdeco-entity-lockup__subtitle span",
      ".artdeco-entity-lockup__subtitle",
      ".job-card-container__primary-description",
      ".job-card-container__company-name",
      ".job-card-container__link-subtitle",
      ".job-card-container .job-card-container__company-name",
      ".base-search-card__subtitle a",
      ".base-search-card__subtitle span",
      ".base-search-card__subtitle",
      ".job-card-list__company-name",
      "[data-test-job-company-name]",
    ];

    for (const selector of selectors) {
      const element = jobCard.querySelector(selector);
      if (element && element.textContent && element.textContent.trim()) {
        return element.textContent.trim();
      }
    }

    // Fallback: look for any element that might contain company info
    const allSpans = jobCard.querySelectorAll("span, a");
    for (const span of allSpans) {
      const text = span.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        // Check if this might be a company name by looking at parent classes
        const parent = span.closest(
          ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .base-search-card__subtitle"
        );
        if (parent) {
          return text;
        }
      }
    }

    return null;
  }

  // Filter job listings based on settings
  function filterJobs() {
    // Find all job cards using multiple possible selectors
    const jobCards = document.querySelectorAll(
      "li[data-occludable-job-id], .job-card-container, .base-search-card, .job-card-list__item"
    );

    console.log(`Found ${jobCards.length} job cards to filter`);

    jobCards.forEach((jobCard, index) => {
      const footerItems = jobCard.querySelectorAll(
        ".job-card-container__footer-item, .job-card-container__footer .artdeco-inline-feedback"
      );
      let shouldHide = false;
      let hideReason = "";

      // Check status-based hiding (Applied/Viewed/Promoted)
      footerItems.forEach((item) => {
        const text = item.textContent.trim();

        if (settings.hideApplied && text === "Applied") {
          shouldHide = true;
          hideReason = "Applied";
        }
        if (settings.hideViewed && text === "Viewed") {
          shouldHide = true;
          hideReason = "Viewed";
        }
        if (settings.hidePromoted && text === "Promoted") {
          shouldHide = true;
          hideReason = "Promoted";
        }
      });

      // Check company-based hiding
      if (settings.hideCompanies && settings.blacklistedCompanies.length > 0) {
        const companyName = getCompanyName(jobCard);

        if (companyName) {
          console.log(`Job ${index + 1}: Company found - "${companyName}"`);

          // Case-insensitive comparison with exact matching and partial matching
          const isBlacklisted = settings.blacklistedCompanies.some(
            (blacklistedCompany) => {
              const companyLower = companyName.toLowerCase();
              const blacklistedLower = blacklistedCompany.toLowerCase().trim();

              // Exact match or contains (both ways)
              return (
                companyLower === blacklistedLower ||
                companyLower.includes(blacklistedLower) ||
                blacklistedLower.includes(companyLower)
              );
            }
          );

          if (isBlacklisted) {
            shouldHide = true;
            hideReason = `Blacklisted company: ${companyName}`;
            console.log(`Hiding job from blacklisted company: ${companyName}`);
          }
        } else {
          console.log(`Job ${index + 1}: No company name found`);
        }
      }

      if (shouldHide) {
        jobCard.style.display = "none";
        jobCard.setAttribute("data-linkedin-filter-hidden", "true");
        jobCard.setAttribute("data-linkedin-filter-reason", hideReason);
        jobCard.setAttribute("data-linkedin-filter-processed", "true");
        console.log(`Hidden job ${index + 1}: ${hideReason}`);
      } else {
        jobCard.style.display = "";
        jobCard.removeAttribute("data-linkedin-filter-hidden");
        jobCard.removeAttribute("data-linkedin-filter-reason");
        jobCard.setAttribute("data-linkedin-filter-processed", "true");
      }
    });

    // Update counter if it exists
    updateJobCounter();
  }

  // Update job counter display
  function updateJobCounter() {
    // Only count job cards that are actual job listings
    const totalJobs = document.querySelectorAll(
      "li[data-occludable-job-id]"
    ).length;
    const hiddenJobs = document.querySelectorAll(
      'li[data-occludable-job-id][data-linkedin-filter-hidden="true"]'
    ).length;
    const visibleJobs = totalJobs - hiddenJobs;

    console.log(
      `Job counter: ${visibleJobs} visible, ${hiddenJobs} hidden, ${totalJobs} total`
    );

    // Try to find and update LinkedIn's job counter with more specific selectors
    const counters = document.querySelectorAll(
      ".jobs-search-results-list__subtitle, .jobs-search-results__subtitle, .jobs-search-two-pane__header-description, .jobs-search-results-list__text, .jobs-search-results__text"
    );

    counters.forEach((counter) => {
      const text = counter.textContent;
      // Look for text that contains numbers and "result" (in various languages)
      if (
        text &&
        (text.includes("result") ||
          text.includes("jobs") ||
          /\d+.*\d*/.test(text))
      ) {
        const originalText = counter.getAttribute("data-original-text") || text;
        if (!counter.getAttribute("data-original-text")) {
          counter.setAttribute("data-original-text", originalText);
        }

        if (hiddenJobs > 0 && totalJobs > 0) {
          // Extract the original number format if possible
          const numberMatch = originalText.match(/(\d[\d,]*)/);
          if (numberMatch) {
            const originalNumber = numberMatch[1];
            const newText = originalText.replace(
              originalNumber,
              visibleJobs.toLocaleString()
            );
            counter.textContent = `${newText} (${hiddenJobs} hidden by filter)`;
          } else {
            counter.textContent = `${visibleJobs.toLocaleString()} results (${hiddenJobs} hidden by filter)`;
          }
        } else if (totalJobs > 0) {
          counter.textContent = originalText;
        }

        console.log(`Updated counter: "${counter.textContent}"`);
      }
    });
  }

  // Observe DOM changes to handle dynamically loaded content
  function setupObserver() {
    const observer = new MutationObserver(function (mutations) {
      let shouldFilter = false;

      mutations.forEach(function (mutation) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach(function (node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if new job cards were added
              if (
                node.matches &&
                (node.matches("li[data-occludable-job-id]") ||
                  node.matches(".job-card-container") ||
                  node.matches(".base-search-card") ||
                  node.matches(".job-card-list__item"))
              ) {
                shouldFilter = true;
              } else if (
                node.querySelector &&
                (node.querySelector("li[data-occludable-job-id]") ||
                  node.querySelector(".job-card-container") ||
                  node.querySelector(".base-search-card") ||
                  node.querySelector(".job-card-list__item"))
              ) {
                shouldFilter = true;
              }
            }
          });
        }
      });

      if (shouldFilter) {
        // Debounce the filtering to avoid excessive calls
        clearTimeout(window.linkedinFilterTimeout);
        window.linkedinFilterTimeout = setTimeout(() => {
          console.log("DOM changed, re-filtering jobs...");
          filterJobs();
        }, 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return observer;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(function (
    request,
    sender,
    sendResponse
  ) {
    if (request.action === "updateFilters") {
      console.log("Received updateFilters message, reloading settings...");
      loadSettings();
    }
  });

  // Debug function to test company detection
  function debugCompanyDetection() {
    const jobCards = document.querySelectorAll(
      "li[data-occludable-job-id], .job-card-container, .base-search-card, .job-card-list__item"
    );
    console.log("=== DEBUG: Company Detection ===");
    jobCards.forEach((card, index) => {
      const company = getCompanyName(card);
      console.log(`Job ${index + 1}: ${company || "NO COMPANY FOUND"}`);
    });
    console.log("=== END DEBUG ===");
  }

  // Make debug function available globally for testing
  window.debugLinkedInFilter = debugCompanyDetection;

  // Add CSS to hide jobs initially
  function addFilterCSS() {
    if (document.getElementById("linkedin-filter-css")) return;

    const style = document.createElement("style");
    style.id = "linkedin-filter-css";
    style.textContent = `
      /* Hide job cards initially while filtering */
      li[data-occludable-job-id]:not([data-linkedin-filter-processed]),
      .job-card-container:not([data-linkedin-filter-processed]),
      .base-search-card:not([data-linkedin-filter-processed]),
      .job-card-list__item:not([data-linkedin-filter-processed]) {
        opacity: 0 !important;
        transition: opacity 0.2s ease-in-out !important;
      }
      
      /* Show processed jobs */
      li[data-occludable-job-id][data-linkedin-filter-processed],
      .job-card-container[data-linkedin-filter-processed],
      .base-search-card[data-linkedin-filter-processed],
      .job-card-list__item[data-linkedin-filter-processed] {
        opacity: 1 !important;
      }
      
      /* Keep hidden jobs invisible */
      [data-linkedin-filter-hidden="true"] {
        display: none !important;
        opacity: 0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Initialize
  function init() {
    console.log("Initializing LinkedIn Job Filter...");
    addFilterCSS();
    loadSettings();
    setupObserver();

    // Also filter when page visibility changes (user switches tabs and comes back)
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        setTimeout(filterJobs, 500);
      }
    });

    // Filter on scroll (in case LinkedIn lazy loads content)
    let scrollTimeout;
    window.addEventListener("scroll", function () {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(filterJobs, 500);
    });
  }

  // Wait for page to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Re-run when navigating within LinkedIn (SPA behavior)
  let currentUrl = location.href;
  new MutationObserver(function () {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      if (location.href.includes("/jobs")) {
        console.log("URL changed to jobs page, reinitializing...");
        setTimeout(init, 1000); // Give LinkedIn time to load the new page
      }
    }
  }).observe(document, { subtree: true, childList: true });
})();
