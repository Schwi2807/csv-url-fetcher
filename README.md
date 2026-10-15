# CSV URL Fetcher

Offline-first web app for iPhone and iPad (works in any modern browser too). Load a CSV, write a URL template such as
`https://example.com/{id}/{name}/get`, and the app fills in each row's values and sends a GET request per row. Each response gets its own box, numbered by CSV row, in CSV
order: 30 rows give 30 boxes. Plain HTML/CSS/JS, no build step, no server of its own. Runs and responses are saved on
the device; only the requests themselves need the internet.

## Use it

1. **CSV**: Choose CSV file (Files app), or drag a file onto the box on iPad. "First row is header" is on by default.
   A preview of the first 5 rows appears.
2. **URL template** (remembered): write `{column name}` wherever a value goes, as many columns as you like, e.g.
   `https://example.com/{id}/{name}/get`. Tap a column chip under the field to insert it at the cursor. Header names
   match case-insensitively; `{2}` means the 2nd column (handy without a header row). Columns used by the template
   are highlighted in the preview; a placeholder that matches no column is flagged and left as typed.
3. **Options**: URL-encode values (on), skip empty cells (on: skips a row when any column the template uses is empty),
   skip duplicate URLs (off), concurrency 1–10 (4), timeout per request (15 s). The URL for the first row is shown live.
4. **Run**. **Stop** cancels requests in flight; queued ones never start. **Retry failed** re-runs errors, stopped
   and not-yet-run rows.
5. Boxes appear one by one as requests start (spinner while waiting) and fill in as responses arrive:
   - JSON: highlighted, every level folds, Copy gives pretty JSON.
   - Images: shown with their size in pixels; tap to zoom; Download.
   - Text, XML, CSV: monospace, Copy.
   - HTML: source with Copy, plus a Preview in a sandboxed frame (no scripts).
   - PDF: Preview (all pages) and Download. Other binary: type, size, first bytes, Download.
   - Long bodies fold after ~30 lines (Show more).
   - Errors (4xx/5xx and network failures) explain what happened and what to try; any error body is still shown.
6. Top panel: progress, counters (success / client error / server error / network error), filter chips
   (All / Success / Errors) and a search over values and URLs.
7. **Export .zip** (only when you ask): `results.csv` (row, value, url, status, time_ms, content_type, error_reason,
   final_url, size_bytes, body_file; with several template columns, each also gets its own column after `value`)
   plus every response body under `responses/`.
8. **History** keeps every run; open one to see its boxes again (works offline), or delete it.

Try **Load sample** first: it loads `sample.csv` and sets the template to `https://httpbin.org/{endpoint}` with encoding off,
covering JSON, PNG/JPEG/SVG, HTML, XML, text, binary, redirects, 404, 503, 429 and a slow response.

## Defaults and decisions

- No proxy: requests go straight from Safari. A server that does not send CORS headers gets a box saying
  **BLOCKED by CORS** (the app confirms with a second, no-cors request that the server did answer). A proxy can come
  in a later phase.
- Browsers report DNS failures, refused connections, SSL errors and redirect loops as the same error, so those share
  one "Network error" box listing the possible causes. Timeouts, offline, invalid URLs and http-from-https
  (mixed content) are told apart.
- Response bodies are kept up to 10 MB each (marked "cut" when larger). Text over 300 KB shows its start inline; Copy
  and Download give all of it.
- Values are trimmed of surrounding spaces. URL-encoding turns `/` into `%2F`; the app warns when values contain `/`
  so you can turn encoding off for path-style values. Each box's header shows the row's values joined with ` · `.
- A template without any `{column}` cannot run. Setups from the first version ("base URL + column") are converted to
  a template automatically.
- Headers like Retry-After are shown only when the server exposes them to web apps (CORS); otherwise the box says so.
- httpbin.org caps `delay/N` at 10 s, so `delay/20` only times out with a timeout below 10 s.
- More than 60 boxes render in batches while you scroll, so 1,000+ rows stay smooth (tested with 1,500).
- Theme follows the system (light/dark); 13 themes in Settings.

## Publish on GitHub Pages

1. Push this folder to `https://github.com/Schwi2807/csv-url-fetcher` (files at the repo root).
2. Repo → Settings → Pages → Source: "Deploy from a branch", branch `master`, folder `/ (root)` → Save.
3. After 1–2 minutes it is live at `https://schwi2807.github.io/csv-url-fetcher/`.
4. For later updates, bump `VERSION` in `sw.js` before pushing, or installed copies keep the old files.

## Install (do it online; the first launch caches the app for offline use)

- **iPhone / iPad (Safari):** open the URL → Share → Add to Home Screen → open it **from the icon**. iOS keeps Safari
  and Home Screen storage separate, so runs made in the Safari tab do not appear in the installed app.
- **Windows / Mac (Chrome or Edge):** open the URL → install icon at the right end of the address bar.

iOS may clear app storage after weeks without use or when space is low; export runs you want to keep.

## Run it locally

From this folder:

```bash
python -m http.server 8000 --bind 127.0.0.1
```

Then open http://localhost:8000/. (Service workers need https or localhost, so open it via localhost, not a LAN IP.)
