"use strict";

/* ===================== DB layer ===================== */
const DB_NAME = "scadenzarioDB";
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("categories")) {
        db.createObjectStore("categories", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("items")) {
        const store = db.createObjectStore("items", { keyPath: "id" });
        store.createIndex("categoryId", "categoryId");
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName) {
  const store = await tx(storeName, "readonly");
  return reqToPromise(store.getAll());
}
async function put(storeName, obj) {
  const store = await tx(storeName, "readwrite");
  return reqToPromise(store.put(obj));
}
async function del(storeName, id) {
  const store = await tx(storeName, "readwrite");
  return reqToPromise(store.delete(id));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function seedDefaultsIfEmpty() {
  const cats = await getAll("categories");
  if (cats.length === 0) {
    const defaults = ["Frigo", "Freezer", "Dispensa"];
    for (let i = 0; i < defaults.length; i++) {
      await put("categories", { id: uid(), name: defaults[i], order: i });
    }
  }
}

/* ===================== State ===================== */
let state = {
  categories: [],
  items: [],
  filterCategory: "all",
  search: "",
  scannerControls: null,
};

/* ===================== Date helpers ===================== */
function todayLocal() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}
function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = parseDateStr(dateStr);
  return Math.round((target - todayLocal()) / 86400000);
}
function formatDateStr(dateStr) {
  if (!dateStr) return "";
  const d = parseDateStr(dateStr);
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}
function statusFromDays(days) {
  if (days === null) return "none";
  if (days < 0) return "red";
  if (days <= 3) return "amber";
  return "ok";
}
function statusLabel(days) {
  if (days === null) return "Nessuna data";
  if (days < 0) return `Scaduto da ${Math.abs(days)} g`;
  if (days === 0) return "Scade oggi";
  if (days === 1) return "Scade domani";
  if (days <= 3) return `Scade tra ${days} g`;
  return `Scade ${formatDateStrShort(days)}`;
}
function formatDateStrShort(days) {
  return "il " + formatDateStr(addDaysToTodayStr(days));
}
function addDaysToTodayStr(days) {
  const t = todayLocal();
  t.setDate(t.getDate() + days);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/* ===================== Rendering ===================== */
const chipRow = document.getElementById("chipRow");
const listEl = document.getElementById("list");
const subtitle = document.getElementById("subtitle");

function categoryName(id) {
  const c = state.categories.find(c => c.id === id);
  return c ? c.name : "Senza categoria";
}

function renderChips() {
  chipRow.innerHTML = "";
  const allCount = state.items.length;
  chipRow.appendChild(makeChip("all", "Tutti", allCount, state.filterCategory === "all"));

  state.categories.sort((a, b) => a.order - b.order).forEach(cat => {
    const count = state.items.filter(i => i.categoryId === cat.id).length;
    chipRow.appendChild(makeChip(cat.id, cat.name, count, state.filterCategory === cat.id));
  });

  const gear = document.createElement("button");
  gear.className = "chip add-chip";
  gear.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Categorie`;
  gear.onclick = openCategoryManager;
  chipRow.appendChild(gear);
}

function makeChip(id, name, count, active) {
  const chip = document.createElement("button");
  chip.className = "chip" + (active ? " active" : "");
  chip.innerHTML = `${escapeHtml(name)} <span class="count">${count}</span>`;
  chip.onclick = () => { state.filterCategory = id; renderChips(); renderList(); };
  return chip;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function getFilteredItems() {
  let items = state.items.slice();
  if (state.filterCategory !== "all") {
    items = items.filter(i => i.categoryId === state.filterCategory);
  }
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    items = items.filter(i => (i.name || "").toLowerCase().includes(q) || (i.brand || "").toLowerCase().includes(q));
  }
  return items;
}

function renderList() {
  const items = getFilteredItems();
  subtitle.textContent = `${state.items.length} alimenti in casa`;

  if (state.items.length === 0) {
    listEl.innerHTML = emptyStateHtml("La dispensa è vuota", "Aggiungi il primo alimento con il pulsante + qui sotto, oppure scansiona un codice a barre.");
    return;
  }
  if (items.length === 0) {
    listEl.innerHTML = emptyStateHtml("Nessun risultato", "Prova a cambiare categoria o termine di ricerca.");
    return;
  }

  const withStatus = items.map(i => {
    const days = daysUntil(i.expiryDate);
    return { item: i, days, status: statusFromDays(days) };
  });

  const order = { red: 0, amber: 1, ok: 2, none: 3 };
  withStatus.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    if (a.days === null) return 1;
    if (b.days === null) return -1;
    return a.days - b.days;
  });

  const sections = [
    { key: "red", label: "Scaduti" },
    { key: "amber", label: "In scadenza" },
    { key: "ok", label: "A posto" },
    { key: "none", label: "Senza scadenza" },
  ];

  let html = "";
  sections.forEach(sec => {
    const group = withStatus.filter(x => x.status === sec.key);
    if (group.length === 0) return;
    html += `<div class="section-label">${sec.label} · ${group.length}</div>`;
    group.forEach(({ item, days, status }) => {
      html += itemCardHtml(item, days, status);
    });
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll(".item-card").forEach(card => {
    card.onclick = () => openItemSheet(card.dataset.id);
  });
}

function emptyStateHtml(title, body) {
  return `<div class="empty-state">
    <div class="display">${escapeHtml(title)}</div>
    <p>${escapeHtml(body)}</p>
  </div>`;
}

function itemCardHtml(item, days, status) {
  const metaBits = [categoryName(item.categoryId)];
  if (item.quantity) metaBits.push(item.quantity);
  return `
  <div class="item-card" data-id="${item.id}">
    <div class="status-dot ${status}"></div>
    <div class="item-main">
      <div class="item-name">${escapeHtml(item.name)}</div>
      <div class="item-meta">${metaBits.map(escapeHtml).join(" · ")}</div>
    </div>
    <div class="badge ${status}">${statusLabel(days)}</div>
  </div>`;
}

/* ===================== Item sheet ===================== */
const itemBackdrop = document.getElementById("itemBackdrop");
const itemSheetTitle = document.getElementById("itemSheetTitle");
const itemName = document.getElementById("itemName");
const itemCategory = document.getElementById("itemCategory");
const itemQty = document.getElementById("itemQty");
const itemDate = document.getElementById("itemDate");
const itemNotes = document.getElementById("itemNotes");
const itemId = document.getElementById("itemId");
const itemBarcode = document.getElementById("itemBarcode");
const dateTypeSeg = document.getElementById("dateTypeSeg");
const deleteItemBtn = document.getElementById("deleteItemBtn");
const productHint = document.getElementById("productHint");

let currentDateType = "entro";

function populateCategorySelect() {
  itemCategory.innerHTML = "";
  state.categories.sort((a, b) => a.order - b.order).forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.name;
    itemCategory.appendChild(opt);
  });
}

function openItemSheet(id) {
  populateCategorySelect();
  productHint.style.display = "none";
  productHint.className = "product-hint";

  if (id) {
    const item = state.items.find(i => i.id === id);
    itemSheetTitle.textContent = "Modifica alimento";
    itemId.value = item.id;
    itemName.value = item.name || "";
    itemCategory.value = item.categoryId || "";
    itemQty.value = item.quantity || "";
    itemDate.value = item.expiryDate || "";
    itemNotes.value = item.notes || "";
    itemBarcode.value = item.barcode || "";
    setDateType(item.dateType || "entro");
    deleteItemBtn.style.display = "block";
  } else {
    itemSheetTitle.textContent = "Nuovo alimento";
    itemId.value = "";
    itemName.value = "";
    itemCategory.value = state.categories[0] ? state.categories[0].id : "";
    itemQty.value = "";
    itemDate.value = "";
    itemNotes.value = "";
    itemBarcode.value = "";
    setDateType("entro");
    deleteItemBtn.style.display = "none";
  }
  itemBackdrop.classList.add("open");
}

function closeItemSheet() {
  itemBackdrop.classList.remove("open");
}

function setDateType(val) {
  currentDateType = val;
  dateTypeSeg.querySelectorAll("button").forEach(b => {
    b.classList.toggle("active", b.dataset.val === val);
  });
}
dateTypeSeg.querySelectorAll("button").forEach(b => {
  b.onclick = () => setDateType(b.dataset.val);
});

itemBackdrop.addEventListener("click", (e) => {
  if (e.target === itemBackdrop) closeItemSheet();
});

document.getElementById("saveItemBtn").onclick = async () => {
  const name = itemName.value.trim();
  if (!name) {
    itemName.focus();
    showToast("Dai un nome all'alimento");
    return;
  }
  const obj = {
    id: itemId.value || uid(),
    name,
    categoryId: itemCategory.value || null,
    quantity: itemQty.value.trim(),
    dateType: currentDateType,
    expiryDate: itemDate.value || null,
    notes: itemNotes.value.trim(),
    barcode: itemBarcode.value || null,
    addedAt: itemId.value ? (state.items.find(i => i.id === itemId.value)?.addedAt || Date.now()) : Date.now(),
    updatedAt: Date.now(),
  };
  await put("items", obj);
  await loadAll();
  closeItemSheet();
  showToast(itemId.value ? "Alimento aggiornato" : "Alimento aggiunto");
};

deleteItemBtn.onclick = async () => {
  if (!itemId.value) return;
  await del("items", itemId.value);
  await loadAll();
  closeItemSheet();
  showToast("Alimento eliminato");
};

document.getElementById("fabAdd").onclick = () => openItemSheet(null);

/* ===================== Search ===================== */
document.getElementById("searchInput").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderList();
});

/* ===================== Category manager ===================== */
const catBackdrop = document.getElementById("catBackdrop");
const catList = document.getElementById("catList");

function openCategoryManager() {
  renderCatList();
  catBackdrop.classList.add("open");
}
catBackdrop.addEventListener("click", (e) => {
  if (e.target === catBackdrop) catBackdrop.classList.remove("open");
});

function renderCatList() {
  catList.innerHTML = "";
  state.categories.sort((a, b) => a.order - b.order).forEach(cat => {
    const row = document.createElement("div");
    row.className = "cat-edit-row";
    const count = state.items.filter(i => i.categoryId === cat.id).length;
    row.innerHTML = `
      <input type="text" value="${escapeHtml(cat.name)}" data-id="${cat.id}">
      <span style="font-size:12px; color:var(--ink-soft); flex-shrink:0;">${count}</span>
      <button class="icon-btn" data-del="${cat.id}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>`;
    catList.appendChild(row);
  });

  catList.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("change", async () => {
      const cat = state.categories.find(c => c.id === inp.dataset.id);
      if (cat && inp.value.trim()) {
        cat.name = inp.value.trim();
        await put("categories", cat);
        await loadAll();
        renderCatList();
      }
    });
  });
  catList.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.del;
      const count = state.items.filter(i => i.categoryId === id).length;
      if (count > 0 && !confirm(`${count} alimenti sono in questa categoria e diventeranno "Senza categoria". Continuare?`)) {
        return;
      }
      await del("categories", id);
      const affected = state.items.filter(i => i.categoryId === id);
      for (const it of affected) {
        it.categoryId = null;
        await put("items", it);
      }
      await loadAll();
      renderCatList();
    };
  });
}

document.getElementById("addCatBtn").onclick = async () => {
  const input = document.getElementById("newCatName");
  const name = input.value.trim();
  if (!name) return;
  const maxOrder = state.categories.reduce((m, c) => Math.max(m, c.order), -1);
  await put("categories", { id: uid(), name, order: maxOrder + 1 });
  input.value = "";
  await loadAll();
  renderCatList();
};

/* ===================== Barcode scanner ===================== */
const scannerView = document.getElementById("scannerView");
const scannerVideo = document.getElementById("scannerVideo");
const scannerStatus = document.getElementById("scannerStatus");
let zxingReader = null;

document.getElementById("scanBtn").onclick = startScanner;
document.getElementById("scannerClose").onclick = stopScanner;

async function startScanner() {
  if (typeof ZXingBrowser === "undefined" && typeof ZXing === "undefined") {
    showToast("Libreria di scansione non disponibile");
    return;
  }
  scannerView.style.display = "flex";
  scannerStatus.textContent = "Cerco il codice…";
  try {
    const ReaderCtor = (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader) || window.ZXing.BrowserMultiFormatReader;
    zxingReader = new ReaderCtor();
    let deviceId = undefined;
    try {
      const inputs = await navigator.mediaDevices.enumerateDevices();
      const cams = inputs.filter(d => d.kind === "videoinput");
      const back = cams.find(d => /back|rear|environment/i.test(d.label));
      deviceId = back ? back.deviceId : (cams[cams.length - 1] && cams[cams.length - 1].deviceId);
    } catch (e) { /* ignore */ }

    zxingReader.decodeFromConstraints(
      { video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" } },
      scannerVideo,
      (result, err, controls) => {
        state.scannerControls = controls;
        if (result) {
          handleScanResult(result.getText());
        }
      }
    );
  } catch (e) {
    console.error(e);
    showToast("Impossibile accedere alla fotocamera");
    stopScanner();
  }
}

function stopScanner() {
  scannerView.style.display = "none";
  if (state.scannerControls) {
    try { state.scannerControls.stop(); } catch (e) {}
    state.scannerControls = null;
  }
  if (zxingReader && zxingReader.reset) {
    try { zxingReader.reset(); } catch (e) {}
  }
  if (scannerVideo.srcObject) {
    scannerVideo.srcObject.getTracks().forEach(t => t.stop());
    scannerVideo.srcObject = null;
  }
}

async function handleScanResult(code) {
  scannerStatus.textContent = "Trovato: " + code;
  stopScanner();
  itemBarcode.value = code;
  if (!itemBackdrop.classList.contains("open")) {
    openItemSheet(null);
    itemBarcode.value = code;
  }
  await lookupProduct(code);
}

async function lookupProduct(code) {
  if (!navigator.onLine) {
    productHint.style.display = "flex";
    productHint.className = "product-hint warn";
    productHint.textContent = "Sei offline: inserisci i dati del prodotto manualmente.";
    return;
  }
  productHint.style.display = "flex";
  productHint.className = "product-hint";
  productHint.textContent = "Cerco il prodotto…";
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
    const data = await res.json();
    if (data && data.status === 1 && data.product) {
      const p = data.product;
      const name = p.product_name_it || p.product_name || "";
      const brand = p.brands || "";
      if (name) itemName.value = brand ? `${name}` : name;
      productHint.textContent = `Trovato: ${name || "prodotto"}${brand ? " · " + brand : ""}`;
      productHint.className = "product-hint";
    } else {
      productHint.textContent = "Prodotto non trovato: inserisci nome e categoria manualmente.";
      productHint.className = "product-hint warn";
    }
  } catch (e) {
    productHint.textContent = "Ricerca non riuscita: inserisci i dati manualmente.";
    productHint.className = "product-hint warn";
  }
}

/* ===================== Toast ===================== */
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ===================== Offline pill ===================== */
function updateOnlineStatus() {
  const pill = document.getElementById("offlinePill");
  pill.style.display = navigator.onLine ? "none" : "inline-flex";
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

/* ===================== Topbar scroll shadow ===================== */
window.addEventListener("scroll", () => {
  document.getElementById("topbar").classList.toggle("scrolled", window.scrollY > 4);
});

/* ===================== Load / init ===================== */
async function loadAll() {
  state.categories = await getAll("categories");
  state.items = await getAll("items");
  renderChips();
  renderList();
}

async function init() {
  await seedDefaultsIfEmpty();
  await loadAll();
  updateOnlineStatus();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

init();
