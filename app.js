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

// MODIFICATA: Invia lo stato completo della categoria incluso updated_at e is_deleted
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

// ELIMINATA LA VECCHIA FUNZIONE DI CANCELLAZIONE FISICA REMOTA
// La cancellazione ora usa semplicemente syncCategoryRemote marcando l'oggetto come eliminato.

// MODIFICATA: Gestisce l'unione intelligente basata sui timestamp anche per le categorie
async function pullRemoteMerge() {
  if (!sb || !navigator.onLine) return;
  try {
    const { data: remoteCats, error: e1 } = await sb.from("scadenzario_categories").select("*");
    if (!e1 && remoteCats) {
      for (const rc of remoteCats) {
        const local = await getOne("categories", rc.id);
        const remoteUpdated = rc.updated_at || 0;
        const localUpdated = local ? (local.updatedAt || 0) : -1;
        
        // Aggiorna in locale solo se il dato remoto è più recente
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

/* ===================== DB layer e State restano uguali, tranne loadAll ===================== */

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

/* ===================== Rendering ===================== */
// MODIFICATA: Filtra le categorie escludendo quelle marcate come eliminate in locale
function renderChips() {
  chipRow.innerHTML = "";
  const allCount = state.items.length;
  chipRow.appendChild(makeChip("all", "Tutti", allCount, state.filterCategory === "all"));

  state.categories
    .filter(c => !c.isDeleted) // <-- Evita di mostrare le categorie eliminate
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

/* ===================== Item sheet ===================== */
// MODIFICATA: Popola la select escludendo le categorie eliminate
function populateCategorySelect() {
  itemCategory.innerHTML = "";
  state.categories
    .filter(c => !c.isDeleted) // <-- Mostra solo categorie attive
    .sort((a, b) => a.order - b.order)
    .forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      itemCategory.appendChild(opt);
    });
}

/* ===================== Category manager ===================== */
// MODIFICATA: Mostra nel pannello di gestione solo le categorie attive
function renderCatList() {
  catList.innerHTML = "";
  state.categories
    .filter(c => !c.isDeleted) // <-- Solo categorie attive
    .sort((a, b) => a.order - b.order)
    .forEach(cat => {
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
        cat.updatedAt = Date.now(); // Traccia la modifica
        await put("categories", cat);
        syncCategoryRemote(cat);
        await loadAll();
        renderCatList();
      }
    });
  });
  
  // MODIFICATO: Il pulsante elimina ora fa un Soft Delete (isDeleted = true)
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
        await put("categories", cat); // Aggiorna sul database locale marcandola come rimossa
        syncCategoryRemote(cat); // Notifica a Supabase lo stato "eliminata"
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

/* ===================== Load / init ===================== */
// MODIFICATA: Si assicura che lo stato contenga tutte le categorie (anche quelle cancellate)
// per permettere il confronto corretto dei timestamp durante il pull.
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
    // MODIFICATA: Sincronizza lo stato (incluse le categorie rimosse in locale)
    state.categories.forEach(syncCategoryRemote);
    state.items.forEach(syncItemRemote);
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

init();
