import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.DB_PATH ?? resolve(ROOT, 'data', 'products.db');

if (!existsSync(DB_PATH)) {
  throw new Error(
    `Database not found at ${DB_PATH}. Run "npm run ingest" first to build it.`
  );
}

// The API is read-only by design: the server can never modify the dataset.
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');

const parse = (s, fallback = null) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

export function toProduct(row, { full = false } = {}) {
  if (!row) return null;
  const p = {
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    brands: parse(row.brands, []),
    quantity: row.quantity,
    categories: parse(row.categories, []),
    image_url: row.image_url,
    image_small_url: row.image_small_url,
    nutriscore: row.nutriscore,
    nova_group: row.nova_group,
    source: row.source,
    updated_at: row.updated_at,
  };
  if (full) {
    p.categories_tags = parse(row.categories_tags, []);
    p.nutriments = parse(row.nutriments);
    p.ingredients_tags = parse(row.ingredients_tags, []);
    p.countries_tags = parse(row.countries_tags, []);
    p.lang = row.lang;
    p.completeness = row.completeness;
    p.scans = row.scans;
    p.source_updated_at = row.source_updated_at;
  }
  return p;
}

const stmts = {
  byBarcode: db.prepare('SELECT * FROM products WHERE barcode = ?'),
  count: db.prepare('SELECT count(*) AS n FROM products'),
  list: db.prepare(`
    SELECT * FROM products
    WHERE (@brand IS NULL OR brand = @brand COLLATE NOCASE)
      AND (@category IS NULL OR EXISTS (
        SELECT 1 FROM json_each(products.categories) WHERE value = @category COLLATE NOCASE))
    ORDER BY scans DESC, barcode
    LIMIT @limit OFFSET @offset
  `),
  listCount: db.prepare(`
    SELECT count(*) AS n FROM products
    WHERE (@brand IS NULL OR brand = @brand COLLATE NOCASE)
      AND (@category IS NULL OR EXISTS (
        SELECT 1 FROM json_each(products.categories) WHERE value = @category COLLATE NOCASE))
  `),
  search: db.prepare(`
    SELECT p.*, bm25(products_fts, 0, 10.0, 5.0, 2.0) AS rank
    FROM products_fts f
    JOIN products p ON p.barcode = f.barcode
    WHERE products_fts MATCH @match
    ORDER BY rank
    LIMIT @limit OFFSET @offset
  `),
  searchCount: db.prepare(
    'SELECT count(*) AS n FROM products_fts WHERE products_fts MATCH @match'
  ),
  brands: db.prepare(`
    SELECT brand AS name, count(*) AS product_count FROM products
    WHERE brand IS NOT NULL
    GROUP BY brand ORDER BY product_count DESC, brand
    LIMIT @limit OFFSET @offset
  `),
  brandsCount: db.prepare(
    'SELECT count(DISTINCT brand) AS n FROM products WHERE brand IS NOT NULL'
  ),
  categories: db.prepare(`
    SELECT value AS name, count(*) AS product_count
    FROM products, json_each(products.categories)
    GROUP BY value ORDER BY product_count DESC, name
    LIMIT @limit OFFSET @offset
  `),
  categoriesCount: db.prepare(`
    SELECT count(*) AS n FROM (
      SELECT DISTINCT value FROM products, json_each(products.categories))
  `),
  export: db.prepare(`
    SELECT barcode, name, brand, quantity, image_small_url
    FROM products ORDER BY barcode
  `),
  stats: db.prepare(`
    SELECT count(*) AS products,
           count(DISTINCT brand) AS brands,
           max(updated_at) AS last_updated
    FROM products
  `),
};

/**
 * Build a safe FTS5 MATCH expression from free text: each term is quoted
 * (so user input can never inject FTS syntax) and the last term is a prefix.
 */
export function ftsQuery(q) {
  const terms = q
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter(Boolean)
    .slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((t, i) => `"${t}"${i === terms.length - 1 ? '*' : ''}`).join(' ');
}

export default { db, stmts };
export { db, stmts };
