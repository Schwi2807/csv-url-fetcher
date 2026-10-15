# CSV URL Fetcher

Offline-first web app (plain HTML/CSS/JS, no build step). All data stays on the device.

## Publish on GitHub Pages

1. Push this folder to `https://github.com/Schwi2807/csv-url-fetcher` (files at the repo root).
2. Repo → Settings → Pages → Source: "Deploy from a branch", branch `master`, folder `/ (root)` → Save.
3. After 1–2 minutes it is live at `https://schwi2807.github.io/csv-url-fetcher/`.
4. For later updates, bump `VERSION` in `sw.js` before pushing, or installed copies keep the old files.

## Install (do it online; the first launch caches the app for offline use)

- **iPad / iPhone (Safari):** open the URL → Share → Add to Home Screen → open it **from the icon**, then add your data there. iOS keeps Safari and Home Screen storage separate, so data entered in the Safari tab does not appear in the installed app.
- **Android (Chrome):** open the URL → ⋮ menu → Install app (or Add to Home screen).
- **Windows / Mac (Chrome or Edge):** open the URL → click the install icon at the right end of the address bar.

Back up from Settings → Data → Export backup, and keep the file somewhere safe.
