/**
 * Sanity-check the ingested database before it is allowed to deploy.
 * Exits non-zero (failing the build) if the dataset looks broken.
 */
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH ?? resolve(ROOT, 'data', 'products.db');

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const products = db.prepare('SELECT count(*) AS n FROM products').get().n;
const ftsHits = db
  .prepare("SELECT count(*) AS n FROM products_fts WHERE products_fts MATCH 'indomie'")
  .get().n;
const journalMode = db.pragma('journal_mode', { simple: true });
db.close();

console.log(`products=${products} fts_indomie_hits=${ftsHits} journal_mode=${journalMode}`);

const errors = [];
if (products < 4000) errors.push(`too few products (${products} < 4000) — upstream ingest likely failed`);
if (ftsHits < 10) errors.push(`full-text index looks broken (${ftsHits} hits for 'indomie')`);
if (journalMode === 'wal') {
  errors.push('database left in WAL mode — cannot be opened on read-only filesystems');
}

if (errors.length) {
  for (const e of errors) console.error('CHECK FAILED:', e);
  process.exit(1);
}
console.log('Database sanity checks passed.');
