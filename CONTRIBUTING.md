# Contributing to ProdukPOS

Terima kasih! This project exists to give Indonesia an open product database
and a free cashier anyone can use. Contributions of every size are welcome —
code, data, documentation, translations, and bug reports.

## Ways to contribute

### 1. Grow the product catalog (no coding required)

The catalog comes from [Open Food Facts](https://openfoodfacts.org). The
highest-impact contribution is adding Indonesian products **upstream**:

1. Install the [Open Food Facts app](https://world.openfoodfacts.org/open-food-facts-mobile-app)
   (Android/iOS).
2. Scan products around you — barcode, photos, name, brand, quantity.
3. They'll appear in this project on the next ingest (`npm run ingest`).

This benefits the entire open-data ecosystem, not just this repo.

### 2. Report bugs / request features

Open a [GitHub issue](../../issues). For bugs, include:

- What you did, what you expected, what happened
- API: the exact request URL and response
- POS: device, browser + version, and whether you were online or offline

### 3. Code

Areas where help is most wanted (see the roadmap in the README):

- New data sources behind the existing `source` column (Open Beauty Facts,
  Open Products Facts, BPOM enrichment)
- POS features: receipt printing (ESC/POS over Web Bluetooth), stock
  tracking, backup/restore of local data
- Translations of the POS UI (it's currently Bahasa Indonesia)
- Tests, accessibility, performance

## Development setup

Requires Node.js ≥ 20.

```bash
git clone https://github.com/Mr-vero/produkpos.git
cd produkpos
npm install
npm run ingest        # build data/products.db (needs internet, ~1 min)
npm run dev           # start with auto-reload on http://localhost:3000
```

- API docs: `http://localhost:3000/docs`
- POS: `http://localhost:3000/pos/`

### Project layout

```
src/app.js         Fastify app: routes, plugins, schemas
src/db.js          SQLite (read-only) + prepared statements + FTS helper
src/server.js      Entry point
scripts/ingest.mjs Catalog ingestion from Open Food Facts
pos/               ProdukPOS PWA (vanilla JS, no build step)
data/products.db   Generated — never commit this
```

### Ground rules for code

- **Keep it lightweight.** The API is intentionally a single process with
  SQLite; the POS is intentionally build-free vanilla JS. Please don't
  introduce frameworks, build steps, or services without discussing in an
  issue first.
- **The API stays read-only.** Any write path needs a design discussion.
- **Validate everything.** New API parameters must have JSON-Schema
  validation; new SQL must use prepared statements.
- **Offline is a feature.** POS changes must work with no network. Test with
  DevTools → Network → Offline.
- **Both layouts.** Test POS changes at 375px width and ≥1024px width.
- Match the existing code style (2-space indent, ESM, no semicolonless
  style). `node --check` must pass on every changed file.

## Pull request process

1. Fork, create a feature branch (`feat/receipt-printing`, `fix/fts-empty-query`).
2. Keep PRs focused — one change per PR.
3. Describe **what** and **why**; include screenshots for UI changes
   (mobile + desktop).
4. Verify locally before opening:

```bash
node --check src/app.js src/db.js src/server.js scripts/ingest.mjs pos/app.js pos/sw.js
npm run ingest && npm start   # then exercise /docs and /pos/
```

5. A maintainer will review. Be patient and kind — this is volunteer time.

## Licensing of contributions

- Code contributions are licensed under the [MIT License](LICENSE).
- Data contributions/improvements are licensed under the
  [ODbL](https://opendatacommons.org/licenses/odbl/1-0/), consistent with
  Open Food Facts.

## Conduct

Be respectful and constructive. Harassment, discrimination, or hostility
have no place here; maintainers may remove content and block contributors
who engage in them.
