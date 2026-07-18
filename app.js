"use strict";

/* ===================== Supabase sync (for Telegram alerts) ===================== */
const SUPABASE_URL = "https://ovwauqqwwsoyilsshzta.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92d2F1cXF3d3NveWlsc3NoenRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTk0MDQsImV4cCI6MjA4OTI3NTQwNH0.JbP-1n2pwtSI5LIV7LLAUfhpGUFG3pEsI2AFVcuuslg";

let sb = null;
if (SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20 && window.supabase) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function toRemoteItem(item) {
  return {
    id: item.id,
    name: item.name,
    category_id: item.categoryId || null,
    quantity: item.quantity || null,
    date_type: item.dateType || null,
    expiry_date: item.expiryDate || null,
    notes: item.notes || null,
    barcode: item.barcode || null,
    added_at: item.addedAt || null,
    updated_at: item.updatedAt || null,
    notified_amber: false, 
  };
}

async function syncItemRemote(item) {
  if (!sb || !navigator.onLine) return;
  try { await sb.from("scadenzario_items").upsert(toRemoteItem(item)); } catch (e) { /* best-effort */ }
}
async function syncItemDeleteRemote(id) {
  if (!sb || !navigator.onLine) return;
  try { await sb.from("scadenzario_items").delete().eq("id", id); } catch (e) { /* best-effort */ }
}

async function syncCategoryRemote(cat) {
  if (!sb || !navigator.onLine) return;
  try { 
    await sb.from("scadenzario_categories").upsert({ 
      id: cat.id, 
      name: cat.name, 
      order: cat.order,
      updated_at: cat.updatedAt || Date.now(),
      is_deleted: cat.isDeleted || false
    }); 
  } catch (e) { /* best-effort */ }
}

async function pullRemoteMerge() {
  if (!sb || !navigator.onLine) return;
  try {
    const { data: remoteCats, error: e1 } = await sb.from("scadenzario_categories").select("*");
    if (!e1 && remoteCats) {
      for (const rc of remoteCats) {
        const local = await getOne("categories", rc.id);
        const remoteUpdated = rc.updated_at || 0;
        const localUpdated = local ? (local.updatedAt || 0) : -1;
        
        if (!local || remoteUpdated > localUpdated) {
          await put("categories", { 
            id: rc.id, 
            name: rc.name, 
            order: rc.order,
            updatedAt: remoteUpdated,
            isDeleted: rc.is_deleted || false
          });
        }
      }
    }
    const { data: remoteItems, error: e2 } = await sb.from("scadenzario_items").select("*");
    if (!e2 && remoteItems) {
      for (const ri of remoteItems) {
        const local = await getOne("items", ri.id);
        const remoteUpdated = ri.updated_at || 0;
        const localUpdated = local ? (local.updatedAt || 0) : -1;
        if (!local || remoteUpdated > localUpdated) {
          await put("items", {
            id: ri.id,
            name: ri.name,
            categoryId: ri.category_id,
            quantity: ri.quantity || "",
            dateType: ri.date_type || "entro",
            expiryDate: ri.expiry_date,
            notes: ri.notes || "",
            barcode: ri.barcode || null,
            addedAt: ri.added_at || Date.now(),
            updatedAt: ri.updated_at || Date.now(),
          });
        }
      }
    }
  } catch (e) { /* best-effort */ }
}

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
async function getOne(storeName, id) {
  const store = await tx(storeName, "readonly");
  return reqToPromise(store.get(id));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function seedDefaultsIfEmpty() {
  const cats = await getAll("categories");
  if (cats.length === 0) {
    const defaults = ["Frigo", "Freezer", "Dispensa"];
    for (let i = 0; i < defaults.length; i++) {
      await put("categories", { 
        id: uid(), 
        name: defaults[i], 
        order: i, 
        updatedAt: Date.now(), 
        isDeleted: false 
      });
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
  if (days < 3) return "red";
  if (days <= 9) return "amber";
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

  state.categories
    .filter(c => !c.isDeleted)
    .sort((a, b) => a.order - b.order)
    .forEach(cat => {
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
    { key: "red", label: "Da consumare subito" },
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

// MODIFICATA: Popola la select escludendo le categorie eliminate
function populateCategorySelect() {
  itemCategory.innerHTML = "";
  state.categories
    .filter(c => !c.isDeleted)
    .sort((a, b) => a.order - b.order)
    .forEach(cat => {
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
    itemCategory.value = state.categories.filter(c => !c.isDeleted)[0] ? state.categories.filter(c => !c.isDeleted)[0].id : "";
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
  syncItemRemote(obj);
  await loadAll();
  closeItemSheet();
  showToast(itemId.value ? "Alimento aggiornato" : "Alimento aggiunto");
};

deleteItemBtn.onclick = async () => {
  if (!itemId.value) return;
  await del("items", itemId.value);
  syncItemDeleteRemote(itemId.value);
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

// MODIFICATA: Mostra nel pannello solo categorie attive
function renderCatList() {
  catList.innerHTML = "";
  state.categories
    .filter(c => !c.isDeleted)
    .sort((a, b) => a.order - b.order)
    .forEach(cat => {
      const row = document.createElement("div");
      row.className = "cat-edit-row";
      const count = state.items.filter(i => i.categoryId === cat.id).length;
      row.innerHTML = `
        <input type="text" value="${escapeHtml(cat.name)}" data-id="${cat.id}">
        <span style="font-size:12px; color:var(--ink-soft); flex-shrink:0;">${count}</span>
        <button class="icon-btn" data-del="${cat.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>`;
      catList.appendChild(row);
    });

  catList.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("change", async () => {
      const cat = state.categories.find(c => c.id === inp.dataset.id);
      if (cat && inp.value.trim()) {
        cat.name = inp.value.trim();
        cat.updatedAt = Date.now();
        await put("categories", cat);
        syncCategoryRemote(cat);
        await loadAll();
        renderCatList();
      }
    });
  });
  
  // MODIFICATO: Pulsante di eliminazione logica
  catList.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.del;
      const count = state.items.filter(i => i.categoryId === id).length;
      if (count > 0 && !confirm(`${count} alimenti sono in questa categoria e diventeranno "Senza categoria". Continuare?`)) {
        return;
      }
      
      const cat = state.categories.find(c => c.id === id);
      if (cat) {
        cat.isDeleted = true;
        cat.updatedAt = Date.now();
        await put("categories", cat);
        syncCategoryRemote(cat);
      }
      
      const affected = state.items.filter(i => i.categoryId === id);
      for (const it of affected) {
        it.categoryId = null;
        it.updatedAt = Date.now();
        await put("items", it);
        syncItemRemote(it);
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
  const newCat = { 
    id: uid(), 
    name, 
    order: maxOrder + 1, 
    updatedAt: Date.now(), 
    isDeleted: false 
  };
  await put("categories", newCat);
  syncCategoryRemote(newCat);
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

let torchOn = false;
document.getElementById("scannerTorch").onclick = async () => {
  const track = scannerVideo.srcObject && scannerVideo.srcObject.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
  } catch (e) {
    torchOn = !torchOn;
  }
};

async function startScanner() {
  if (typeof ZXing === "undefined") {
    showToast("Libreria di scansione non disponibile");
    return;
  }
  scannerView.style.display = "flex";
  scannerStatus.textContent = "Tocca lo schermo per rimettere a fuoco";
  try {
    const { DecodeHintType, BarcodeFormat, BrowserMultiFormatReader } = window.ZXing;

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    zxingReader = new BrowserMultiFormatReader(hints, 150);

    let deviceId = undefined;
    try {
      const inputs = await navigator.mediaDevices.enumerateDevices();
      const cams = inputs.filter(d => d.kind === "videoinput");
      const macro = cams.find(d => /macro/i.test(d.label));
      const back = cams.find(d => /back|rear|environment/i.test(d.label));
      deviceId = (macro || back) ? (macro || back).deviceId : (cams[cams.length - 1] && cams[cams.length - 1].deviceId);
    } catch (e) { }

    scannerVideo.addEventListener("loadedmetadata", enableCameraExtras, { once: true });

    await zxingReader.decodeFromConstraints(
      {
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }),
        },
      },
      scannerVideo,
      (result, err) => {
        if (result) handleScanResult(result.getText());
      }
    );
  } catch (e) {
    console.error(e);
    showToast("Impossibile accedere alla fotocamera");
    stopScanner();
  }
}

function enableCameraExtras() {
  const track = scannerVideo.srcObject && scannerVideo.srcObject.getVideoTracks()[0];
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  const advanced = {};
  if (caps.focusMode && caps.focusMode.includes("continuous")) advanced.focusMode = "continuous";
  if (Object.keys(advanced).length) {
    track.applyConstraints({ advanced: [advanced] }).catch(() => {});
  }
  if (caps.torch) {
    document.getElementById("scannerTorch").style.display = "flex";
  }
}

scannerVideo.addEventListener("click", () => {
  const track = scannerVideo.srcObject && scannerVideo.srcObject.getVideoTracks()[0];
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  if (!caps.focusMode) return;
  if (caps.focusMode.includes("single-shot")) {
    track.applyConstraints({ advanced: [{ focusMode: "single-shot" }] })
      .then(() => {
        setTimeout(() => {
          if (caps.focusMode.includes("continuous")) {
            track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
          }
        }, 600);
      })
      .catch(() => {});
  }
});

function stopScanner() {
  scannerView.style.display = "none";
  torchOn = false;
  document.getElementById("scannerTorch").style.display = "none";
  scannerVideo.removeEventListener("loadedmetadata", enableCameraExtras);
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
      document.getElementById("productHint").textContent = "Prodotto non trovato: inserisci nome e categoria manualmente.";
      document.getElementById("productHint").className = "product-hint warn";
    }
  } catch (e) {
    document.getElementById("productHint").textContent = "Ricerca non riuscita: inserisci i dati manualmente.";
    document.getElementById("productHint").className = "product-hint warn";
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
  if (sb && navigator.onLine) {
    await pullRemoteMerge();
  }
  await seedDefaultsIfEmpty();
  await loadAll();
  updateOnlineStatus();

  if (sb && navigator.onLine) {
    state.categories.forEach(syncCategoryRemote);
    state.items.forEach(syncItemRemote);
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

init();
