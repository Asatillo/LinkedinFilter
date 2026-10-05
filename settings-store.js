// Shared settings store: sanitisation for import plus chunked list
// storage for chrome.storage.sync. Pure — no DOM, no chrome API — so the
// node test suite can require() it directly, while popup.js and
// content.js use the window global (it's loaded as the first content
// script, ahead of content.js, in the same isolated world).
//
// Chunked storage layout: the 8KB-per-item sync quota would cap a
// blacklist at ~80 entries, so each list is split across sibling keys:
// the base key holds chunk 0, overflow goes to <base>_1, <base>_2, …
// Readers MUST go through assembleList/assembleSettings — never read the
// raw list keys directly.
(function () {
  "use strict";

  var BOOL_KEYS = [
    "extensionEnabled",
    "hideApplied",
    "hideViewed",
    "hidePromoted",
    "hideEasyApply",
    "hideCompanies",
    "hideKeywords",
  ];
  var LIST_KEYS = ["blacklistedCompanies", "blacklistedKeywords"];
  var MAX_ENTRY_LENGTH = 100;
  var MAX_LIST_LENGTH = 500;
  // Chrome's per-item limit is 8192 bytes including the key name; keep a
  // margin so a chunk can never overflow it.
  var CHUNK_BUDGET_BYTES = 7000;

  function chunkKey(baseKey, i) {
    return i === 0 ? baseKey : baseKey + "_" + i;
  }

  function byteSize(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  // Greedy fill: an item joins the current chunk only if the encoded
  // chunk with it stays within the budget. Since sanitizeList caps
  // entries at 100 chars, no single item can exceed the budget.
  function splitList(items) {
    var chunks = [[]];
    items.forEach(function (item) {
      var current = chunks[chunks.length - 1];
      if (byteSize(current.concat([item])) > CHUNK_BUDGET_BYTES) {
        current = [];
        chunks.push(current);
      }
      current.push(item);
    });
    return chunks;
  }

  // Indices of stored chunks for a base key: the base key itself is
  // chunk 0; <base>_<digits> keys contribute their numeric index.
  // Anything else sharing the prefix (e.g. "_x", "Foo") is ignored.
  function chunkIndices(all, baseKey) {
    var indices = [];
    Object.keys(all).forEach(function (key) {
      if (key === baseKey) {
        indices.push(0);
        return;
      }
      if (key.indexOf(baseKey + "_") !== 0) return;
      var n = Number(key.slice(baseKey.length + 1));
      if (Number.isInteger(n) && n > 0 && String(n) === key.slice(baseKey.length + 1)) {
        indices.push(n);
      }
    });
    return indices.sort(function (a, b) {
      return a - b;
    });
  }

  function assembleList(all, baseKey) {
    var seen = {};
    var out = [];
    chunkIndices(all || {}, baseKey).forEach(function (i) {
      var chunk = all[chunkKey(baseKey, i)];
      if (!Array.isArray(chunk)) return;
      chunk.forEach(function (item) {
        var key = String(item).toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        out.push(item);
      });
    });
    return out;
  }

  // Returns { set, remove }: `set` holds every new chunk (including the
  // base key even when empty, so chunk 0 always exists), `remove` lists
  // stored chunk keys left over beyond the new chunk count.
  function buildListWrite(all, baseKey, items) {
    var chunks = splitList(items);
    var set = {};
    chunks.forEach(function (chunk, i) {
      set[chunkKey(baseKey, i)] = chunk;
    });
    var remove = chunkIndices(all || {}, baseKey)
      .filter(function (i) {
        return i >= chunks.length;
      })
      .map(function (i) {
        return chunkKey(baseKey, i);
      });
    return { set: set, remove: remove };
  }

  // The one reader: booleans plus both lists assembled from chunks.
  function assembleSettings(all) {
    var src = all && typeof all === "object" ? all : {};
    var clean = {};
    BOOL_KEYS.forEach(function (key) {
      clean[key] =
        key === "extensionEnabled" && src[key] === undefined
          ? true
          : !!src[key];
    });
    LIST_KEYS.forEach(function (key) {
      clean[key] = assembleList(src, key);
    });
    return clean;
  }

  // The one writer for a full settings object (import): every boolean
  // plus all chunks of both lists, with stale chunks removed.
  function buildSettingsWrite(all, clean) {
    var set = {};
    BOOL_KEYS.forEach(function (key) {
      set[key] = !!clean[key];
    });
    var remove = [];
    LIST_KEYS.forEach(function (key) {
      var w = buildListWrite(all || {}, key, clean[key] || []);
      Object.assign(set, w.set);
      remove = remove.concat(w.remove);
    });
    return { set: set, remove: remove };
  }

  function sanitizeList(raw) {
    if (!Array.isArray(raw)) return [];
    var seen = {};
    var out = [];
    raw.forEach(function (item) {
      if (typeof item !== "string") return;
      var value = item.trim().slice(0, MAX_ENTRY_LENGTH);
      if (!value) return;
      var key = value.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(value);
    });
    return out.slice(0, MAX_LIST_LENGTH);
  }

  function sanitizeSettings(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var clean = {};
    BOOL_KEYS.forEach(function (key) {
      // Master switch defaults ON when absent; otherwise boolean-coerced
      clean[key] =
        key === "extensionEnabled" && src[key] === undefined
          ? true
          : !!src[key];
    });
    LIST_KEYS.forEach(function (key) {
      clean[key] = sanitizeList(src[key]);
    });
    return clean;
  }

  var api = {
    LIST_KEYS: LIST_KEYS,
    CHUNK_BUDGET_BYTES: CHUNK_BUDGET_BYTES,
    chunkKey: chunkKey,
    splitList: splitList,
    assembleList: assembleList,
    buildListWrite: buildListWrite,
    assembleSettings: assembleSettings,
    buildSettingsWrite: buildSettingsWrite,
    sanitizeSettings: sanitizeSettings,
  };
  if (typeof window !== "undefined") {
    window.LinkedInFilterSettings = api;
  }
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  }
})();
