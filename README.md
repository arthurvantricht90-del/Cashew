# Cashew

Personal expense tracker for Android. Reads bank statement PDFs (KBC/CBC for now), sorts every payment into categories, and shows totals per week, two weeks or month, as numbers, pie or bar charts, plus an evolution graph over time. All data stays on the phone.

## Getting the app
Every push to `main` builds a new APK on GitHub (tab **Actions**). The finished APK is attached to the newest entry under **Releases**. Download it on the phone and open it to install (allow installing from this source when Android asks). A newer APK installs over the old one and keeps your data.

## Development
- `npm ci` then `node build.mjs` builds `dist/index.html`, a single file you can open in Chrome to test.
- `src/banks/` holds one reader per bank. To add a bank, add a module with the same shape as `kbc.js` and list it in `src/banks/index.js`.
- `src/seed.js` holds the starting categories, accounts and rules.
