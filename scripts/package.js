// Packages the extension into extension.zip at the repo root.
// Usage: node scripts/package.js [--force]
// Refuses to run on a dirty working tree unless --force is passed.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const archiver = require("archiver");

const root = path.join(__dirname, "..");
const outPath = path.join(root, "extension.zip");

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
);
console.log(`Packaging version ${manifest.version}`);

const force = process.argv.includes("--force");
const dirty = execSync("git status --porcelain", { cwd: root })
  .toString()
  .trim();
if (dirty && !force) {
  console.error(
    "Working tree is not clean — commit or stash first, or pass --force.",
  );
  process.exit(1);
}

const FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "settings-store.js",
];
const DIRS = ["assets", "_locales"];

const missing = FILES.filter((f) => !fs.existsSync(path.join(root, f)));
for (const dir of DIRS) {
  if (!fs.existsSync(path.join(root, dir))) missing.push(dir + "/");
}
if (missing.length) {
  console.error("Missing required files: " + missing.join(", "));
  process.exit(1);
}

const output = fs.createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

const done = new Promise((resolve, reject) => {
  output.on("close", resolve);
  archive.on("error", reject);
});

archive.pipe(output);
for (const f of FILES) archive.file(path.join(root, f), { name: f });
for (const dir of DIRS) {
  archive.directory(path.join(root, dir), dir);
}
archive.finalize();

done.then(() => {
  // Re-open the zip and list entries by parsing the central directory
  // (no extra dependency — archiver doesn't expose a reader).
  const buf = fs.readFileSync(outPath);
  const entries = listZipEntries(buf);
  const bad = entries.filter((n) => n.includes("\\"));
  console.log(`extension.zip written: ${buf.length} bytes, ${entries.length} entries`);
  entries.forEach((n) => console.log("  " + n));
  if (bad.length) {
    console.error("Entry names with backslashes found: " + bad.join(", "));
    process.exit(1);
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

// Minimal zip central-directory parser to list entry names.
function listZipEntries(buf) {
  const names = [];
  // End of central directory signature PK\x05\x06
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    names.push(buf.slice(offset + 46, offset + 46 + nameLen).toString("utf8"));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}
