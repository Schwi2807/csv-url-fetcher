# CSV URL Fetcher — plan (as built)

Kickoff 2026-10-16. First plan was a FastAPI proxy + page; changed at kickoff: **iPhone/iPad only, offline PWA,
no backend**. Requests go straight from Safari; CORS failures show "BLOCKED by CORS" (proxy = later phase).
Export only on request, as a .zip.

## Shape
- `index.html`, `style.css`, `core.js`, `modules/ui.js`, `modules/viewer.js`: PWA kit (themes, IndexedDB, sheets, share/download, image/PDF viewer).
- `fetcher.js`: GET with timeout + Stop, 10 MB cap, error kinds (cors, network, timeout, offline, invalid_url, insecure, stopped), concurrency runner.
- `errors.js`: reason phrases + plain-English explanation/fix per status and error kind.
- `render.js`: body detection (Content-Type, then sniffing) and renderers (JSON tree, image, text, HTML + sandboxed preview, PDF, binary).
- `zip.js`: ZIP writer (deflate via CompressionStream).
- `app.js`: Fetch / History / Settings tabs, CSV via vendored PapaParse, cards in CSV order rendered in batches of 60.
- IndexedDB: `runs`, `results` (id `runId:index`, body as Blob), `kv` (csv, opts, lastRun).

## Milestones
1. Scaffold from the kit. 2. Fetch engine + error table. 3. Renderers. 4. App UI, history, zip export, sample. 5. README.

## Verified (browser pane, iPhone 375x812 + iPad 768x1024 / 1180x820, light + dark)
sample.csv against httpbin (all card types), CORS (example.com), DNS failure, invalid URL, Stop + Retry failed,
filters + search, zip (CRC check of every entry), reload persistence, 1,500 rows (2.2 s, max 5 ms main-thread stall), offline reload.
