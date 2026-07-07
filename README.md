# Scadenzario

App web (PWA) per tenere traccia degli alimenti in frigo, freezer e dispensa, con scansione codici a barre e scadenze. Funziona completamente offline dopo la prima apertura.

## Pubblicare su Vercel

1. Crea un nuovo progetto su vercel.com (o `vercel --prod` da riga di comando se hai la CLI)
2. Carica questa cartella così com'è (è un sito statico, non serve nessuna build: framework preset "Other", build command vuoto, output directory `.`)
3. Vercel ti darà un URL tipo `scadenzario.vercel.app`

In alternativa puoi trascinare la cartella su [vercel.com/new](https://vercel.com/new) con drag & drop.

## Installarla sul telefono Android

1. Apri l'URL con Chrome
2. Tocca il menu (⋮) in alto a destra → **"Aggiungi a schermata Home"** (o comparirà un banner automatico "Installa app")
3. Da quel momento l'app ha un'icona propria e si apre a schermo intero, senza barra del browser

## Come funziona offline

- Tutti i dati (alimenti, categorie) sono salvati **localmente sul telefono** tramite IndexedDB — non serve internet e non escono dal dispositivo
- La prima apertura scarica lo "scheletro" dell'app (HTML/CSS/JS, font, libreria di scansione) e lo salva nella cache del browser tramite un Service Worker; dopo, l'app si apre e funziona anche in aereo
- L'unica funzione che richiede internet è il riconoscimento automatico del prodotto dal codice a barre (usa il database gratuito Open Food Facts). Se sei offline, la scansione funziona lo stesso per leggere il codice, ma dovrai scrivere tu il nome del prodotto

## Note tecniche

- Nessun account, nessun backend: dati solo sul dispositivo. Se cambi telefono o cancelli i dati del browser, l'inventario si perde — se in futuro vuoi il backup/sync tra dispositivi, si può aggiungere Supabase come negli altri tuoi progetti
- Le categorie di partenza (Frigo, Freezer, Dispensa) sono modificabili/eliminabili/aggiungibili liberamente dalla sezione "Categorie"
- Testata la scansione codici a barre con EAN-13/UPC (gli standard usati sui prodotti alimentari italiani)
