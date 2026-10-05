// Test helper: load settings-store.js + content.js into a jsdom VM
// context with a stubbed `chrome` API and a `module` object so the test
// hook at the bottom of content.js exposes the internal functions.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const storePath = path.join(__dirname, "..", "settings-store.js");
const contentPath = path.join(__dirname, "..", "content.js");

// The default url is a non-/jobs page on purpose so the script doesn't
// auto-init; tests call api._setSettings(...) then api.filterJobs()
// explicitly. `syncData` is the object handed back by chrome.storage
// .sync.get(null, cb) — used to simulate chunked stored lists.
function loadContentScript(
  html,
  { url = "https://www.linkedin.com/feed/", syncData = {} } = {},
) {
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const ctx = dom.getInternalVMContext();
  ctx.module = { exports: {} };
  ctx.chrome = {
    runtime: {
      id: "test",
      lastError: null,
      connect: () => ({ onDisconnect: { addListener() {} } }),
    },
    storage: {
      sync: {
        get: (k, cb) => cb(syncData),
        set: (v, cb) => cb && cb(),
        remove: (k, cb) => cb && cb(),
      },
      local: {
        get: (k, cb) => cb({}),
        set() {},
      },
      onChanged: { addListener() {} },
    },
  };
  // settings-store.js runs first so window.LinkedInFilterSettings exists
  // when content.js loads (same order as the manifest's content_scripts).
  vm.runInContext(fs.readFileSync(storePath, "utf8"), ctx, {
    filename: "settings-store.js",
  });
  vm.runInContext(fs.readFileSync(contentPath, "utf8"), ctx, {
    filename: "content.js",
  });
  return { dom, document: dom.window.document, api: ctx.module.exports };
}

module.exports = { loadContentScript };
