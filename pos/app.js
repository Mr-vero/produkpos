/* Produk POS — offline-first cashier on top of the Produk API.
 * Catalog: synced from /v1/export into IndexedDB (+ in-memory for search).
 * Prices & sales: local to this device only.
 */
'use strict';

const $ = (id) => document.getElementById(id);
const rupiah = (n) =>
  'Rp ' + Math.round(n).toLocaleString('id-ID');

// ---------- IndexedDB ----------
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('produk-pos', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('products', { keyPath: 'barcode' });
      d.createObjectStore('prices', { keyPath: 'barcode' });
      d.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function store(name, mode = 'readonly') {
  return (await idb()).transaction(name, mode).objectStore(name);
}
const req = (r) =>
  new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// ---------- State ----------
let products = [];            // in-memory catalog for instant search
let prices = new Map();       // barcode -> price (Rp)
const cart = new Map();       // key -> {key, barcode, name, price, qty}
let manualSeq = 1;

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Catalog sync ----------
async function loadLocal() {
  products = await req((await store('products')).getAll());
  prices = new Map((await req((await store('prices')).getAll())).map((p) => [p.barcode, p.price]));
  const meta = await req((await store('meta')).get('lastSync'));
  $('lastSync').textContent = meta ? new Date(meta.v).toLocaleString('id-ID') : 'belum pernah';
  updateStats();
}

async function sync() {
  if (!navigator.onLine) return toast('Sedang offline — coba lagi saat online');
  $('syncBtn').disabled = true;
  $('syncBtn').classList.add('busy');
  try {
    const res = await fetch('../v1/export');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const s = await store('products', 'readwrite');
    for (const item of data.items) s.put(item);
    await new Promise((r) => (s.transaction.oncomplete = r));
    const m = await store('meta', 'readwrite');
    m.put({ k: 'lastSync', v: Date.now() });
    await loadLocal();
    toast(`Katalog tersinkron: ${data.count} produk`);
    renderResults($('q').value);
  } catch (e) {
    toast('Gagal sinkron: ' + e.message);
  } finally {
    $('syncBtn').disabled = false;
    $('syncBtn').classList.remove('busy');
  }
}

function updateStats() {
  $('statProducts').textContent = products.length.toLocaleString('id-ID');
  $('statPrices').textContent = prices.size.toLocaleString('id-ID');
}

// ---------- Search ----------
// Muted tint pairs [background, foreground] — professional, not rainbow.
const TINTS = [
  ['#E7F4EF', '#0A7D5F'], ['#EFF4FF', '#3538CD'], ['#FDF2FA', '#C11574'],
  ['#FFFAEB', '#B54708'], ['#F0F9FF', '#026AA2'], ['#F4F3FF', '#5925DC'],
];
const tintFor = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
};

const ICONS = {
  box: '<svg class="ico" viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8"/></svg>',
  search: '<svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  tag: '<svg class="ico" viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V4h7l10 8zM7.5 7.5h.01"/></svg>',
  receipt: '<svg class="ico" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0"/></svg>',
};

function emptyState(icon, title, body) {
  return `<div class="empty"><div class="empty-ico">${icon}</div><h4>${title}</h4><p>${body}</p></div>`;
}

function renderResults(query) {
  const box = $('results');
  const q = query.trim().toLowerCase();
  if (!products.length) {
    box.innerHTML = emptyState(ICONS.box, 'Katalog masih kosong',
      'Tekan tombol sinkron di kanan atas saat online untuk mengunduh katalog produk.');
    return;
  }
  let list;
  if (!q) {
    // No query: show items that already have prices (the merchant's active stock).
    list = products.filter((p) => prices.has(p.barcode)).slice(0, 30);
    if (!list.length) {
      box.innerHTML = emptyState(ICONS.tag, 'Mulai atur harga',
        'Cari produk lalu atur harga jualnya. Produk yang sudah punya harga akan tampil di sini.');
      return;
    }
  } else if (/^\d{6,}$/.test(q)) {
    list = products.filter((p) => p.barcode.includes(q)).slice(0, 20);
  } else {
    list = products
      .filter((p) => (`${p.name ?? ''} ${p.brand ?? ''}`).toLowerCase().includes(q))
      .slice(0, 30);
  }
  if (!list.length) {
    box.innerHTML = emptyState(ICONS.search, 'Tidak ditemukan',
      'Produk tidak ada di katalog. Gunakan “Item manual” di keranjang untuk barang di luar katalog.');
    return;
  }
  box.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'listcard';
  for (const p of list) {
    const el = document.createElement('button');
    el.className = 'prod';
    const name = p.name || '(tanpa nama)';
    const price = prices.get(p.barcode);
    const [bg, fg] = tintFor(p.barcode);
    el.innerHTML = `
      <span class="thumb" style="background:${bg};color:${fg}">${(p.brand || name).slice(0, 1).toUpperCase()}</span>
      <span class="info">
        <span class="name"></span>
        <span class="sub"></span>
      </span>
      <span class="pricechip ${price == null ? 'unset' : 'num'}">${price == null ? '+ Harga' : rupiah(price)}</span>`;
    el.querySelector('.name').textContent = name;
    el.querySelector('.sub').textContent = [p.brand, p.quantity, p.barcode].filter(Boolean).join(' · ');
    el.addEventListener('click', () => addProduct(p));
    card.appendChild(el);
  }
  box.appendChild(card);
}

// ---------- Cart ----------
function addProduct(p) {
  const price = prices.get(p.barcode);
  if (price == null) return askPrice(p);
  addLine({ key: p.barcode, barcode: p.barcode, name: p.name || p.barcode, price });
}

function addLine(line) {
  const existing = cart.get(line.key);
  if (existing) existing.qty += 1;
  else cart.set(line.key, { ...line, qty: 1 });
  renderCartSheet();
  toast(`+ ${line.name}`);
}

function renderCartBar() {
  let n = 0, total = 0;
  for (const it of cart.values()) { n += it.qty; total += it.qty * it.price; }
  $('cartN').textContent = n;
  $('cartAmt').textContent = rupiah(total);
  $('cartbar').classList.toggle('show', n > 0);
  return total;
}

function renderCartSheet() {
  const box = $('cartItems');
  box.innerHTML = '';
  if (cart.size === 0) {
    box.innerHTML = '<div class="cart-empty">Keranjang masih kosong.<br>Pilih produk untuk mulai transaksi.</div>';
  }
  for (const it of cart.values()) {
    const el = document.createElement('div');
    el.className = 'line-item';
    el.innerHTML = `
      <span class="info">
        <div class="name"></div>
        <div class="each">${rupiah(it.price)} / pcs</div>
      </span>
      <span class="qty">
        <button data-a="minus">−</button>
        <span class="q">${it.qty}</span>
        <button data-a="plus">+</button>
      </span>`;
    el.querySelector('.name').textContent = it.name;
    el.querySelector('[data-a=minus]').addEventListener('click', () => {
      it.qty -= 1;
      if (it.qty <= 0) cart.delete(it.key);
      renderCartSheet();
    });
    el.querySelector('[data-a=plus]').addEventListener('click', () => {
      it.qty += 1;
      renderCartSheet();
    });
    box.appendChild(el);
  }
  const manualBtn = document.createElement('button');
  manualBtn.className = 'btn ghost';
  manualBtn.textContent = '+ Item manual';
  manualBtn.addEventListener('click', () => $('manualDlg').showModal());
  box.appendChild(manualBtn);

  const total = renderCartBar();
  $('cartTotal').textContent = rupiah(total);
  updateChange();
  // Mobile only: the sheet closes when the cart empties (desktop keeps the
  // panel visible via CSS regardless of the .show class).
  if (cart.size === 0) $('cartSheet').classList.remove('show');
}

function updateChange() {
  let total = 0;
  for (const it of cart.values()) total += it.qty * it.price;
  const cash = Number($('cash').value);
  const el = $('change');
  if (!cash) { el.innerHTML = 'Kembalian: <b>—</b>'; return; }
  const diff = cash - total;
  el.innerHTML = diff >= 0
    ? `Kembalian: <b>${rupiah(diff)}</b>`
    : `Kurang: <b style="color:var(--red)">${rupiah(-diff)}</b>`;
}

async function checkout() {
  if (!cart.size) return;
  let total = 0;
  const items = [];
  for (const it of cart.values()) {
    total += it.qty * it.price;
    items.push({ barcode: it.barcode, name: it.name, price: it.price, qty: it.qty });
  }
  const cash = Number($('cash').value) || total;
  if (cash < total) return toast('Uang tunai kurang dari total');
  const s = await store('sales', 'readwrite');
  s.add({ ts: Date.now(), total, cash, change: cash - total, items });
  await new Promise((r) => (s.transaction.oncomplete = r));
  cart.clear();
  $('cash').value = '';
  renderCartSheet();
  $('cartSheet').classList.remove('show');
  toast(`Tersimpan · ${rupiah(total)} · kembalian ${rupiah(cash - total)}`);
  renderSales();
}

// ---------- Price dialog ----------
let pendingProduct = null;
function askPrice(p) {
  pendingProduct = p;
  $('priceDlgName').textContent = p.name || p.barcode;
  $('priceInput').value = '';
  $('priceDlg').showModal();
}
async function savePrice() {
  const price = Number($('priceInput').value);
  if (!price || price <= 0) return toast('Masukkan harga yang valid');
  const p = pendingProduct;
  $('priceDlg').close();
  const s = await store('prices', 'readwrite');
  s.put({ barcode: p.barcode, price });
  prices.set(p.barcode, price);
  updateStats();
  addLine({ key: p.barcode, barcode: p.barcode, name: p.name || p.barcode, price });
  renderResults($('q').value);
}

// ---------- Sales history ----------
async function renderSales() {
  const sales = (await req((await store('sales')).getAll())).reverse();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  let today = 0, count = 0;
  const box = $('salesList');
  box.innerHTML = sales.length ? '' : emptyState(ICONS.receipt, 'Belum ada transaksi',
    'Transaksi yang kamu simpan dari layar Kasir akan tercatat di sini.');
  for (const s of sales) {
    if (s.ts >= start.getTime()) { today += s.total; count += 1; }
    const el = document.createElement('div');
    el.className = 'sale';
    el.innerHTML = `
      <div class="top"><b>${rupiah(s.total)}</b>${new Date(s.ts).toLocaleString('id-ID')}</div>
      <div class="items"></div>`;
    el.querySelector('.items').textContent =
      s.items.map((i) => `${i.qty}× ${i.name}`).join(', ');
    box.appendChild(el);
  }
  $('statToday').textContent = rupiah(today);
  $('statCount').textContent = count;
}

async function exportCsv() {
  const sales = await req((await store('sales')).getAll());
  if (!sales.length) return toast('Belum ada transaksi');
  const rows = [['waktu', 'barcode', 'nama', 'harga', 'qty', 'subtotal', 'total_transaksi']];
  for (const s of sales) {
    for (const i of s.items) {
      rows.push([
        new Date(s.ts).toISOString(), i.barcode ?? '', i.name,
        i.price, i.qty, i.price * i.qty, s.total,
      ]);
    }
  }
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `penjualan-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Barcode scanning ----------
let scanStream = null, scanTimer = null;
async function startScan() {
  if (!('BarcodeDetector' in window)) {
    toast('Kamera scanner tidak didukung browser ini — ketik barcode di kolom cari');
    $('q').focus();
    return;
  }
  $('scanModal').classList.add('show');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    const video = $('scanVideo');
    video.srcObject = scanStream;
    await video.play();
    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
    });
    scanTimer = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          const code = codes[0].rawValue;
          stopScan();
          const p = products.find((x) => x.barcode === code);
          if (p) addProduct(p);
          else {
            $('q').value = code;
            renderResults(code);
            toast(`Barcode ${code} tidak ada di katalog`);
          }
        }
      } catch { /* frame not ready yet */ }
    }, 250);
  } catch (e) {
    $('scanMsg').textContent = 'Tidak bisa mengakses kamera: ' + e.message;
  }
}
function stopScan() {
  clearInterval(scanTimer);
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
  $('scanModal').classList.remove('show');
}

// ---------- Online indicator ----------
function updateNet() {
  $('netLabel').textContent = navigator.onLine ? 'Online' : 'Offline';
  $('net').classList.toggle('online', navigator.onLine);
}

// ---------- Wire up ----------
$('q').addEventListener('input', (e) => renderResults(e.target.value));
$('q').addEventListener('keydown', (e) => {
  // Keyboard-wedge barcode scanners type digits then Enter.
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    const p = products.find((x) => x.barcode === v);
    if (p) { addProduct(p); e.target.value = ''; renderResults(''); }
  }
});
$('scanBtn').addEventListener('click', startScan);
$('closeScan').addEventListener('click', stopScan);
$('syncBtn').addEventListener('click', sync);
$('cartbar').addEventListener('click', () => { renderCartSheet(); $('cartSheet').classList.add('show'); });
$('closeCart').addEventListener('click', () => $('cartSheet').classList.remove('show'));
$('clearCart').addEventListener('click', () => { cart.clear(); renderCartSheet(); $('cartSheet').classList.remove('show'); });
$('payBtn').addEventListener('click', checkout);
$('cash').addEventListener('input', updateChange);
$('priceOk').addEventListener('click', savePrice);
$('priceCancel').addEventListener('click', () => $('priceDlg').close());
$('manualOk').addEventListener('click', () => {
  const name = $('manualName').value.trim();
  const price = Number($('manualPrice').value);
  if (!name || !price || price <= 0) return toast('Isi nama dan harga');
  $('manualDlg').close();
  addLine({ key: 'manual-' + manualSeq++, barcode: null, name, price });
  renderCartSheet();
  $('manualName').value = ''; $('manualPrice').value = '';
});
$('manualCancel').addEventListener('click', () => $('manualDlg').close());
$('csvBtn').addEventListener('click', exportCsv);

for (const btn of document.querySelectorAll('nav button')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    $('screen-' + btn.dataset.screen).classList.add('active');
    if (btn.dataset.screen === 'riwayat') renderSales();
  });
}

window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

// ---------- Boot ----------
updateNet();
loadLocal().then(() => { renderResults(''); renderSales(); renderCartSheet(); });
// Desktop: the cart panel is always visible and the keyboard is primary.
if (window.matchMedia('(min-width: 1024px)').matches) $('q').focus();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
