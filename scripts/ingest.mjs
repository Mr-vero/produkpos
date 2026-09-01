/**
 * Ingest Indonesian retail products from the Open Food Facts search API
 * (https://search.openfoodfacts.org) into a local SQLite database.
 *
 * Data license: Open Database License (ODbL) — attribution to Open Food Facts
 * is required when redistributing. See README.md.
 *
 * Usage: npm run ingest
 * Re-runnable: upserts by barcode, so it refreshes existing rows.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH ?? resolve(ROOT, 'data', 'products.db');
const USER_AGENT = 'ProdukAPI-Ingest/1.0 (github.com/produk-api)';
const BASE = 'https://search.openfoodfacts.org/search';
const QUERY = 'countries_tags:"en:indonesia"';
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 1200; // be polite to the upstream API

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  barcode           TEXT PRIMARY KEY,
  name              TEXT,
  brand             TEXT,
  brands            TEXT NOT NULL DEFAULT '[]',
  quantity          TEXT,
  categories        TEXT NOT NULL DEFAULT '[]',
  categories_tags   TEXT NOT NULL DEFAULT '[]',
  image_url         TEXT,
  image_small_url   TEXT,
  nutriscore        TEXT,
  nova_group        INTEGER,
  nutriments        TEXT,
  ingredients_tags  TEXT NOT NULL DEFAULT '[]',
  countries_tags    TEXT NOT NULL DEFAULT '[]',
  lang              TEXT,
  completeness      REAL,
  scans             INTEGER NOT NULL DEFAULT 0,
  source            TEXT NOT NULL DEFAULT 'openfoodfacts',
  source_updated_at INTEGER,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_scans ON products(scans DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
  barcode UNINDEXED, name, brand, categories,
  tokenize = 'unicode61 remove_diacritics 2'
);
`);

const upsert = db.prepare(`
INSERT INTO products (
  barcode, name, brand, brands, quantity, categories, categories_tags,
  image_url, image_small_url, nutriscore, nova_group, nutriments,
  ingredients_tags, countries_tags, lang, completeness, scans,
  source_updated_at, updated_at
) VALUES (
  @barcode, @name, @brand, @brands, @quantity, @categories, @categories_tags,
  @image_url, @image_small_url, @nutriscore, @nova_group, @nutriments,
  @ingredients_tags, @countries_tags, @lang, @completeness, @scans,
  @source_updated_at, @updated_at
)
ON CONFLICT(barcode) DO UPDATE SET
  name = excluded.name, brand = excluded.brand, brands = excluded.brands,
  quantity = excluded.quantity, categories = excluded.categories,
  categories_tags = excluded.categories_tags, image_url = excluded.image_url,
  image_small_url = excluded.image_small_url, nutriscore = excluded.nutriscore,
  nova_group = excluded.nova_group, nutriments = excluded.nutriments,
  ingredients_tags = excluded.ingredients_tags,
  countries_tags = excluded.countries_tags, lang = excluded.lang,
  completeness = excluded.completeness, scans = excluded.scans,
  source_updated_at = excluded.source_updated_at, updated_at = excluded.updated_at
`);

const cleanTag = (t) => String(t).replace(/^[a-z]{2}:/, '').replace(/-/g, ' ');

function normalize(hit) {
  const barcode = String(hit.code ?? '').trim();
  if (!/^\d{4,14}$/.test(barcode)) return null;
  const name =
    hit.product_name_id ?? hit.product_name ?? hit.product_name_en ?? null;
  const brands = Array.isArray(hit.brands) ? hit.brands : [];
  const categoriesTags = Array.isArray(hit.categories_tags) ? hit.categories_tags : [];
  return {
    barcode,
    name: name ? String(name).trim() : null,
    brand: brands[0] ?? null,
    brands: JSON.stringify(brands),
    quantity: hit.quantity ?? null,
    categories: JSON.stringify(categoriesTags.map(cleanTag)),
    categories_tags: JSON.stringify(categoriesTags),
    image_url: hit.image_front_url ?? hit.image_url ?? null,
    image_small_url: hit.image_front_small_url ?? hit.image_small_url ?? null,
    nutriscore: hit.nutriscore_grade ?? hit.nutrition_grades ?? null,
    nova_group: Number.isFinite(hit.nova_group) ? hit.nova_group : null,
    nutriments: hit.nutriments ? JSON.stringify(hit.nutriments) : null,
    ingredients_tags: JSON.stringify(hit.ingredients_tags ?? []),
    countries_tags: JSON.stringify(hit.countries_tags ?? []),
    lang: hit.lang ?? null,
    completeness: typeof hit.completeness === 'number' ? hit.completeness : null,
    scans: hit.unique_scans_n ?? hit.scans_n ?? 0,
    source_updated_at: hit.last_modified_t ?? null,
    updated_at: Math.floor(Date.now() / 1000),
  };
}

async function fetchPage(page, attempt = 1) {
  const url = `${BASE}?q=${encodeURIComponent(QUERY)}&page_size=${PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    if (attempt <= 5) {
      const wait = attempt * 5000;
      console.warn(`  page ${page}: HTTP ${res.status}, retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      return fetchPage(page, attempt + 1);
    }
    throw new Error(`page ${page} failed after retries: HTTP ${res.status}`);
  }
  return res.json();
}

const first = await fetchPage(1);
const total = first.count;
const pages = Math.ceil(total / PAGE_SIZE);
console.log(`Upstream reports ${total} Indonesian products across ${pages} pages.`);

let saved = 0;
let skipped = 0;
const saveBatch = db.transaction((rows) => {
  for (const row of rows) {
    upsert.run(row);
    saved += 1;
  }
});

for (let page = 1; page <= pages; page++) {
  const data = page === 1 ? first : await fetchPage(page);
  const rows = [];
  for (const hit of data.hits ?? []) {
    const row = normalize(hit);
    if (row) rows.push(row);
    else skipped += 1;
  }
  saveBatch(rows);
  process.stdout.write(`\r  page ${page}/${pages} — ${saved} saved, ${skipped} skipped`);
  if (page < pages) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
}
console.log();

// Rebuild the full-text index from scratch so it always matches the table.
db.exec('DELETE FROM products_fts');
db.exec(`
INSERT INTO products_fts (barcode, name, brand, categories)
SELECT barcode,
       COALESCE(name, ''),
       COALESCE(brand, ''),
       COALESCE((SELECT group_concat(value, ' ') FROM json_each(products.categories)), '')
FROM products
`);
db.exec('INSERT INTO products_fts(products_fts) VALUES (\'optimize\')');
db.pragma('optimize');
db.pragma('wal_checkpoint(TRUNCATE)');

const count = db.prepare('SELECT count(*) AS n FROM products').get().n;
console.log(`Done. Database now holds ${count} products at ${DB_PATH}`);
db.close();
