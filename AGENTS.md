# Agent notes

Architecture, selectors, storage keys and conventions live in `CLAUDE.md` —
read it first. It is gitignored on the maintainer's machine; if it's missing
from your checkout, ask the user for it before touching `content.js`.

## Commands

- `npm test` — run the jsdom test suite in `tests/` (no browser needed).
- `npm run check` — `node --check` syntax gate on all JS files.
- `npm run package` — rebuild `extension.zip` (needs a clean tree; `--force` to override).

## Rules

- Whenever a change touches anything documented in `CLAUDE.md` (selectors,
  architecture, storage keys, file roles), update `CLAUDE.md` in the same
  change.
- When LinkedIn's DOM changes, update `tests/fixtures/` from a real card
  first, then change the code.
- Bump `manifest.json` AND `package.json` version together.
