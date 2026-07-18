// Vercel Cron Job endpoint. Controlla ogni giorno gli alimenti che sono appena entrati
// nella fascia "in scadenza" (3-9 giorni) e non sono stati ancora segnalati, e manda
// un messaggio Telegram per ciascuno.

module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    res.status(500).json({ error: "Variabili d'ambiente mancanti su Vercel" });
    return;
  }

  try {
    const listResp = await fetch(
      `${SUPABASE_URL}/rest/v1/scadenzario_items?notified_amber=eq.false&expiry_date=not.is.null&select=id,name,expiry_date,quantity`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!listResp.ok) {
      const t = await listResp.text();
      res.status(502).json({
        error: "Errore lettura Supabase",
        detail: t,
        debug_url: SUPABASE_URL,
        debug_key_len: SUPABASE_SERVICE_ROLE_KEY.length,
      });
      return;
    }
    const items = await listResp.json();

    // debug: conta anche senza filtri, per capire se il problema è il filtro o la connessione
    const debugAll = await fetch(`${SUPABASE_URL}/rest/v1/scadenzario_items?select=id,name,expiry_date,notified_amber`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    const debugAllItems = debugAll.ok ? await debugAll.json() : await debugAll.text();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const toNotify = items.filter((item) => {
      const target = new Date(item.expiry_date + "T00:00:00");
      const days = Math.round((target - today) / 86400000);
      return days >= 0 && days <= 9; // entrato nella fascia "in scadenza" (o già oltre, se il cron ha saltato un giorno)
    });

    const notifiedIds = [];
    for (const item of toNotify) {
      const target = new Date(item.expiry_date + "T00:00:00");
      const days = Math.round((target - today) / 86400000);
      const dateLabel = target.toLocaleDateString("it-IT", { day: "numeric", month: "long" });
      const dayWord = days === 0 ? "oggi" : days === 1 ? "domani" : `tra ${days} giorni`;
      const text = `🟠 Scadenzario: "${item.name}"${item.quantity ? ` (${item.quantity})` : ""} scade ${dayWord} (${dateLabel}).`;

      const tgResp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      });
      if (tgResp.ok) notifiedIds.push(item.id);
    }

    for (const id of notifiedIds) {
      await fetch(`${SUPABASE_URL}/rest/v1/scadenzario_items?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ notified_amber: true }),
      });
    }

    res.status(200).json({ checked: items.length, notified: notifiedIds.length, debug_all_rows: debugAllItems });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
