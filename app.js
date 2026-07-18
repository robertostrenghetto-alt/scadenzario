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

/* ===================== DB layer (REINSERITO CORRETTAMENTE) ===================== */
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
