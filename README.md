# ProdukPOS — Open Indonesian Product API + Free Offline POS

**An open, public REST API for Indonesian retail products — and a free,
offline-first point-of-sale app built on top of it.**

- 🗄️ **4,600+ real Indonesian retail products** — barcodes, names, brands,
  quantities, categories, images, and nutrition data
- ⚡ **Fast & lightweight** — single Node.js process, SQLite + FTS5 full-text
  search, ~1 ms query latency, 2.3 MB database
- 🔒 **Secure by design** — read-only database, schema-validated input,
  per-IP rate limiting, security headers
- 🛒 **ProdukPOS** — a free installable PWA cashier (kasir) for warung and
  toko: barcode scanning, local pricing, cash checkout, sales history, CSV
  export — works fully offline
- 📱 **Responsive** — phone-first POS with a desktop register mode
  (persistent cart panel) at ≥1024px

Product data © [Open Food Facts](https://openfoodfacts.org) contributors,
licensed [ODbL](https://opendatacommons.org/licenses/odbl/1-0/). Code is
[MIT](LICENSE).

---

## Table of contents

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [API reference](#api-reference)
- [ProdukPOS user guide](#produkpos-user-guide)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Security model](#security-model)
- [Data: source, license, and honesty](#data-source-license-and-honesty)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Quick start

Requires **Node.js ≥ 20**.

```bash
git clone https://github.com/Mr-vero/produkpos.git
cd produkpos
npm install
npm run ingest   # builds data/products.db from Open Food Facts (~1 minute, needs internet)
npm start        # serves on http://localhost:3000
```

Then open:

| URL | What |
|---|---|
| `http://localhost:3000/docs` | Interactive API documentation (Swagger UI) |
| `http://localhost:3000/pos/` | ProdukPOS — the free offline cashier app |
| `http://localhost:3000/v1/stats` | Dataset statistics |

## Architecture

```mermaid
flowchart LR
    OFF[Open Food Facts\nsearch API] -->|npm run ingest| DB[(SQLite\nproducts.db\n+ FTS5 index)]
    DB -->|read-only| API[Fastify API\n/v1/*]
    API --> DOCS[Swagger UI\n/docs]
    API -->|/v1/export\ncatalog sync| POS[ProdukPOS PWA\n/pos/]
    POS --> IDB[(IndexedDB\ncatalog · prices · sales)]
    subgraph Device (fully offline after first sync)
        POS
        IDB
    end
```

- **Ingestion** ([scripts/ingest.mjs](scripts/ingest.mjs)) pulls every product
  tagged Indonesia from the Open Food Facts search API, normalizes it, and
  upserts into SQLite. Re-runnable; refreshes existing rows by barcode.
- **API** ([src/app.js](src/app.js)) is a Fastify server that opens the
  database read-only. Every route is schema-validated and rate limited.
- **POS** ([pos/](pos/)) is a dependency-free vanilla-JS PWA. It syncs the
  compact catalog once via `/v1/export`, then runs entirely from IndexedDB —
  prices and sales never leave the device.

## API reference

All endpoints are `GET`, return JSON, and are CORS-enabled for any origin.
List endpoints accept `page` and `per_page` (max 100) and return
`{ total, page, per_page, total_pages, items }`.

| Endpoint | Description |
|---|---|
| `GET /v1/products` | List products, most-scanned first. Filters: `brand`, `category` |
| `GET /v1/products/{barcode}` | Full product detail by EAN/UPC barcode |
| `GET /v1/search?q=` | Full-text search over names, brands, categories (prefix matching, relevance-ranked) |
| `GET /v1/export` | Compact bulk export of the whole catalog (for offline clients; ~120 KB gzipped) |
| `GET /v1/brands` | Brands with product counts |
| `GET /v1/categories` | Categories with product counts |
| `GET /v1/stats` | Dataset statistics + attribution |
| `GET /healthz` | Liveness probe (not rate limited) |

### Examples

Look up a product by barcode:

```bash
curl https://your-host/v1/products/8999999002503
```

```json
{
  "barcode": "8999999002503",
  "name": "Kecap Manis",
  "brand": "Bango",
  "quantity": "275 ml",
  "categories": ["condiments", "sauces", "soy sauces", "groceries"],
  "nutriscore": "e",
  "nutriments": { "energy-kcal_100g": 423, "sugars_100g": 74 },
  "source": "openfoodfacts"
}
```

Search:

```bash
curl 'https://your-host/v1/search?q=mie+goreng&per_page=5'
```

Filter by brand:

```bash
curl 'https://your-host/v1/products?brand=Indomie'
```

Rate limit: **120 requests/minute per IP** by default (configurable). The
response caches well (`cache-control: public, max-age=300`), so put a CDN in
front for heavy public traffic.

## ProdukPOS user guide

ProdukPOS is aimed at warung/toko owners who want a free cashier that works
without a reliable connection.

1. **Open `/pos/` once while online** and tap the sync button (top right).
   The full catalog (~4,600 products) downloads in one ~120 KB request.
   On a phone, use "Add to Home Screen" to install it as an app.
2. **Set your prices.** Open Food Facts has no price data — and every shop's
   prices differ anyway. Search a product, tap it, enter your selling price
   once. It's saved on the device.
3. **Sell.** Search by name, type/scan a barcode (camera scanning where the
   browser supports it; USB/Bluetooth keyboard-wedge scanners work
   everywhere), tap products to build the cart, enter cash received, and the
   change is computed for you. Items not in the catalog can be added as
   manual line items.
4. **Review.** The Riwayat tab shows today's revenue, transaction count, and
   the full sales log, exportable as CSV for bookkeeping.

Everything after the first sync — including the app shell and fonts — is
cached locally. **Prices and sales are stored only on the device**
(IndexedDB); nothing is sent to any server.

On desktop (≥1024px) the layout switches to a register: navigation rail on
the left, product grid in the middle, and an always-visible cart panel on the
right, with the search box focused for keyboard-first scanning.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `data/products.db` | SQLite database location |
| `RATE_LIMIT_MAX` | `120` | Requests per minute per IP |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy so rate limiting sees real client IPs |

## Deployment

### Docker

```bash
npm run ingest                      # build the dataset first
docker build -t produkpos .
docker run -p 3000:3000 produkpos
```

The image ships the ingested database inside it; rebuild to refresh data, or
mount a volume at `/app/data` and run `npm run ingest` there on a cron
(daily is plenty — it upserts by barcode).

### Any container host

Works on Fly.io, Railway, Render, or a plain VPS. Checklist:

1. Set `TRUST_PROXY=1` (you'll be behind their proxy).
2. Serve over HTTPS (required for the POS camera scanner and PWA install).
3. Optional: put a CDN/cache in front — responses already send cache headers.

## Security model

- The server opens SQLite **read-only** with `query_only` on — no write path
  exists in the API process.
- Every query/path parameter is validated against a JSON Schema before any
  handler runs.
- All SQL uses prepared statements; search input is quoted term-by-term so
  FTS5 syntax cannot be injected.
- Per-IP rate limiting (429 with retry info), CORS locked to `GET/HEAD`,
  helmet security headers, 1 KB request body limit.
- The POS stores merchant data (prices, sales) only in the browser's
  IndexedDB on the merchant's own device.

## Data: source, license, and honesty

The catalog is built from **Open Food Facts**, the collaborative open
database of food products, filtered to products sold in Indonesia. The data
license is the **Open Database License (ODbL)**: you may use and redistribute
it, including commercially, provided you credit Open Food Facts and share
data improvements under the same license. Attribution ships in `/v1/stats`,
the OpenAPI description, and the POS Info tab — keep it.

**Honesty note:** ~4,600 products is a real, verified seed — not "every
product in Indonesia". No open dataset has that (GS1 Indonesia and BPOM do
not publish bulk data). The per-row `source` column exists so the database
can grow from multiple sources over time. The best way to grow the food
catalog is to contribute scans upstream to Open Food Facts — everyone
benefits, including this project on its next ingest.

## Roadmap

- [ ] Non-food retail via Open Beauty Facts / Open Products Facts ingestion
- [ ] BPOM registration-number enrichment
- [ ] Nightly automated re-ingest (GitHub Action)
- [ ] POS: receipt printing (Web Bluetooth ESC/POS), stock tracking, multi-device backup/export
- [ ] Public hosted instance with CDN

## Contributing

Contributions are very welcome — this project exists to be shared. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, code style,
and how to help grow the product catalog. By contributing you agree that
your code contributions are MIT-licensed and data contributions are
ODbL-licensed.

## License

- **Code:** [MIT](LICENSE)
- **Product data:** © Open Food Facts contributors,
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
