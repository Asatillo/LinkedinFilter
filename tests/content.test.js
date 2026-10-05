const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadContentScript } = require("./helpers");

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function load(name, opts) {
  const env = loadContentScript(fixture(name), opts);
  test.after(() => {
    try {
      env.dom.window.close();
    } catch {}
  });
  return env;
}

const isHidden = (el) =>
  el.getAttribute("data-linkedin-filter-hidden") === "true";
const reason = (el) => el.getAttribute("data-linkedin-filter-reason") || "";

function sduiCards(document) {
  return [
    ...document.querySelectorAll(
      'div[role="button"][componentkey^="job-card-component-ref-"]',
    ),
  ];
}

function homeCards(document) {
  return [
    ...document.querySelectorAll(
      'a[componentkey][href*="/jobs/search-results/"][href*="currentJobId="]',
    ),
  ];
}

// --- SDUI /jobs/search-results ---

test("sdui: extracts title from dismiss aria-label and company from second <p>", () => {
  const { document, api } = load("sdui-search.html");
  const card = sduiCards(document)[0];
  assert.equal(api.getJobTitle(card), "Senior Backend Engineer (.NET)");
  assert.equal(api.getCompanyName(card), "LastPass");
});

test("sdui: status texts exclude title and company", () => {
  const { document, api } = load("sdui-search.html");
  const cards = sduiCards(document);
  const texts4 = api.getStatusTexts(cards[3]);
  assert.ok(!texts4.some((t) => t.includes("Applied Materials")));
  assert.ok(!texts4.some((t) => t.includes("Data Engineer")));
  const texts1 = api.getStatusTexts(cards[0]);
  assert.ok(texts1.includes("Viewed"));
  assert.ok(texts1.includes("Easy Apply"));
  assert.ok(texts1.includes("Promoted"));
});

test("sdui: Easy Apply filter hides only Easy Apply cards and records the reason", () => {
  const { document, api } = load("sdui-search.html");
  api._setSettings({ enabled: true, hideEasyApply: true });
  api.filterJobs();
  const cards = sduiCards(document);
  const wrap = (c) => c.parentElement;
  assert.ok(isHidden(wrap(cards[0])));
  assert.ok(reason(wrap(cards[0])).includes("Easy Apply"));
  assert.ok(isHidden(wrap(cards[1])));
  assert.ok(reason(wrap(cards[1])).includes("Easy Apply"));
  [2, 3, 4, 5].forEach((i) => assert.ok(!isHidden(wrap(cards[i]))));
  const hr = wrap(cards[0]).nextElementSibling;
  assert.equal(hr.tagName, "HR");
  assert.equal(hr.getAttribute("data-linkedin-filter-hidden-hr"), "true");
});

test("sdui: 'Applied Scientist' title and 'Applied Materials' company do not trigger the Applied filter", () => {
  const { document, api } = load("sdui-search.html");
  api._setSettings({ enabled: true, hideApplied: true });
  api.filterJobs();
  const cards = sduiCards(document);
  assert.ok(!isHidden(cards[2].parentElement));
  assert.ok(!isHidden(cards[3].parentElement));
  assert.ok(isHidden(cards[4].parentElement));
});

test("sdui: 'Chula Vista' location does not trigger Viewed", () => {
  const { document, api } = load("sdui-search.html");
  api._setSettings({ enabled: true, hideViewed: true });
  api.filterJobs();
  const cards = sduiCards(document);
  assert.ok(!isHidden(cards[3].parentElement));
  assert.ok(isHidden(cards[0].parentElement));
});

test("sdui: hide target is the lazy-column child wrapper, not the role=button card", () => {
  const { document, api } = load("sdui-search.html");
  const card = sduiCards(document)[0];
  assert.equal(api.getHideTarget(card), card.parentElement);
});

test("sdui: banner shows hidden count and clears when filters turn off", () => {
  const { document, api } = load("sdui-search.html");
  api._setSettings({ enabled: true, hideEasyApply: true });
  api.filterJobs();
  const banner = document.querySelector(
    ".linkedin-filter-hidden-count--banner",
  );
  assert.ok(banner);
  assert.equal(banner.textContent, "2 jobs hidden by filter");
  api._setSettings({ hideEasyApply: false });
  api.filterJobs();
  assert.ok(
    !document.querySelector(".linkedin-filter-hidden-count--banner"),
  );
  assert.ok(
    !document.querySelector('[data-linkedin-filter-hidden="true"]'),
  );
});

// --- Keywords ---

test("keywords: whole-word by default, * relaxes", () => {
  const { api } = load("sdui-search.html");
  const { termToRegex } = api;
  assert.equal(termToRegex("java").test("JavaScript Developer"), false);
  assert.equal(termToRegex("java").test("Java Developer"), true);
  assert.equal(termToRegex("java").test("Senior Java/Scala Developer"), true);
  assert.equal(termToRegex("java*").test("JavaScript Developer"), true);
  assert.equal(termToRegex("c++").test("C++ Developer"), true);
  assert.equal(termToRegex("ai").test("Maintenance Engineer"), false);
  assert.equal(termToRegex("ai").test("AI Engineer"), true);
  assert.equal(termToRegex("*"), null);
  assert.equal(termToRegex(".net").test("Backend (.NET) Engineer"), true);
});

test("keywords: filterJobs hides matching titles only", () => {
  const { document, api } = load("sdui-search.html");
  api._setSettings({
    enabled: true,
    hideKeywords: true,
    blacklistedKeywords: ["java"],
  });
  api.filterJobs();
  const cards = sduiCards(document);
  assert.ok(isHidden(cards[4].parentElement));
  assert.ok(reason(cards[4].parentElement).includes("Keyword: java"));
  assert.ok(!isHidden(cards[5].parentElement));
});

// --- Companies ---

test("companies: whole-word match, * relaxes", () => {
  const { document, api } = load("sdui-search.html");
  const cards = sduiCards(document);
  const wrap = (c) => c.parentElement;
  const set = (list) =>
    api._setSettings({
      enabled: true,
      hideCompanies: true,
      blacklistedCompanies: list,
    });

  set(["cast"]);
  api.filterJobs();
  assert.ok(isHidden(wrap(cards[1]))); // "Cast AI"

  set(["cap"]);
  api.filterJobs();
  assert.ok(!isHidden(wrap(cards[6]))); // "Capgemini" — not a whole word

  set(["cap*"]);
  api.filterJobs();
  assert.ok(isHidden(wrap(cards[6]))); // prefix match opts in

  set(["LastPass Enterprise"]);
  api.filterJobs();
  assert.ok(!isHidden(wrap(cards[0]))); // longer term ≠ shorter company

  set(["lastpass"]);
  api.filterJobs();
  assert.ok(isHidden(wrap(cards[0]))); // case-insensitive whole word
});

// --- Master switch ---

test("master switch off: nothing hidden and no blacklist buttons", () => {
  const { document, api } = load("sdui-search.html");
  api._setSettings({ enabled: false, hideEasyApply: true });
  api.filterJobs();
  assert.ok(!document.querySelector("[data-linkedin-filter-hidden]"));
  assert.ok(!document.querySelector(".linkedin-filter-blacklist-btn"));
  sduiCards(document).forEach((c) =>
    assert.equal(
      c.getAttribute("data-linkedin-filter-processed"),
      "true",
    ),
  );
});

// --- Home feed ---

test("home feed: hide target is the data-display-contents wrapper", () => {
  const { document, api } = load("home-feed.html");
  const cardB = homeCards(document)[1];
  assert.equal(api.getHideTarget(cardB), cardB.parentElement);
  assert.equal(
    cardB.parentElement.getAttribute("data-display-contents"),
    "true",
  );
});

test("home feed: dividers reconcile to exactly one between visible cards", () => {
  const { document, api } = load("home-feed.html");
  api._setSettings({ enabled: true, hidePromoted: true, hideViewed: true });
  api.filterJobs();

  const container = document.querySelector(
    '[data-testid="JobsHomeFeedModuleListCollection"]',
  );
  const isCardWrapper = (el) =>
    el && el.getAttribute("data-display-contents") === "true";
  const adjacentHrs = [...container.querySelectorAll("hr")].filter(
    (hr) =>
      isCardWrapper(hr.previousElementSibling) ||
      isCardWrapper(hr.nextElementSibling),
  );
  const visibleHrs = adjacentHrs.filter(
    (hr) => !hr.hasAttribute("data-linkedin-filter-hidden-hr"),
  );
  assert.equal(visibleHrs.length, 1);
  // The one visible divider sits between card A and card E
  const wrapperA = homeCards(document)[0].parentElement;
  assert.equal(visibleHrs[0].previousElementSibling, wrapperA);

  // Module-footer <hr> before "Show all" is untouched
  const showAll = container.querySelector('a[href*="keywords=x"]');
  const footerHr = showAll.previousElementSibling;
  assert.equal(footerHr.tagName, "HR");
  assert.ok(!footerHr.hasAttribute("data-linkedin-filter-hidden-hr"));

  api._setSettings({ hidePromoted: false, hideViewed: false });
  api.filterJobs();
  assert.ok(
    !container.querySelector("hr[data-linkedin-filter-hidden-hr]"),
  );
});

test("home feed: Easy Apply / status detection works on anchor cards", () => {
  const { document, api } = load("home-feed.html");
  const cardB = homeCards(document)[1];
  assert.ok(api.getStatusTexts(cardB).includes("Promoted"));
  assert.equal(api.getCompanyName(cardB), "Beta Ltd");
});

// --- Classic UI ---

test("classic: only the outer li is hidden and the inner container is still marked processed", () => {
  const { document, api } = load("classic.html");
  api._setSettings({ enabled: true, hidePromoted: true });
  api.filterJobs();
  const li1 = document.querySelector('li[data-occludable-job-id="1"]');
  const li2 = document.querySelector('li[data-occludable-job-id="2"]');
  assert.ok(isHidden(li1));
  const inner = li1.querySelector(".job-card-container");
  assert.ok(!isHidden(inner));
  assert.equal(
    inner.getAttribute("data-linkedin-filter-processed"),
    "true",
  );
  assert.ok(!isHidden(li2));
});

test("classic: exactly one hidden-count badge even with nested counter elements", () => {
  const { document, api } = load("classic.html");
  api._setSettings({ enabled: true, hidePromoted: true });
  api.filterJobs();
  const badges = document.querySelectorAll(
    ".linkedin-filter-hidden-count",
  );
  assert.equal(badges.length, 1);
  assert.ok(
    badges[0].parentElement.matches(
      ".jobs-search-results-list__subtitle",
    ),
  );
  assert.equal(badges[0].textContent, " (1 hidden by filter)");
});

test("classic: Easy Apply footer item is detected", () => {
  const { document, api } = load("classic.html");
  api._setSettings({ enabled: true, hideEasyApply: true });
  api.filterJobs();
  const li1 = document.querySelector('li[data-occludable-job-id="1"]');
  assert.ok(isHidden(li1));
  assert.ok(reason(li1).includes("Easy Apply"));
});

// --- Status labels safety ---

test("status labels: no entry can match a plain location string", () => {
  const { api } = load("sdui-search.html");
  const locations = [
    "Chula Vista, CA",
    "Vista, CA",
    "Budapest, Hungary (Hybrid)",
    "Remote",
    // "Promotion, Kansas" must also be false — "promoted" is not a
    // substring of "promotion".
    "Promotion, Kansas",
  ];
  for (const loc of locations) {
    const lower = loc.toLowerCase();
    for (const key of Object.keys(api.STATUS_LABELS)) {
      assert.equal(
        api.matchesStatus(lower, api.STATUS_LABELS[key]),
        false,
        `${key} label matched location "${loc}"`,
      );
    }
  }
});

test("settings loader assembles chunked company lists", () => {
  const { document, api } = load("sdui-search.html", {
    syncData: {
      hideCompanies: true,
      blacklistedCompanies: ["LastPass"],
      blacklistedCompanies_1: ["Cast AI"],
    },
  });
  api.loadSettings();
  const cards = sduiCards(document);
  [0, 1].forEach((i) => {
    const wrap = cards[i].parentElement;
    assert.ok(isHidden(wrap));
    assert.ok(reason(wrap).includes("Blacklisted:"));
  });
  [2, 3, 4, 5].forEach((i) =>
    assert.ok(!isHidden(cards[i].parentElement)),
  );
});
