const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeSettings,
  splitList,
  assembleList,
  buildListWrite,
  assembleSettings,
  buildSettingsWrite,
  CHUNK_BUDGET_BYTES,
} = require("../settings-store.js");

test("sanitize: garbage input yields safe defaults", () => {
  const clean = sanitizeSettings({});
  assert.equal(clean.extensionEnabled, true);
  [
    "hideApplied",
    "hideViewed",
    "hidePromoted",
    "hideEasyApply",
    "hideCompanies",
    "hideKeywords",
  ].forEach((k) => assert.equal(clean[k], false));
  assert.deepEqual(clean.blacklistedCompanies, []);
  assert.deepEqual(clean.blacklistedKeywords, []);
  // Non-object inputs
  assert.equal(sanitizeSettings(null).extensionEnabled, true);
  assert.equal(sanitizeSettings("x").blacklistedCompanies.length, 0);
});

test("sanitize: lists dedupe case-insensitively, trim, drop empties and non-strings, cap at 100 chars", () => {
  const clean = sanitizeSettings({
    blacklistedCompanies: [
      "  Acme  ",
      "acme",
      "ACME",
      "",
      "   ",
      42,
      null,
      "x".repeat(150),
      "Beta",
    ],
    blacklistedKeywords: "not-an-array",
  });
  assert.deepEqual(clean.blacklistedCompanies, [
    "Acme",
    "x".repeat(100),
    "Beta",
  ]);
  assert.deepEqual(clean.blacklistedKeywords, []);
});

test("sanitize: explicit extensionEnabled false is preserved", () => {
  assert.equal(
    sanitizeSettings({ extensionEnabled: false }).extensionEnabled,
    false,
  );
  assert.equal(
    sanitizeSettings({ extensionEnabled: 0 }).extensionEnabled,
    false,
  );
  assert.equal(
    sanitizeSettings({ extensionEnabled: "no" }).extensionEnabled,
    true,
  );
});

test("sanitize: unknown keys are dropped", () => {
  const clean = sanitizeSettings({
    hideApplied: 1,
    evil: "payload",
    blacklistedCompanies: ["a"],
  });
  assert.equal(clean.hideApplied, true);
  assert.ok(!("evil" in clean));
  assert.deepEqual(
    Object.keys(clean).sort(),
    [
      "blacklistedCompanies",
      "blacklistedKeywords",
      "extensionEnabled",
      "hideApplied",
      "hideCompanies",
      "hideEasyApply",
      "hideKeywords",
      "hidePromoted",
      "hideViewed",
    ],
  );
});

// --- Chunked list storage ---

test("splitList: empty -> [[]]; small list -> single chunk", () => {
  assert.deepEqual(splitList([]), [[]]);
  const small = ["a", "b"];
  assert.deepEqual(splitList(small), [["a", "b"]]);
});

test("splitList: every chunk stays within the byte budget and order is preserved", () => {
  const items = [];
  for (let i = 0; i < 400; i++) {
    items.push("company-" + String(i).padStart(53, "x")); // 60 chars each
  }
  const chunks = splitList(items);
  assert.ok(chunks.length > 1);
  chunks.forEach((chunk) => {
    assert.ok(
      new TextEncoder().encode(JSON.stringify(chunk)).length <=
        CHUNK_BUDGET_BYTES,
    );
  });
  assert.deepEqual(chunks.flat(), items);
});

test("assembleList: concatenates base + _N in numeric order, skips garbage, dedupes case-insensitively", () => {
  const all = {
    blacklistedCompanies: ["A", "b"],
    blacklistedCompanies_2: ["c"],
    blacklistedCompanies_10: ["z"],
    blacklistedCompanies_1: ["B", "x"],
    blacklistedCompanies_x: ["no"],
    blacklistedCompaniesFoo: ["no"],
    blacklistedKeywords: ["k"],
  };
  // _10 sorts after _2 numerically; "B" drops as a dupe of "b"
  assert.deepEqual(assembleList(all, "blacklistedCompanies"), [
    "A",
    "b",
    "x",
    "c",
    "z",
  ]);
});

test("buildListWrite: removes stale higher chunks", () => {
  const all = {
    blacklistedCompanies: ["a"],
    blacklistedCompanies_1: ["b"],
    blacklistedCompanies_2: ["c"],
  };
  const w = buildListWrite(all, "blacklistedCompanies", ["d"]);
  assert.deepEqual(w.set, { blacklistedCompanies: ["d"] });
  assert.deepEqual(w.remove, [
    "blacklistedCompanies_1",
    "blacklistedCompanies_2",
  ]);
});

test("round trip: buildListWrite output assembled back equals the input", () => {
  const items = [];
  for (let i = 0; i < 400; i++) {
    items.push("company-" + String(i).padStart(53, "x"));
  }
  const w = buildListWrite({}, "blacklistedCompanies", items);
  const stored = { ...w.set };
  w.remove.forEach((k) => delete stored[k]);
  assert.deepEqual(
    assembleList(stored, "blacklistedCompanies"),
    items,
  );
});

test("assembleSettings/buildSettingsWrite round trip", () => {
  const clean = sanitizeSettings({
    extensionEnabled: false,
    hideApplied: true,
    blacklistedCompanies: ["Acme", "Beta"],
    blacklistedKeywords: ["java"],
  });
  const w = buildSettingsWrite({}, clean);
  const stored = { ...w.set };
  w.remove.forEach((k) => delete stored[k]);
  const back = assembleSettings(stored);
  assert.equal(back.extensionEnabled, false);
  assert.equal(back.hideApplied, true);
  assert.equal(back.hideViewed, false);
  assert.deepEqual(back.blacklistedCompanies, ["Acme", "Beta"]);
  assert.deepEqual(back.blacklistedKeywords, ["java"]);
});
