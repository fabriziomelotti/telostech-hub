import { useState, useMemo, useEffect, useRef } from "react";
import { ImportClienti, SelezioneCliente, CreaProdotto, EditaProdotto } from "./ClientiComponenti";
import { useAuth, LoginReale } from "./Auth";

// ─── SUPABASE REST (fetch diretto — nessuna libreria esterna) ────────────────
const SUPABASE_URL = "https://trexrsxfjcysbigrjiwg.supabase.co";
// Nota: usiamo la nuova "publishable key" (sb_publishable_...) al posto della
// legacy anon key, per poter disattivare quest'ultima insieme a service_role
// (Supabase permette di disattivarle solo insieme). Stesso ruolo, stesso
// posto nel codice — solo il valore è cambiato.
const SUPABASE_ANON_KEY = "sb_publishable_p5wsUvOwpGTxGd3TQ9BPTg_mZyhk6JN";

const sbHeaders = {
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

async function sbGet(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// Come sbGet, ma con il token di sessione dell'utente loggato al posto della
// chiave pubblica generica — necessario per tabelle (es. "preventivi",
// "clienti") le cui policy RLS richiedono una sessione autenticata: con la
// sola chiave pubblica la richiesta viene trattata come anonima e la RLS
// restituisce zero risultati, senza errore.
async function sbGetAuth(table, params = "", accessToken) {
  if (!accessToken) throw new Error("Sessione non trovata: ricarica la pagina e rieffettua il login.");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: { ...sbHeaders, "Authorization": `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// POST/PATCH/DELETE autenticati (token utente reale) su tabelle la cui RLS
// richiede una sessione autenticata per scrivere — non serve una Edge
// Function con service_role qui perché, a differenza di "prodotti", queste
// scritture non sono riservate all'admin: qualunque utente loggato deve
// poter creare/modificare/eliminare i propri preventivi.
async function sbAuth(method, table, params, body, accessToken) {
  if (!accessToken) throw new Error("Sessione non trovata: ricarica la pagina e rieffettua il login.");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params ? `?${params}` : ""}`, {
    method,
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Prefer": method === "DELETE" ? "return=minimal" : "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status} ${txt}`);
  }
  if (method === "DELETE") return null;
  return res.json();
}

// Upload diretto su uno storage bucket con il token dell'utente loggato
// (nessuna Edge Function/service_role: il bucket ha una policy RLS che
// apre l'insert a chiunque autenticato — vedi 10_logistica_ordini.sql).
// Usato per la foto del prodotto da rottamare negli ordini.
async function sbUploadStorage(bucket, path, file, accessToken) {
  if (!accessToken) throw new Error("Sessione non trovata: ricarica la pagina e rieffettua il login.");
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: file,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Caricamento ${res.status} ${txt}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// Carica tutti i prodotti da Supabase via REST API (nessuna libreria esterna)
async function caricaCatalogo(catalogoDemo) {
  try {
    const PAGE = 1000;
    let tutti = [], offset = 0;
    const cols = "cod,nome,descrizione,desc_prev,categoria,marchio,tipologia,um,listino,sconto,netto,tipo_prezzo,note,img,settori,schede_tecniche,video_url";
    while (true) {
      const dati = await sbGet("prodotti",
        `select=${cols}&attivo=eq.true&order=categoria&limit=${PAGE}&offset=${offset}`);
      tutti = tutti.concat(dati || []);
      if (!dati || dati.length < PAGE) break;
      offset += PAGE;
    }
    if (tutti.length === 0) return catalogoDemo;
    return tutti.map(p => ({
      cat: p.categoria, mar: p.marchio, tip: p.tipologia,
      cod: p.cod, nome: p.nome, desc: p.descrizione,
      desc_prev: p.desc_prev, um: p.um,
      listino: p.listino || 0, sconto: p.sconto || 0, netto: p.netto || 0,
      tipo_prezzo: p.tipo_prezzo || "listino",
      note: p.note, img: p.img, settori: p.settori || "",
      schede: p.schede_tecniche || [],
      video: p.video_url || "",
    }));
  } catch (err) {
    console.warn("Supabase non raggiungibile, uso catalogo demo:", err.message);
    return catalogoDemo;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TELOS TECH HUB — Demo integrata, identità Telos
// ═══════════════════════════════════════════════════════════════════════════

const CATALOG = [{"cat":"PONTI SOLLEVATORI","mar":"OMCN","tip":"PONTI 2 COLONNE","cod":"199/GK","nome":"Art. 199/GK","desc":"Ponte 2 colonne 32 q.li OMCN 199/GK","desc_prev":"2 colonne\nElettromeccanico\nPortata 32 q.li\nSenza basamento/pedana\nInterasse tra colonne 2.500 mm\nPunto presa tampone h. 9 cm","um":"Nr.","listino":9656.0,"sconto":0,"netto":5100.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.biemmepi.com/image/cache/catalog/Prodotti/OMCN/199M-800x800.jpg","specs":{"portata":"32 q.li"},"comp_cats":["SOLLEVATORI E PRESSATURA","RUOTA","REVISIONI"]},{"cat":"PONTI SOLLEVATORI","mar":"OMCN","tip":"PONTI 2 COLONNE","cod":"199/RY","nome":"Art. 199/RY","desc":"Ponte 2 colonne 60 q.li 8 snodi OMCN 199/RY","desc_prev":"2 colonne\nElettromeccanico \nSenza pedana/basamento portante\nSistema ALL IN ONE con bracci a snood per sollevare\ndalla Smart fino al furgone a passo lungo\nInterasse tra colonne 3.000 mm\nPunto presa tampone h. 12 cm\nPortata 60 q.li","um":"Nr.","listino":25090.0,"sconto":0,"netto":13550.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.biemmepi.com/image/cache/catalog/Prodotti/OMCN/199M-800x800.jpg","specs":{"portata":"60 q.li"},"comp_cats":["SOLLEVATORI E PRESSATURA","RUOTA","REVISIONI"]},{"cat":"PONTI SOLLEVATORI","mar":"OMCN","tip":"PONTI 2 COLONNE","cod":"199/U","nome":"Art. 199/U","desc":"Ponte 2 colonne 32 q.li OMCN 199/U","desc_prev":"2 colonne\nElettromeccanico\nCon pedana/basamento semi-portante\nInterasse tra colonne 2.600 mm\nPunto presa tampone h. 9 cm\nPortata 32 q.li","um":"Nr.","listino":8601.0,"sconto":0,"netto":4950.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.biemmepi.com/image/cache/catalog/Prodotti/OMCN/199M-800x800.jpg","specs":{"portata":"32 q.li"},"comp_cats":["SOLLEVATORI E PRESSATURA","RUOTA","REVISIONI"]},{"cat":"RUOTA","mar":"OMCN","tip":"SMONTAGOMME","cod":"6012/ML-LE","nome":"GRIP 24 LNL LE EDITION","desc":"Smontagomme con palo ribaltabile + braccio IRON ARM e sistema LNL RAL 7040 grigio","desc_prev":"A piatto rotante 4 griffe, palo ribaltabile e braccio per RunFlat_x000d_\nCerchi: 10”-24” (max 1100 mm) – largh. max 16” (max 330 mm)_x000d_\nStallonatore doppio effetto con angolo regolabile e Power_x000d_\nOut_x000d_\nDoppia velocità a pedale con INVERTER_x000d_\nTorretta con Sistema LEVERLESS (senza leva) + regolazione_x000d_\npneumatica altezza_x000d_\nBraccio premitallone ausilio IRON ARM per RunFlat/UHP_x000d_\nManometro di gonfiaggio_x000d_\nAlimentazione 400V 50hz","um":"pz","listino":14115.0,"sconto":0,"netto":6490.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.omcn.it/images/attrezzature/371.jpg","specs":{"alimentazione":"400V"},"comp_cats":["PONTI SOLLEVATORI","UTENSILI AUTOMOTIVE"]},{"cat":"RUOTA","mar":"OMCN","tip":"SMONTAGOMME","cod":"6028/LIFT","nome":"GRIP 28 EVO LIFT","desc":"Smontagomme a plattorello blocco centrale + braccio IRON ARM e sistema LNL RAL 5012 blu","desc_prev":"A plattorello centrale, palo ribaltabile e braccio per RunFlat_x000d_\nCerchi: 12”-28” (max 1100 mm) – largh. max 16” (max 330 mm)_x000d_\nStallonatore doppio effetto con angolo regolabile e Power_x000d_\nOut_x000d_\nDoppia velocità a pedale con INVERTER_x000d_\nTorretta con Sistema LEVERLESS (senza leva) + regolazione_x000d_\npneumatica altezza_x000d_\nSollevatore Ruote integrato_x000d_\nBraccio premitallone ausilio IRON ARM per RunFlat/UHP_x000d_\nManometro di gonfiaggio_x000d_\nAlimentazione 400V 50hz","um":"Nr.","listino":15469.0,"sconto":0,"netto":6950.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.omcn.it/images/attrezzature/371.jpg","specs":{"alimentazione":"400V"},"comp_cats":["PONTI SOLLEVATORI","UTENSILI AUTOMOTIVE"]},{"cat":"RUOTA","mar":"OMCN","tip":"SMONTAGOMME","cod":"6040","nome":"GRIP 34","desc":"Smontagomme a plattorello centrale + sistema a dischi sincronizzati RAL 5012 blu","desc_prev":"A plattorello centrale, con sistema LNL senza leva_x000d_\nCerchi: 10”-34” (max 1200 mm) – largh. max 16” (max 330 mm)_x000d_\nStallonatori a dischi sincronizzati_x000d_\nDoppia velocità a pedale con INVERTER_x000d_\nTorretta con Sistema LEVERLESS (senza leva) +_x000d_\nregolazione pneumatica altezza_x000d_\nSollevatore Ruote integrato con portata max 80 Kg_x000d_\nBraccio premitallone con Sistema automatico di uscita zona lavoro_x000d_\nAlimentazione 230V","um":"Nr.","listino":20858.0,"sconto":0,"netto":9850.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.omcn.it/images/attrezzature/371.jpg","specs":{"alimentazione":"230V"},"comp_cats":["PONTI SOLLEVATORI","UTENSILI AUTOMOTIVE"]},{"cat":"RUOTA","mar":"SNAPON","tip":"","cod":"EEWB576AE3","nome":"B 600 L GREY","desc":"Equilibratrice JohnBean B600 L colore grigio","desc_prev":"Cerchi 8-32’’ – largh. Cerchio max 500 mm – Diam. 42’’ (1050 mm)\nMonitor 19” touchscreen industrial utilizzabile con guanti\nAcquisizione distanza e diametro con braccio easyALU\nTecnologia VPN ad alta ripetibilità\nLaser a punto interno per posizionamento pesi più preciso\nProgramma per suddivisione pesi dietro razze\nPeso ruota fino a 70 Kg\nSollevatore ruote opzionale (BW2010)\nDotazione: 3 coni – pinza per pesi – peso di calibrazione","um":"pz","listino":11075.0,"sconto":0,"netto":4290.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.castortrading.com/images/products/snap-on-john-bean-b600p.jpg","comp_cats":["PONTI SOLLEVATORI","UTENSILI AUTOMOTIVE"]},{"cat":"RUOTA","mar":"SNAPON","tip":"","cod":"EEWB576AE1","nome":"B 600 L RED","desc":"Equlibratrice JohnBean B600 L colore rosso","desc_prev":"Cerchi 8-32’’ – largh. Cerchio max 500 mm – Diam. 42’’ (1050 mm)\nMonitor 19” touchscreen industrial utilizzabile con guanti\nAcquisizione distanza e diametro con braccio easyALU\nTecnologia VPN ad alta ripetibilità\nLaser a punto interno per posizionamento pesi più preciso\nProgramma per suddivisione pesi dietro razze\nPeso ruota fino a 70 Kg\nSollevatore ruote opzionale (BW2010)\nDotazione: 3 coni – pinza per pesi – peso di calibrazione","um":"pz","listino":11075.0,"sconto":0,"netto":4290.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.castortrading.com/images/products/snap-on-john-bean-b600p.jpg","comp_cats":["PONTI SOLLEVATORI","UTENSILI AUTOMOTIVE"]},{"cat":"RUOTA","mar":"SNAPON","tip":"","cod":"EEWB576APE3","nome":"B 600 P GREY","desc":"Equilibratrice JohnBean B600 P colore grigio","desc_prev":"Cerchi 8-32’’ – largh. Cerchio max 500 mm – Diam. 42’’ (1050 mm)\nMonitor 19” touchscreen industrial utilizzabile con guanti\nAcquisizione distanza e diametro con braccio easyALU\nTecnologia VPN ad alta ripetibilità\nLaser a punto interno per posizionamento pesi più preciso\nProgramma per suddivisione pesi dietro razze\nPeso ruota fino a 70 Kg\nArresto in posizione\nIlluminazione del cerchione\nSollevatore ruote opzionale (BW2010)\nDotazione: 3 coni – pinza per pesi – peso di calibrazione","um":"pz","listino":12925.0,"sconto":0,"netto":5490.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.castortrading.com/images/products/snap-on-john-bean-b600p.jpg","comp_cats":["PONTI SOLLEVATORI","UTENSILI AUTOMOTIVE"]},{"cat":"RUOTA","mar":"MARELLI","tip":"ASSETTI RUOTE","cod":"007937000590","nome":"CONVERGENCE CHECK","desc":"Assetto Ruote 3D MARELLI CONVERGENCE CHECK","desc_prev":"Tablet Box con sistema Android\nPlug & Play con telecamere a infrarossi magnetiche per fissaggio senza fori su ponti sollevatori\nCompletamente portatile, trasportabile in due commode valigie\nMisurazione in soli 3 minuti\nAggiornamenti software per banca dati, gratuiti per 24 mesi\nGriffe a 3 punti in lega di magnesio senza contatto con Cerchio, con bloccafreno e bloccasterzo\nCompatibile anche con vari ponti a 4 colonne\nPiatti optional su ordinazione (cod. 007937000620)","um":"pz","listino":13000.0,"sconto":0,"netto":10999.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.magneti-marelli.com/images/convergence-check.jpg","comp_cats":["PONTI SOLLEVATORI","UTENSILI AUTOMOTIVE"]},{"cat":"RUOTA","mar":"BEISSBARTH","tip":"DIAGNOSI RUOTA","cod":"1691200050","nome":"Easy Tread 2.0","desc":"Sistema di diagnosi pneumatici Easy Tread 2.0 - Fuori terra","desc_prev":"Diagnosi automatica dell'usura degli pneumatici in pochi secondi\nMisurazioni in due direzioni (entrata e uscita veicoli)\nStatistiche sulle prestazioni per gestire e ottimizzare al meglio le prestazioni della tua officina\nCollegamento diretto di monitor e TV senza l'utilizzo del browser\nElevata precisione grazie alla massima superficie di contatto del pneumatico\nRiconoscimento automatico delle targhe con telecamera ANPR\nNessuna parte mobile (bassa manutenzione)\nModuli Easy Tread per installazione fuori terra (moduli di misura, cavi LAN, scatola di commutazione principale)\nMonitoraggio in tempo reale di tutti gli attraversamenti di più Easy Treads nella stessa rete di officine \nRisultati più rapidi\nVisualizzazione chiara delle informazioni sull'usura e delle azioni consigliate\nSistema automatico di misurazione del battistrada degli pneumatici con velocità di attraversamento fino a 8 km/h\nCollegamento semplificato ai sistemi di gestione dei concessionari e ai sistemi di terze parti\nPronto per l'interfaccia ASA\nVelocità di attraversamento fino a 8 km/h (non-stop)","um":"pz","listino":26646.0,"sconto":0,"netto":15850.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.m-italia.it/wp-content/uploads/beissbarth-g50.jpg","comp_cats":["PONTI SOLLEVATORI","UTENSILI AUTOMOTIVE"]},{"cat":"DIAGNOSI COMPUTERIZZATA","mar":"MARELLI","tip":"AUTODIAGNOSI","cod":"007935200170","nome":"100 Crediti","desc":"Crediti diagnosi remota Marelli","desc_prev":"Crediti qtà 100 da utilizzare con diagnosi Marelli per diagnosi remota","um":"nr","listino":100.0,"sconto":0,"netto":100.0,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.magneti-marelli.com/images/diagnosi.jpg","comp_cats":["DIAGNOSI FISICA","BATTERY"]},{"cat":"DIAGNOSI COMPUTERIZZATA","mar":"TREDLAB","tip":"ABBONAMENTO AUTODIAGNOSI","cod":"TC02015SGWFU","nome":"Abbonamento 12M Thinkcar SGW FULL","desc":"Abbonamento x 12 mesi Thinktool SGW FULL","desc_prev":"comprende (FCA e Maserati, GRUPPO VAG, Mercedes e 20 token RENAUL/DACIA)","um":"pz","listino":850.0,"sconto":0,"netto":850.0,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.tredlab.it/images/thinkcar.jpg","comp_cats":["DIAGNOSI FISICA","BATTERY"]},{"cat":"DIAGNOSI COMPUTERIZZATA","mar":"MAHLE Brain Bee","tip":"ABBONAMENTO AUTODIAGNOSI","cod":"1010601891EX","nome":"Abbonamento BMW-MERCEDES-VAG 12& RENAULT/DACIA 20T","desc":"Card per abbonamento 12 mesi Cyber Security FULL Mercedes (CeBAS) di 2° livello, BMW e GruppoVAG (Audi, Cupra, Seat, Skoda e Volkswagen) + pacchetto 20 richieste di sblocco Cyber Security Renault/DACIA","desc_prev":"Mercedes (CeBAS) di 2° livello, BMW e GruppoVAG (Audi, Cupra, Seat, Skoda e Volkswagen) + pacchetto 20 richieste di sblocco Cyber Security Renault/DACIA","um":"pz","listino":490.0,"sconto":0,"netto":490.0,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.mahle.com/images/brain-bee.jpg","comp_cats":["DIAGNOSI FISICA","BATTERY"]},{"cat":"DIAGNOSI COMPUTERIZZATA","mar":"MAHLE Brain Bee","tip":"ABBONAMENTO AUTODIAGNOSI","cod":"1010601645EX","nome":"Abbonamento UPDATE UPTONOW 12 + & FCA 12","desc":"Recupero mesi passati e rinnovo database diagnosi con 12 mesi di aggiornamento; attivazione FCA & MASERATI 12 mesi","desc_prev":"IN CASO DI STRUMENTO SCADUTO DA TEMPO","um":"pz","listino":1335.0,"sconto":0,"netto":1335.0,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.mahle.com/images/brain-bee.jpg","comp_cats":["DIAGNOSI FISICA","BATTERY"]},{"cat":"DIAGNOSI COMPUTERIZZATA","mar":"TEXA","tip":"ACCESSORI PER ADAS","cod":"3912417","nome":"Aggrappi per RCCS3","desc":"Kit griffe ruota 13''-24''","desc_prev":"Per sistema ADAS RCCS TEXA","um":"nr","listino":1803.0,"sconto":0,"netto":1100.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.texa.com/images/products/navigator-txts.jpg","comp_cats":["DIAGNOSI FISICA","BATTERY"]},{"cat":"DIAGNOSI COMPUTERIZZATA","mar":"TEXA","tip":"ABBONAMENTO AUTODIAGNOSI","cod":"TIC01","nome":"Bollettini","desc":"Abbonamento 12 mesi Bollettini Tecnici CAR","desc_prev":"Bollettini tecnici Case Auto","um":"nr","listino":470.0,"sconto":0,"netto":470.0,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.texa.com/images/products/navigator-txts.jpg","comp_cats":["DIAGNOSI FISICA","BATTERY"]},{"cat":"DIAGNOSI COMPUTERIZZATA","mar":"TEXA","tip":"ABBONAMENTO AUTODIAGNOSI","cod":"TIT01","nome":"Bollettini + Casistiche","desc":"Abbonamento 12 mesi Bollettini Tecnici + Casistiche TRUCK","desc_prev":"Bollettini tecnici Case Truck con banca dati dei guasti più conosciuti e le soluzioni","um":"nr","listino":250.0,"sconto":0,"netto":250.0,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.texa.com/images/products/navigator-txts.jpg","comp_cats":["DIAGNOSI FISICA","BATTERY"]},{"cat":"DIAGNOSI COMPUTERIZZATA","mar":"MAHLE Brain Bee","tip":"AUTODIAGNOSI","cod":"1010601781XX","nome":"Connex 2","desc":"Tablet CONNEX2 con interfaccia Connex VCI","desc_prev":"Tablet MDT 800 da 10\" con Android , maniglia e fotocamere anteriore + posteriore, APP Android Connex 2 DS, garanzia 36 mesi, custodia per il trasporto. Connex VCI (DOIP e CAN FD integrati)","um":"nr","listino":3650.0,"sconto":0,"netto":2650.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.mahle.com/images/brain-bee.jpg","comp_cats":["DIAGNOSI FISICA","BATTERY"]},{"cat":"SOLLEVATORI E PRESSATURA","mar":"OMCN","tip":"PONTI A FORBICE","cod":".803+853/B","nome":"Art .803+853/B","desc":"Sollevatore elettroidraulico a forbice portata 5000 kg lunghezza pedane 5400 mm a pavimento con lift table","desc_prev":"Portata 50 q.li\nOmologato per linea revisione (con provagiochi)\nPer assetto ruote (pedane posteriori oscillanti e vano incavo piatti)\nLunghezza pedane 5400 mm\nCon lift table\nInstallazione a pavimento\nFino ad esaurimento scrote","um":"Nr.","listino":50273.0,"sconto":45.0,"netto":27650.15,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.omcn.it/images/ponti/199GK.jpg","specs":{"portata":"50 q.li"},"comp_cats":["PONTI SOLLEVATORI","REVISIONI"]},{"cat":"SOLLEVATORI E PRESSATURA","mar":"OMCN","tip":"PONTI A FORBICE","cod":".815/A+853/B","nome":"Art .815/A+853/B","desc":"Sollevatore elettroidraulico a forbice portata 5000 kg lunghezza pedane 5400 mm a scomparsa","desc_prev":"Portata 50 q.li\nOmologato per linea revisione (con provagiochi)\nLunghezza pedane 5400 mm\nInstallazione a scomparsa\nFino ad esaurimento scorte","um":"Nr.","listino":35359.0,"sconto":45.0,"netto":19447.45,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.omcn.it/images/ponti/199GK.jpg","specs":{"portata":"50 q.li"},"comp_cats":["PONTI SOLLEVATORI","REVISIONI"]},{"cat":"SOLLEVATORI E PRESSATURA","mar":"OMCN","tip":"PONTI A FORBICE","cod":".823/I","nome":"Art .823/I","desc":"Sollevatore elettroidraulico a forbice portata 4000 kg lunghezza pedane 5100 mm a scomparsa\ncon lift table","desc_prev":"Portata 40 q.li\nOmologato per linee di revisione (con provagiochi)\nLunghezza pedane 5100 mm\nCon lift table\nInstallazione a scomparsa","um":"Nr.","listino":43063.0,"sconto":45.0,"netto":23684.65,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.omcn.it/images/ponti/199GK.jpg","specs":{"portata":"40 q.li"},"comp_cats":["PONTI SOLLEVATORI","REVISIONI"]},{"cat":"SOLLEVATORI E PRESSATURA","mar":"RAVAGLIOLI","tip":"","cod":"RAV.KPS32.986863","nome":"KPS 32","desc":"Ponte sollevatore elettromeccanico 32 q.li con pedana portante","desc_prev":"Profilo delle colonne pulito e lineare con carrello interno\nComponenti di alta qualità e a lunga durata, testati per 20000 cicli\nOttimizzazione spazi: massima ergonomia grazie ai salva piedi elettronici\nBase portante: installazione possibile anche su pavimentazioni con problemi di planarità o parametri di portata e spessore cemento insufficienti\nPedana portante ribassata: H 50 mm.\nPortata: 3,2 ton\nManutenzione di routine ridotta al minimo e sincronizzazione elettronica\nCarrelli interni scorrono su apposite guide lubrificate e sono protette dall’ambiente\nBracci corti a 3 stadi e bracci lunghi a 2 stadi per sollevare dalla city car alla berlina a passo lungo\nPuleggia in alluminio con funzione di raffreddamento e cuscinetti a lunga durata\nChiocciola portante in bronzo più lungo del 50% e motori con carcassa dissipante rinforzata. Solido sistema di arresto bracci automatico","um":"pz","listino":10700.0,"sconto":0,"netto":5490.0,"tipo_prezzo":"promo_telos","note":"Comprensivo di TEQ-LINK 4.0","alt":[],"img":"https://www.omcn.it/images/ponti/forbice.jpg","specs":{"portata":"3,2 ton"},"comp_cats":["PONTI SOLLEVATORI","REVISIONI"]},{"cat":"SOLLEVATORI E PRESSATURA","mar":"RAVAGLIOLI","tip":"","cod":"RAV.KPX35.990105","nome":"KPX 35","desc":"Ponte sollevatore 35 q.li senza pedana portante","desc_prev":"Componenti di alta qualità e a lunga durata, testati per 20000 cicli\nSistema di connettività TEq-Link per officine\nManutenzione di routine ridotta al minimo\nSincronizzazione elettronica \nTre posizioni regolabili in larghezza consentono di installare i ponti in modo flessibile\nMmonitoraggio remoto dei cicli di lavoro, degli avvisi per la manutenzione programmata e altro ancora.\nPer sollevare dalle city car ai furgoni di medie dimensioni a passo lungo.\nPonte sollevatore elettromeccanico ruotato con colonne a 45° per facilità di apertura delle porte\nPosizionamento rapido delle vetture: L’o\nCarrelli interni scorrono su apposite guide lubrificate e sono protette dall’ambiente esterno, a garanzia di una maggiore durata degli elementi scorrevoli\nSistema acustico per la protezione dei piedi – Nessun salva piedi meccanico\nBracci corti a 3 stadi e bracci lunghi a 2 stadi\nPuleggia in alluminio con funzione di raffreddamento e cuscinetti a lunga durata\nChiocciola portante in bronzo più lungo del 50% e motori con carcassa dissipante rinforzata, solido sistema di arresto bracci automatico","um":"pz","listino":10965.0,"sconto":0,"netto":5490.0,"tipo_prezzo":"promo_telos","note":"Accessorio pedana portante optional 901378 € 780\nComprensivo di TEQ-LINK 4.0","alt":[],"img":"https://www.omcn.it/images/ponti/forbice.jpg","comp_cats":["PONTI SOLLEVATORI","REVISIONI"]},{"cat":"SOLLEVATORI E PRESSATURA","mar":"GYS","tip":"","cod":"082885","nome":"Air Jack 3 palloni","desc":"Sollevatori a palloni","desc_prev":"","um":"nr","listino":360.0,"sconto":0,"netto":360.0,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.omcn.it/images/ponti/forbice.jpg","comp_cats":["PONTI SOLLEVATORI","REVISIONI"]},{"cat":"SOLLEVATORI E PRESSATURA","mar":"RAVAGLIOLI","tip":"","cod":"901378","nome":"Pedana portante ponte","desc":"Pedana portante per ponti sollevatori Ravaglioli KPX35","desc_prev":"","um":"pz","listino":1030.0,"sconto":0,"netto":780.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.omcn.it/images/ponti/forbice.jpg","comp_cats":["PONTI SOLLEVATORI","REVISIONI"]},{"cat":"SOLLEVATORI E PRESSATURA","mar":"GYS","tip":"","cod":"071995","nome":"Set di due jack meccanici","desc":"Set di due jack meccanici per sollevamento ruote","desc_prev":"","um":"nr","listino":350.0,"sconto":0,"netto":350.0,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.omcn.it/images/ponti/forbice.jpg","comp_cats":["PONTI SOLLEVATORI","REVISIONI"]},{"cat":"ARIA COMPRESSA","mar":"FINI","tip":"","cod":"BRNC701FNM878","nome":"ADVANCED 270 5,5","desc":"Compressore a pistoni NON silenziato 270 lt. 5,5 CV","desc_prev":"bistadio\nCon serbatoio – Alimentazione 400V","um":"pz","listino":2793.0,"sconto":0,"netto":1400.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.finicompressori.it/images/pulsar-evo.jpg","specs":{"alimentazione":"400V"},"comp_cats":["DISTRIBUZIONE ENERGIE","UTENSILI AUTOMOTIVE"]},{"cat":"ARIA COMPRESSA","mar":"FINI","tip":"","cod":"BRNC801FNM877","nome":"ADVANCED 270 7,5","desc":"Compressore a pistoni NON silenziato 270 lt. 7,5 CV","desc_prev":"Bistadio\nCon serbatoio – Alimentazione 400V","um":"pz","listino":2947.0,"sconto":0,"netto":1500.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.finicompressori.it/images/pulsar-evo.jpg","specs":{"alimentazione":"400V"},"comp_cats":["DISTRIBUZIONE ENERGIE","UTENSILI AUTOMOTIVE"]},{"cat":"ARIA COMPRESSA","mar":"GENERICO","tip":"","cod":"V51PE92PWS043","nome":"JUNIOR 5,5-10","desc":"Compressore a vite senza serbatoio 7,5 CV","desc_prev":"Con trasmissione coassiale, a garanzia di efficienza e affidabilità. Compatto e di facile installazione e manutenzione\n7,5 CV (5,5 KW) - 705 l/min\nSenza serbatoio\nDimensioni 650 l x 580 p x 750 mm h","um":"pz","listino":5980.0,"sconto":0,"netto":3220.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://img.directindustry.it/images_di/photo-g/9260-6580523.jpg","specs":{"potenza":"7,5 CV"},"comp_cats":["DISTRIBUZIONE ENERGIE","UTENSILI AUTOMOTIVE"]},{"cat":"ARIA COMPRESSA","mar":"GENERICO","tip":"","cod":"V91PO92PWS080","nome":"JUNIOR 7,5 270","desc":"Compressore a vite CON serbatoio 270 lt. 7,5 CV","desc_prev":"Compressore A VITE lubrificato trifase con trasmissione coassiale, a garanzia di efficienza e affidabilità. Compatto e di facile\ninstallazione e manutenzione - 10 CV (7,5 KW) - 1050 l/min\nCon serbatoio 270 lt.\nDimensioni 1200 l x 600 p x 1450 mm h","um":"pz","listino":6250.0,"sconto":0,"netto":3370.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://img.directindustry.it/images_di/photo-g/9260-6580523.jpg","specs":{"potenza":"10 CV"},"comp_cats":["DISTRIBUZIONE ENERGIE","UTENSILI AUTOMOTIVE"]},{"cat":"ARIA COMPRESSA","mar":"GENERICO","tip":"","cod":"V60TU92PWSA87","nome":"PASCAL 5,5","desc":"Compressore A VITE SILENZIATO CON SERBATOIO 270 lt. 7,5 CV","desc_prev":"Compressore A VITE SILENZIATO, lubrificato con\ntrasmissione a cinghia, controllore elettronico DNAir1 eavviamento stella/triangolo.\n7,5 CV (5,5 KW) - 650 l/min\nCon serbatoio 270 lt.\nDimensioni 1200 l x 600 p x 1450 mm h","um":"pz","listino":7150.0,"sconto":0,"netto":3900.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://img.directindustry.it/images_di/photo-g/9260-6580523.jpg","specs":{"potenza":"7,5 CV"},"comp_cats":["DISTRIBUZIONE ENERGIE","UTENSILI AUTOMOTIVE"]},{"cat":"ARIA COMPRESSA","mar":"FINI","tip":"","cod":"BRNT701FNN300","nome":"PULSAR EVO 270 5,5","desc":"Compressore a pistoni silenziato 270 lt. 5,5 CV","desc_prev":"Bistadio\nCon serbatoio – Alimentazione 400V\nOptional su richiesta: avviamento triangolo/stella (maggior durata nel tempo) € 400","um":"pz","listino":5157.0,"sconto":0,"netto":2500.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.finicompressori.it/images/pulsar-evo.jpg","specs":{"alimentazione":"400V"},"comp_cats":["DISTRIBUZIONE ENERGIE","UTENSILI AUTOMOTIVE"]},{"cat":"CLIMA","mar":"MARELLI","tip":"ACCESSORI PER CLIMA","cod":"007950027520","nome":"KIT MANUTENZIONE IMPIANTI R744 CO2","desc":"KIT MANUTENZIONE IMPIANTI R744 CO2","desc_prev":"Permette di eseguire le 3 fasi operative: Scarico, Vuoto e Ricarica \nImpatto ambientale ridotto \nConformità alle normative Europee \nSicuro per l’utilizzo \nElevata efficienza energetica \nFunziona a pressioni superiori a 70 bar \nVersatile: Idoneo per una vasta gamma di utilizzi\n\nDotazione: \n•       Gruppo manometrico a 4 vie \n•       3 tubi da 1,5 m – F1/4” SAE – 120 bar \n•       Attacco rapido LP R744 \n•       Attacco rapido HP R744 \n•       Innesto LP R134a – F1/4” SAE (90°) \n•       Innesto LP R1234yf – F1/4” SAE","um":"pz","listino":1120.0,"sconto":0,"netto":999.0,"tipo_prezzo":"promo_fornitore","note":"","alt":[],"img":"https://www.magneti-marelli.com/images/alaska-evo.jpg","comp_cats":["ARIA COMPRESSA","DISTRIBUZIONE ENERGIE"]},{"cat":"CLIMA","mar":"TEXA","tip":"RICARICA CLIMA","cod":"Z10410","nome":"Konfort 705R","desc":"Macchina clima per gestione gas R134a","desc_prev":"Serbatoio 10 kg., recupero olio + iniezione nuovo con tasso puls.","um":"nr","listino":3140.0,"sconto":0,"netto":2100.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.texa.com/images/clima.jpg","comp_cats":["ARIA COMPRESSA","DISTRIBUZIONE ENERGIE"]},{"cat":"CLIMA","mar":"TEXA","tip":"RICARICA CLIMA","cod":"Z20411","nome":"Konfort 707 TOUCH R1234yf","desc":"Macchina clima TEXA 707 TOUCH gas R1234yf","desc_prev":"• Serbatoio 10 Kg\n• Display TOUCH 7\" con Android, WiFi e Bluetooth\n• Database veicoli avanzato CAR e TRUCK\n• Iniezioni quantità olio con tasso pulsazione\n• APP KONFORT, aggiornamenti ed assistenza da remoto\n• Pompa a vuoto mono stadio da 100 l/min e gestione scarico\nincondensabili\n• Stampa report su WiFi\n• Compatibilità con R134a, R456a, R1234yf, R444a","um":"nr","listino":3680.0,"sconto":0,"netto":2400.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.texa.com/images/clima.jpg","comp_cats":["ARIA COMPRESSA","DISTRIBUZIONE ENERGIE"]},{"cat":"CLIMA","mar":"TEXA","tip":"RICARICA CLIMA","cod":"Z20410","nome":"Konfort 707 TOUCH R134a","desc":"Macchina clima 707 TOUCH per gestione gas R134a","desc_prev":"• Serbatoio 10 Kg\n• Display TOUCH 7\" con Android, WiFi e Bluetooth\n• Database veicoli avanzato CAR e TRUCK\n• Iniezioni quantità olio con tasso pulsazione\n• APP KONFORT, aggiornamenti ed assistenza da remoto\n• Pompa a vuoto mono stadio da 100 l/min e gestione scarico\nincondensabili\n• Stampa report su WiFi\n• Compatibilità con R134a, R456a, R1234yf, R444a","um":"nr","listino":3680.0,"sconto":0,"netto":2400.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.texa.com/images/clima.jpg","comp_cats":["ARIA COMPRESSA","DISTRIBUZIONE ENERGIE"]},{"cat":"CLIMA","mar":"SPIN","tip":"","cod":"05.073.25T","nome":"Lampada UV ricaricabile","desc":"","desc_prev":"Completa di caricabatterie AC e da presa accendisigari, occhiali di protezione","um":"pz","listino":60.0,"sconto":0,"netto":48.0,"tipo_prezzo":"promo_fornitore","note":"","alt":[],"img":"https://www.spin.it/images/clima-kit.jpg","comp_cats":["ARIA COMPRESSA","DISTRIBUZIONE ENERGIE"]},{"cat":"CLIMA","mar":"BOSCH","tip":"","cod":"SP00000149","nome":"ACS 553P","desc":"Macchina clima ACS 553P per gas R134a","desc_prev":"","um":"pz","listino":4900.0,"sconto":0,"netto":2650.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.cartronic.it/images/bosch-acs-663.jpg","comp_cats":["ARIA COMPRESSA","DISTRIBUZIONE ENERGIE"]},{"cat":"CLIMA","mar":"BOSCH","tip":"","cod":"SP00000175","nome":"ACS 653P","desc":"Macchina clima ACS 653P per R134a","desc_prev":"","um":"pz","listino":6900.0,"sconto":0,"netto":3600.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.cartronic.it/images/bosch-acs-663.jpg","comp_cats":["ARIA COMPRESSA","DISTRIBUZIONE ENERGIE"]},{"cat":"CLIMA","mar":"BOSCH","tip":"","cod":"SP00000172","nome":"ACS 663P","desc":"Macchina clima ACS 663P per gas R1234yf","desc_prev":"","um":"pz","listino":7350.0,"sconto":0,"netto":3800.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.cartronic.it/images/bosch-acs-663.jpg","comp_cats":["ARIA COMPRESSA","DISTRIBUZIONE ENERGIE"]},{"cat":"BATTERY","mar":"BOSCH","tip":"TESTER BATTERIE","cod":"0687000115","nome":"BAT 115","desc":"Tester batterie con stampante","desc_prev":"Test EN, EN2, DIN, SAE, IEC, JIS e MCA.\nAdatto per batterie da 6 V e 12 V da 40 -2000 CCA, incluse batterie al piombo\nacido, EFB, Gel e AGM (a spirale o piatto).\nUtilizza un test a microcarica per risultati accurati e affidabili e offre al contempo la possibilità di testare i sistemi di carica a 12V e 24 V con un test di ripple/diodo","um":"pz","listino":575.0,"sconto":0,"netto":400.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.gys.fr/images/batium-100.jpg","specs":{"alimentazione":"6 V"},"comp_cats":["DIAGNOSI FISICA","DIAGNOSI COMPUTERIZZATA"]},{"cat":"BATTERY","mar":"BETA","tip":"","cod":"014980100","nome":"1498","desc":"PROVATENSIONE AUTO 3-48V","desc_prev":"","um":"nr","listino":54.5,"sconto":30.0,"netto":38.15,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.beta-tools.com/images/1498.jpg","comp_cats":["DIAGNOSI FISICA","DIAGNOSI COMPUTERIZZATA"]},{"cat":"BATTERY","mar":"BETA","tip":"","cod":"014980520","nome":"1498/12-/24 R20","desc":"ALIMENTATORI BOOSTER 12/24 R20","desc_prev":"","um":"nr","listino":80.5,"sconto":30.0,"netto":56.35,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.beta-tools.com/images/1498.jpg","comp_cats":["DIAGNOSI FISICA","DIAGNOSI COMPUTERIZZATA"]},{"cat":"BATTERY","mar":"BETA","tip":"","cod":"014980102","nome":"1498/2A","desc":"CARICA BATTERIE 12V MOTO /2A","desc_prev":"","um":"nr","listino":142.0,"sconto":30.0,"netto":99.4,"tipo_prezzo":"sconto_base","note":"","alt":[],"img":"https://www.beta-tools.com/images/1498.jpg","comp_cats":["DIAGNOSI FISICA","DIAGNOSI COMPUTERIZZATA"]},{"cat":"BATTERY","mar":"BOSCH","tip":"","cod":"0687000149","nome":"BAT 6120","desc":"Caricabatterie mantenitore 120A con cavi 3 metri","desc_prev":"","um":"nr","listino":1900.0,"sconto":0,"netto":1300.0,"tipo_prezzo":"promo_telos","note":"","alt":[],"img":"https://www.gys.fr/images/batium-100.jpg","comp_cats":["DIAGNOSI FISICA","DIAGNOSI COMPUTERIZZATA"]}];

// ─── ASSET LOGO (estratti dal file ufficiale) ────────────────────────────────
const LOGO_SYMBOL = "data:image/png;base64,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";
const LOGO_FULL = "data:image/png;base64,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";
const LOGO_TELOSTECH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAsMAAAFXCAYAAABHk0OKAAEAAElEQVR42uy9eZxcVZk+/rxnubdudXcl6U7sQJqQAAESxIiRZRRU8AuK4gqO4ld0hpkfzIijuM0IM+Iy85VxQMUFFXRAQVkUkVVWjbIJCCLIZhJMgA6kk3Qnqe6qW3XP9vvj1qm+3WSDdCCkz5PP/XSnuruWc8495znved7nJeccAgICAgICAgICAiYjWGiCgICAgICAgICAQIYDAgICAgICAgICAhkOCAgICAgICAgICGQ4ICAgICAgICAgIJDhgICAgICAgICAgECGAwICAgICAgICAgIZDggICAgICAgICAhkOCAgICAgICAgICCQ4YCAgICAgICAgIBAhgMCAgICAgICAgICGQ4ICAgICAgICAgIZDggICAgICAgICAgkOGAgICAgICAgICAQIYDAgICAgICAgICAhkOCAgICAgICAgICGQ4ICAgICAgICAgIJDhgICAgICAgICAgECGAwICAgICAgICAgIZDggICAgICAgICAhkOCAgICAgICAgICCQ4YCAgICAgICAgIBAhgMCAgICAgICAgICGQ4ICAgICAgICAgIZDggICAgICAgICAgkOGAgICAgICAgICAQIYDAgICAgICAgICAhkOCAgICAgICAgICGQ4ICAgICAgICAgIJDhgICAgICAgICAQIYDAgICAgICAgICJiVEaIIdFTYZt29J/Xeu1W8E6M3+rWt9JZb6v9/y3wYEBAQEBAQEBDIc8CKhTU4dAIKGgwBZ6QmtsabCGa+6nBArALBAAgAMSMkBxmS9XEQrR5/UJoCpwOgeMFYHxBAIcGDK/y0HhvPXGCXZAQEBAQEBAQGBDAe86CDXZsat/hiNCudEmKUAU9rZHuZYnSiP6lqHRDcbfXGptBQAjDFdnAFWqV4GU4GUAznZJdUivYIB6fjXCAgICAgICAiYvDzMudAKLyXc+A1JKypMAMBSAybyX4MEAA5UCdBw+e84Hy3WWS/nLAWcBEgp7aSQctACiQNk++9gk7Z8okWyQUEyERAQEBAQEDA5ERLodiiMyiMAlnqiaxwqDpAEqNbv5TIIZxMN9NQ1FjIRDSilewBSWpsKk7LesJingR4DVLw8IifCToa2DggICAgICAgIZHiHJcJwTBGgnYNkhLRNhJ0DtOqF1d0g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8xYlIFa1697L6thrBz1HoO3wwlU/m2WEG0mTXq/H0MAgEiiyGQYHNYsXx/z5W15THPyUvc9NNOsUTGF6hHn08Oz0LcynnWQZ7NEYy4VkP3clJnehtpqJ/XDlQ1qEZfRgQv9k7vUHsLV2SAhhggvBtmhOF2ocu90uSinyPB+rx52H0IAne/wCEA5jVh/TkGKW5/n+L3zhC8Vzn/tcrLWkacr09PTjTMh85PkV7NsCu9doNFi7di3vete7uOSSSzqBoSyKYrQOQrrd7oowhsaY4XC+wxiH/59/zLWium+PFc5H+Fn95/X3klJmAZhVoLt5xx13fP1tb3vbh7/1rW+RpikzMzMkSdJf+dzGYqWf3BdFEVmWEUURixcv5txzz127ra9fS/3Ler3eMudc82tf+xr3338/1157LW94wxve9JWvfGVienr6uBCJPJ+oqI93cAEJ4za/yKqnHYbfny/TqL9+GOuQqle/toUQ5tJLL71x/fr1/SbF+WP32MVYWfwGHXcURSil+lILrTVLly5lZGTki3UiZlcEw7se1f14dFb9AAZZGEHLQSoh0542jhRI8TaSDTlR2O5yqeKN1jOidNTu5HY5seYhOOtrV68+71d33k3mYzZNzUCckjQGyPIcSRmLXMd+jllBgHQV9PVgBUgx+7vKCwYaA2zaPINuNLAIprrTpFLQ8F206HLaScfznGOf/r4hzQ81TEZQ+j7aYlhomQV2uH+BQCoFWR+HClGAKkBPqrKprpRACBeJMh2w9HoWXiNF1rN+udMivfWuTd/73FeuGrnr7k1onfZjR0OyUuiUfsybHQqEAyxIC1ic8MgqUroz3WWgMUiv2yESHq1zRhan/PmbX9U+/NDWMZFgY6iod4aGhx0Z+O2K4HghHsZaa7TWk6ExJ3ioWmtbSj25c25+bHidWXo81lzb65wHcLclxlEIUQjx5BemRVHso5SaCixxADdRFI3neb5/CMC44IILLvnVr3519n333cfAwABZllWM7raDvaAZ7na7SClpNps88MAD/O3f/i233HLLD88///y3j46O/nMASXmejwVZwPymsUdKCdtS01OYy9XrFPMLcOdc2uv1lqVpemv4f631ZABjV1555cYPfvCDTE1N0Wg0mJqaYtGiRWzevJkkSbZZVz3LUJq+5rjX6/HqV7+ao4466ikLtfLmnEvjOF7/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Xth3OUqSpM+a1p9tzjkeeOABvvrVr/Ktb32L5zznlOuOP/54TjjhhA/tu+++H66P53zZzXzwGAoX731UY4eL+msElwxr7VCn01l56aWX/vDzn/88t912GwMDAxRFrw9qQzGytc2JFbie03QcGObAEB9++OHss88+Hwtzq3YPLHY1n+FdDgz/NidIUmloXQibAC+kcZAqhMGrttStH00bv2qT4ozLfnzTedfdfjdTThOlKcZmaJ3QyQviOEbHMe1NkzSSCGEfuTLuiyikQ7l6P5nECo+VgOkykEQMSMuAlDzvmGN58cmHnduANVhHouU6PBpbjIAo+sjbA0qY0ipty+dZlPBzqvQXdlUimywqS2ONwBTWjnqlo1/d1f75v3z+661NWcxMoUibmryXEQOm6j631iIrEX69S/VRH8Cy9EsWXpeUuVNIJ6omwoJFQ4KBpuDP33Re5/BD9ztG4jONLbyT5Q2nsn3bFS/OnZlR3VU2ay2Tk5P867/+66GLFy9uB6a4nkb2JHPC/YdZHMe85z3vObS+7P9kXxNaazZt2sQ//dM/XRBF0QVhTKWU/caxJ3fOCwYGBnjVq171oQMOOOA9YWm7rvlsNBp3hLGUUmYHHXTQBW95y1te83d/93fkeXdbwTjT09N9EiGKon4zVKfTYWhoqP/VGNMHzF//+te59NJLOfzwI9c++9nP5vnPf/51K1asODusCgTwUmd+54EwUwIx24LAWlK5fvgoyzorp6enj/vJT37yicsvv5wbb7yRqampCiQZer2MNE0RQtBut4miiDRN+ylzzjmGhob6nsLb8DynKAoGBgY46aST+MM//MPX1MiO1rbGJoe/v+KKKzo//vGPieO4740cisHQ5NhsNrHW0u12++foG9/4OldeeTlLly599+GHH/7u5z73uZxwwgkf2G+//f5eKWGsLUZn9bVeW+ua4f+F8FoIEKJfxFSsa2kBmuf5WBzH6zduvO/tV1999YcuueQSbr755tKmdCDFmHyO+0toNAxft7bYCC5CgeEP97eBgQFOP/30fjLf/JWFXe1ev0t7Z27NwyDII0qbMRchfIQAh41AFHidFZYRp0k3eXHGV6+58X0/X7uBTEU4nTCT5zTSAbK81+/C7HamaSQRypX+wMK72XejtA8roajHC4eoeUs4IWtA2aFxaJORUnDas4/lJSf/zllN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";

// ─── DATI DEMO ────────────────────────────────────────────────────────────────
const RUOLI = {
  commerciale: {label:"Commerciale", initials:"MC", nome:"Marco Conti",
    nav:["home","ai","prodotti","clienti","promemoria","preventivi","ordini"]},
  tecnico: {label:"Tecnico", initials:"LR", nome:"Luca Rossi",
    nav:["home","ai","interventi","rapporti","clienti","promemoria","prodotti"]},
  responsabile: {label:"Responsabile", initials:"GF", nome:"Giovanni Ferri",
    nav:["home","ai","prodotti","clienti","promemoria","preventivi","ordini","interventi","rapporti","analytics","saltati"]},
  admin: {label:"Admin", initials:"AM", nome:"Amministratore",
    nav:["home","ai","prodotti","clienti","promemoria","preventivi","ordini","interventi","rapporti","analytics","saltati","admin"]},
};
const NAV_META = {
  home:{icon:"⌂",label:"Dashboard"}, ai:{icon:"✦",label:"Assistente"}, prodotti:{icon:"▣",label:"Catalogo"},
  clienti:{icon:"◉",label:"Clienti"}, promemoria:{icon:"⚑",label:"Promemoria"}, preventivi:{icon:"▤",label:"Preventivi"}, ordini:{icon:"⬡",label:"Ordini"},
  interventi:{icon:"⚒",label:"Interventi"}, rapporti:{icon:"☑",label:"Rapporto"}, analytics:{icon:"◈",label:"Condizioni"},
  saltati:{icon:"⊘",label:"Saltati"}, admin:{icon:"⚙",label:"Admin"},
};
function navMobile(nav){ return nav.slice(0,4).concat(nav.length>4?["more"]:[]); }

const BADGE_LABEL = {promo_telos:"Netto Telos",promo_fornitore:"Promo fornitore",sconto_base:"Sconto base",listino:"Listino"};

const DEMO_CLIENTI = [
  {id:"cli-1",ragione_sociale:"Autofficina Bianchi",citta:"Pistoia",provincia:"PT",telefono:"0573 123456",email:"info@bianchi.it",settori:["auto","truck"],note:"Cliente storico"},
  {id:"cli-2",ragione_sociale:"Officina Truck Verdi",citta:"Prato",provincia:"PO",telefono:"0574 654321",email:"verdi@truck.it",settori:["truck"],note:""},
  {id:"cli-3",ragione_sociale:"Gommista Ferrari",citta:"Firenze",provincia:"FI",telefono:"055 998877",email:"ferrari@gomme.it",settori:["gomme"],note:"Preventivo in corso"},
];
const DEMO_PROD_INSTALLATI = {
  "cli-1":[{id:"pi-1",codice:"199/GK",nome:"Ponte 2 colonne Art. 199/GK",marchio:"OMCN",categoria:"PONTI SOLLEVATORI",numero_serie:"OM2022-2841",data_vendita:"2022-03-15",data_installazione:"2022-03-22",garanzia_fino:"2024-03-22"}],
  "cli-2":[{id:"pi-2",codice:"199/RY",nome:"Ponte 2 colonne Art. 199/RY",marchio:"OMCN",categoria:"PONTI SOLLEVATORI",numero_serie:"OM2024-3381",data_vendita:"2024-06-20",data_installazione:"2024-06-28",garanzia_fino:"2026-06-28"}],
  "cli-3":[],
};
const DEMO_INTERVENTI = [
  {id:1,nome:"Installazione ponte 2 colonne",cliente:"Officina Truck Verdi",tipo:"Installazione",data:"28 GIU",p:"alta",tec:"L. Rossi",prod:"OMCN 199/RY"},
  {id:2,nome:"Riparazione banco frenometrico",cliente:"Centro Revisioni Rossi",tipo:"Garanzia",data:"02 LUG",p:"media",tec:"M. Conti",prod:"OMCN 441"},
  {id:3,nome:"Sopralluogo cabina verniciatura",cliente:"Carrozzeria Ferrari",tipo:"Sopralluogo",data:"04 LUG",p:"bassa",tec:"L. Rossi",prod:"—"},
];
// Stati possibili di un preventivo, in ordine di avanzamento del ciclo di vita
const STATI_PREVENTIVO = ["Bozza","Inviato"];
const STATO_COLORE = { "Bozza":"steel", "Inviato":"warn", "Convertito in ordine":"primary", "Saltato":"danger", "Sospeso":"warn" };
// Ciclo ordine: Convertito in ordine (preventivo) o creazione manuale →
// "Inserito" (chi vende compila il modulo logistico e "Segna come
// inviato") → "Inviato" (in attesa che un responsabile lo prenda in
// carico) → "In gestione" (responsabile al lavoro: date previste,
// eventuali modifiche, assegnazione tecnico) → "Evaso". "Sospeso" e
// "Annullato" possibili in qualunque momento.
function toneOrdine(stato){
  if(stato==="Annullato") return "danger";
  if(stato==="Sospeso") return "warn";
  if(stato==="Inserito") return "steel";
  if(stato==="Inviato") return "primary";
  if(stato==="In gestione") return "warn";
  return "ok"; // Evaso
}
// I 5 casi logistici da definire una volta per l'intero ordine prima
// dell'invio. "obbligKey" è il campo di categorie_logistica_obbligatoria
// che rende obbligatoria la risposta se l'ordine contiene quella categoria.
const CAMPI_LOGISTICA_ORDINE = [
  {chiave:"rottamazione", obbligKey:"rottamazione", label:"Ritiro per rottamazione", domanda:"Comporta il ritiro di un prodotto da rottamare?"},
  {chiave:"destinazione_diversa", obbligKey:"destinazione_diversa", label:"Destinazione trasporto diversa dal cliente", domanda:"Va consegnato a un indirizzo diverso da quello del cliente?"},
  {chiave:"mezzi_movimentazione", obbligKey:"mezzi_movimentazione", label:"Mezzi movimentazione carichi", domanda:"Sono disponibili mezzi di movimentazione allo scarico (es. muletti)?"},
  {chiave:"installazione", obbligKey:"installazione", label:"Installazione tecnica richiesta", domanda:"È richiesta l'installazione da parte di un tecnico?"},
  {chiave:"formazione", obbligKey:"formazione", label:"Formazione all'uso", domanda:"È richiesta la formazione all'uso per il cliente?"},
];
const MOTIVI_SALTO = {
  prezzo_alto: "Prezzo alto",
  concorrente: "Scelta concorrente",
  rimandata: "Vendita rimandata",
  altro: "Altro",
};

// Il codice "PRV-0001" mostrato in giro non è più generato lato client (con
// preventivi condivisi su Supabase, un contatore locale che riparte da 100 ad
// ogni ricarica di pagina creerebbe ID duplicati tra utenti diversi) — arriva
// dal campo "progressivo" assegnato dal database (bigserial, sempre univoco).
function codicePreventivo(p){
  if(p?.id==="__nuovo__") return "Nuovo (non salvato)";
  return p?.progressivo ? `PRV-${String(p.progressivo).padStart(4,"0")}` : (p?.id || "—");
}
function codiceOrdine(p){
  return p?.progressivo ? `ORD-${String(p.progressivo).padStart(4,"0")}` : (p?.id || "—");
}
// Codice del preventivo da cui è nato un ordine, letto dal campo denormalizzato
// preventivo_progressivo (evita di dover incrociare le due tabelle solo per mostrarlo)
function codicePreventivoRif(o){
  return o?.preventivo_progressivo ? `PRV-${String(o.preventivo_progressivo).padStart(4,"0")}` : (o?.preventivo_id || o?.preventivoId || "—");
}

// Aggiunge N giorni lavorativi (esclusi sabato e domenica — non tiene conto
// delle festività italiane) a una data, restituendo una stringa "YYYY-MM-DD"
// pronta per un <input type="date">.
function aggiungiGiorniLavorativi(dataIniziale, giorni){
  const d = new Date(dataIniziale);
  let aggiunti = 0;
  while(aggiunti < giorni){
    d.setDate(d.getDate()+1);
    const giornoSettimana = d.getDay(); // 0=domenica, 6=sabato
    if(giornoSettimana!==0 && giornoSettimana!==6) aggiunti++;
  }
  return d.toISOString().slice(0,10);
}

// Calcola lo stato di una data di scadenza (aggiornamenti/verifiche
// attrezzature): giorni residui, se è già scaduta, se rientra nella finestra
// di promemoria (30 giorni prima). Usato sia per il badge sulla singola
// attrezzatura sia per l'elenco promemoria mostrato a responsabili/tecnici.
const GIORNI_PREAVVISO_SCADENZE = 30;
function statoScadenza(dataStr){
  if(!dataStr) return null;
  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const scadenza = new Date(dataStr);
  const giorni = Math.round((scadenza-oggi)/(1000*60*60*24));
  return { giorni, scaduta: giorni<0, vicina: giorni>=0 && giorni<=GIORNI_PREAVVISO_SCADENZE };
}

// Elenco utenti Telos (id, nome, ruolo) per il menu a tendina "Referente
// Telos" — riservato lato server a responsabili/admin (vedi Edge Function
// utenti-info); chi non ha i permessi riceve semplicemente un errore 403
// e il chiamante mostra il proprio nome senza menu a tendina.
async function chiamaUtentiInfo(accessToken) {
  if (!accessToken) throw new Error("Sessione non trovata: ricarica la pagina e rieffettua il login.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/utenti-info`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Edge Function ${res.status}`);
  return data;
}

// ─── FINANZIAMENTO / NOLEGGIO ──────────────────────────────────────────────
// Tabelle tassi 2025 (fonte: Tabella_Finanziamento_Finalizzato_2025.xlsx e
// Tabella_Noleggio_Finalizzato_2025.xlsx). Il "coefficiente" è una PERCENTUALE
// dell'importo beni da applicare per ottenere la rata mensile — verificato
// contro l'esempio reale: 9.400 € × 3,215% = 302,21 € (36 rate, fascia
// 5.001-15.000, finanziamento). Se cambiano le condizioni con il fornitore
// del finanziamento, aggiornare solo questi due oggetti.
const DURATE_MESI = [12,24,30,36,48,60];

const TASSI_FINANZIAMENTO = {
  canoni: [
    { max: 5000,   coeff: {12:8.926,24:4.658,30:3.806,36:3.239,48:2.535,60:2.119} },
    { min: 5001,  max: 15000,  coeff: {12:8.902,24:4.635,30:3.783,36:3.215,48:2.511,60:2.094} },
    { min: 15001, max: 25000,  coeff: {12:8.879,24:4.612,30:3.759,36:3.192,48:2.487,60:2.070} },
    { min: 25001, max: 50000,  coeff: {12:8.833,24:4.588,30:3.740,36:3.175,48:2.474,60:2.059} },
  ],
  speseContratto: [
    { max: 5000,  spese: 50 },
    { min: 5001,  max: 10000, spese: 75 },
    { min: 10001, max: 25000, spese: 100 },
    { min: 25001, max: 50000, spese: 150 },
  ],
  // Sopra 50.000€ questo prodotto "finalizzato" non copre l'importo: serve
  // una pratica di finanziamento tradizionale, da concordare a parte.
  limiteMassimo: 50000,
};

const TASSI_NOLEGGIO = {
  canoni: [
    { max: 5000,   coeff: {12:6.144,24:4.721,30:3.896,36:3.302,48:2.598,60:2.182} },
    { min: 5001,   max: 15000,  coeff: {12:6.087,24:4.664,30:3.812,36:3.244,48:2.539,60:2.122} },
    { min: 15001,  max: 25000,  coeff: {12:6.042,24:4.627,30:3.778,36:3.213,48:2.512,60:2.097} },
    { min: 25001,  max: 50000,  coeff: {12:5.955,24:4.548,30:3.703,36:3.141,48:2.442,60:2.028} },
    { min: 50001,  max: 100000, coeff: {12:5.918,24:4.518,30:3.678,36:3.118,48:2.423,60:2.011} },
    { min: 100001, max: null,   coeff: {12:5.872,24:4.478,30:3.643,36:3.086,48:2.394,60:1.984} },
  ],
  speseContratto: [
    { max: 5000,   spese: 50 },
    { min: 5001,   max: 10000,  spese: 75 },
    { min: 10001,  max: 25000,  spese: 100 },
    { min: 25001,  max: 50000,  spese: 150 },
    { min: 50001,  max: 100000, spese: 200 },
    { min: 100001, max: 200000, spese: 300 },
    { min: 200001, max: null,   spese: 500 },
  ],
  riscattoPercentuale: 1, // 1% dell'imponibile, dovuto a fine noleggio
  limiteMassimo: null, // nessun tetto: l'ultima fascia è aperta
};

function trovaFascia(fasce, importo){
  return fasce.find(f => (f.min===undefined || importo>=f.min) && (f.max===undefined || f.max===null || importo<=f.max)) || null;
}

// Calcola rata mensile, spese contratto e (per il noleggio) riscatto finale.
// Ritorna null se l'importo eccede il tetto del prodotto (solo finanziamento,
// il noleggio non ha limite superiore).
function calcolaFinanziamento(tipo, importo, mesi){
  const tabella = tipo==="noleggio" ? TASSI_NOLEGGIO : TASSI_FINANZIAMENTO;
  if(tabella.limiteMassimo && importo > tabella.limiteMassimo) return null;
  const fasciaCanoni = trovaFascia(tabella.canoni, importo);
  const fasciaSpese = trovaFascia(tabella.speseContratto, importo);
  if(!fasciaCanoni || !fasciaCanoni.coeff[mesi]) return null;
  const rata = +(importo * fasciaCanoni.coeff[mesi] / 100).toFixed(2);
  const speseContratto = fasciaSpese ? fasciaSpese.spese : null;
  const riscatto = tipo==="noleggio" ? +(importo * tabella.riscattoPercentuale / 100).toFixed(2) : null;
  return { rata, speseContratto, riscatto };
}

const CHECKLIST_TEMPLATES = {
  installazione:["Verifica imballo e integrità prodotto","Posizionamento secondo planimetria","Collegamento elettrico/pneumatico","Test funzionale completo","Pulizia area post-installazione"],
  riparazione:["Diagnosi del guasto","Sostituzione componente","Test funzionale post-intervento","Pulizia area di lavoro"],
  garanzia:["Verifica condizioni di garanzia","Diagnosi del difetto","Sostituzione in garanzia","Test funzionale"],
  sopralluogo:["Rilievo misure e spazi","Verifica predisposizioni","Foto ambiente di lavoro"],
};
const TIPO_LABELS = {installazione:"Installazione",riparazione:"Riparazione",garanzia:"Garanzia",sopralluogo:"Sopralluogo"};

// ─── DESIGN TOKENS — palette derivata dal logo Telos ─────────────────────────
const C = {
  ink:"#162758",          // indaco scuro del chevron — base/accento primario
  inkDeep:"#0E1A40",      // variante più scura per sfondi pieni
  surface:"#1C2D63",
  surfaceRaised:"#24377A",
  cyan:"#57CECA",         // ciano del chevron — accento secondario/highlight
  cyanDim:"#3FB3AF",
  charcoal:"#232323",     // colore del testo "TELOS" nel logo
  steel:"#7C879E",        // grigio-blu testo secondario su scuro
  steelLight:"#A9B3C6",
  ok:"#3F9D63",
  warn:"#D9A441",
  danger:"#C84B3A",
  paper:"#FAFAFA",
  paperLine:"#E3E5EA",
};

const F_DISPLAY = '"Oswald","Bebas Neue",system-ui,sans-serif';
const F_BODY = '"Inter","Helvetica Neue",system-ui,sans-serif';
const F_MONO = '"IBM Plex Mono","SF Mono",ui-monospace,monospace';

const G = `
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body{ margin:0; padding:0; }
  ::selection{ background:${C.cyan}; color:${C.inkDeep}; }
  input,select,textarea{ font-family:${F_BODY}; }
  .tnum{ font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce){ *{ transition:none !important; animation:none !important; } }
`;

function Tag({children,tone="steel",style}){
  const palette = {
    steel:{bg:"rgba(124,135,158,0.14)",fg:"#5B6779",notch:"#7C879E"},
    primary:{bg:"rgba(22,39,88,0.10)",fg:C.ink,notch:C.ink},
    cyan:{bg:"rgba(87,206,202,0.16)",fg:"#1E7A77",notch:C.cyan},
    ok:{bg:"rgba(63,157,99,0.14)",fg:C.ok,notch:C.ok},
    warn:{bg:"rgba(217,164,65,0.16)",fg:"#8a6418",notch:C.warn},
    danger:{bg:"rgba(200,75,58,0.14)",fg:C.danger,notch:C.danger},
    cream:{bg:"rgba(255,255,255,0.14)",fg:"#fff",notch:"#fff"},
  }[tone];
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,fontFamily:F_MONO,fontSize:10,fontWeight:600,letterSpacing:"0.03em",textTransform:"uppercase",padding:"3px 8px 3px 6px",borderRadius:3,background:palette.bg,color:palette.fg,whiteSpace:"nowrap",...style}}>
      <span style={{width:3,height:3,borderRadius:1,background:palette.notch,flexShrink:0}}/>
      {children}
    </span>
  );
}

// Componente logo riutilizzabile:
// variant="symbol"    → solo il chevron (per spazi piccoli, sidebar collassata)
// variant="full"      → TELOS + chevron (logo header principale)
// variant="telostech" → logo reparto Telos Tech completo con ingranaggio
function Logo({ variant="symbol", height=28 }){
  if(variant==="telostech"){
    // Proporzione originale: 707×343 → ratio 2.06
    return <img src={LOGO_TELOSTECH} alt="Telos Tech" style={{height, width:height*2.06, objectFit:"contain", display:"block"}}/>;
  }
  const src = variant==="full" ? LOGO_FULL : LOGO_SYMBOL;
  const ratio = variant==="full" ? 464/140 : 128/140;
  return <img src={src} alt="Telos" style={{height, width:height*ratio, objectFit:"contain", display:"block"}}/>;
}

const S = {
  app:{display:"flex",height:"100dvh",overflow:"hidden",fontFamily:F_BODY,fontSize:14,background:C.paper,color:C.charcoal},
  sidebar:{width:222,minWidth:222,background:C.inkDeep,display:"flex",flexDirection:"column",borderRight:`1px solid ${C.surface}`},
  navItem:{display:"flex",alignItems:"center",gap:11,padding:"10px 14px",cursor:"pointer",fontSize:13,color:C.steelLight,position:"relative",borderLeft:"2px solid transparent"},
  navActive:{background:"rgba(87,206,202,0.08)",color:"#fff",borderLeft:`2px solid ${C.cyan}`},
  main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0},
  topbar:{height:54,borderBottom:`1px solid ${C.paperLine}`,display:"flex",alignItems:"center",padding:"0 18px",gap:10,background:"#fff",flexShrink:0},
  content:{flex:1,overflowY:"auto",padding:"16px 16px 84px"},
  card:{background:"#fff",border:`1px solid ${C.paperLine}`,borderRadius:8,padding:"13px 15px",marginBottom:8,cursor:"pointer",position:"relative"},
  inp:{border:`1px solid ${C.paperLine}`,borderRadius:7,padding:"10px 12px",fontSize:13.5,background:"#fff",color:C.charcoal,width:"100%",outline:"none"},
  sel:{border:`1px solid ${C.paperLine}`,borderRadius:7,padding:"7px 9px",fontSize:12.5,background:"#fff",cursor:"pointer",color:C.charcoal},
  btnP:{background:C.ink,color:"#fff",border:"none",borderRadius:7,padding:"10px 16px",fontSize:13,cursor:"pointer",fontWeight:600,letterSpacing:"0.01em"},
  btnAccent:{background:C.cyan,color:C.inkDeep,border:"none",borderRadius:7,padding:"10px 16px",fontSize:13,cursor:"pointer",fontWeight:700},
  btnS:{background:"none",border:`1px solid ${C.paperLine}`,borderRadius:7,padding:"9px 14px",fontSize:12.5,cursor:"pointer",color:"#5B6770",fontWeight:500},
  eyebrow:{fontFamily:F_MONO,fontSize:10.5,fontWeight:600,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:9},
};

export default function App(){
  const { sessione, caricando: authLoading, errore: authErrore, login: authLogin, logout: authLogout } = useAuth();
  const role = sessione?.ruolo || null;
  const [area, setArea] = useState("home");
  const [showMore, setShowMore] = useState(false);
  const [cart, setCart] = useState([]);
  const [preventivi, setPreventivi] = useState([]);
  const [ordini, setOrdini] = useState([]);
  const [attrezzature, setAttrezzature] = useState([]);
  const [interventi, setInterventi] = useState([]);
  const [promemoria, setPromemoria] = useState([]);
  const [interventoDaCompletare, setInterventoDaCompletare] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [msgInput, setMsgInput] = useState("");
  const [aiTyping, setAiTyping] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [catalog, setCatalog] = useState(CATALOG); // parte col demo, poi si aggiorna
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [dbOnline, setDbOnline] = useState(null); // null=non testato, true/false
  const [nuovaVersione, setNuovaVersione] = useState(false);

  useEffect(()=>{
    const check=()=>setIsMobile(window.innerWidth < 860);
    check();
    window.addEventListener("resize",check);
    return ()=>window.removeEventListener("resize",check);
  },[]);

  // Rileva nuovi deploy mentre l'app è già aperta in una scheda. L'header
  // no-cache su index.html (vercel.json) fa sì che questo fetch veda sempre
  // la versione realmente pubblicata; confrontiamo il file JS referenziato
  // con quello attualmente caricato (identificato dal nome con hash che Vite
  // genera ad ogni build). Se diverso, avvisiamo invece di forzare il reload
  // a sorpresa mentre magari si sta compilando un preventivo.
  useEffect(()=>{
    const scriptTag = document.querySelector('script[type="module"][src]');
    const versioneCaricata = scriptTag?.getAttribute("src") || null;
    if(!versioneCaricata) return; // ambiente non standard (es. dev server): non applicabile

    async function controllaAggiornamento(){
      try{
        const res = await fetch("/index.html", { cache: "no-store" });
        const html = await res.text();
        let versioneServer = null;
        for(const m of html.matchAll(/<script\b[^>]*>/g)){
          const tag = m[0];
          if(/type=["']module["']/.test(tag)){
            const srcMatch = tag.match(/src=["']([^"']+)["']/);
            if(srcMatch){ versioneServer = srcMatch[1]; break; }
          }
        }
        if(versioneServer && versioneServer !== versioneCaricata){
          setNuovaVersione(true);
        }
      }catch{ /* rete assente: ignora, riprova al prossimo giro */ }
    }

    const interval = setInterval(controllaAggiornamento, 5*60*1000); // ogni 5 minuti
    return ()=>clearInterval(interval);
  },[]);

  // Carica il catalogo reale da Supabase appena l'app monta
  useEffect(()=>{
    setCatalogLoading(true);
    caricaCatalogo(CATALOG).then(dati => {
      setCatalog(dati);
      setDbOnline(dati !== CATALOG);
      setCatalogLoading(false);
    });
  },[]);

  // Carica i preventivi reali da Supabase appena l'utente è loggato (serve
  // il token di sessione, quindi non si può fare prima del login come per
  // il catalogo). Restano condivisi tra tutti gli utenti autenticati.
  useEffect(()=>{
    if(!role) return;
    const accessToken = trovaAccessToken(sessione);
    if(!accessToken) return;
    sbGetAuth("preventivi", "select=*&order=creato_il.desc&limit=500", accessToken)
      .then(dati => setPreventivi(dati || []))
      .catch(err => console.warn("Preventivi non raggiungibili:", err.message));
    sbGetAuth("ordini", "select=*&order=creato_il.desc&limit=500", accessToken)
      .then(dati => setOrdini(dati || []))
      .catch(err => console.warn("Ordini non raggiungibili:", err.message));
    sbGetAuth("attrezzature", "select=*&order=creato_il.desc&limit=1000", accessToken)
      .then(dati => setAttrezzature(dati || []))
      .catch(err => console.warn("Attrezzature non raggiungibili:", err.message));
    sbGetAuth("interventi", "select=*&order=data_pianificata.desc.nullslast,creato_il.desc&limit=1000", accessToken)
      .then(dati => setInterventi(dati || []))
      .catch(err => console.warn("Interventi non raggiungibili:", err.message));
    sbGetAuth("promemoria", "select=*&order=scadenza.asc.nullslast,creato_il.desc&limit=500", accessToken)
      .then(dati => setPromemoria(dati || []))
      .catch(err => console.warn("Promemoria non raggiungibili:", err.message));
  },[role]);

  // permessi/nav dal ruolo, ma nome reale dalla sessione
  const r = role ? { ...RUOLI[role], nome: sessione?.nome || RUOLI[role].nome } : null;

  async function login(email,password){ const ok = await authLogin(email,password); if(ok){ setArea("home"); setMsgs([]); } return ok; }
  async function logout(){ await authLogout(); setArea("home"); setMsgs([]); setCart([]); }

  async function sendMsg(text){
    if(!text.trim()) return;
    const cronologia = [...msgs, {role:"user",text}];
    setMsgs(cronologia);
    setMsgInput("");

    const accessToken = trovaAccessToken(sessione);
    setAiTyping(true);
    try{
      const { risposta } = await chiamaAiAssistant(
        { tipo:"chat", messaggi: cronologia, ruolo: role },
        accessToken
      );
      setMsgs(m=>[...m,{role:"ai",text:risposta}]);
    }catch(err){
      // Fallback offline: se l'Edge Function non risponde (rete, chiave non
      // configurata, sessione scaduta) l'assistente resta comunque utile
      // invece di restituire solo un errore secco.
      setMsgs(m=>[...m,{role:"ai",text:aiReplyFallback(text,catalog)}]);
    }finally{
      setAiTyping(false);
    }
  }

  // Risposte locali di riserva, usate solo se la chiamata all'assistente
  // reale (Edge Function ai-assistant) fallisce.
  function aiReplyFallback(q, cat){
    const l=q.toLowerCase();
    if(l.includes("ponte")){
      const res=(cat||CATALOG).filter(p=>p.cat==="PONTI SOLLEVATORI").slice(0,3);
      return "Ponti sollevatori disponibili —\n\n"+res.map(p=>`· ${p.mar} ${p.nome} — €${p.netto.toFixed(2)}`).join("\n");
    }
    if(l.includes("preventivo")) return "Apri Catalogo per selezionare gli articoli, poi genera il documento da Preventivi.";
    if(l.includes("rapporto")) return "Vai su Rapporto tecnico per la compilazione guidata con checklist.";
    if(l.includes("cliente")) return "Apri Clienti — puoi cercare per ragione sociale o numero di serie del prodotto.";
    return `Assistente non raggiungibile al momento (${(cat||CATALOG).length} articoli indicizzati). Riprova tra poco.`;
  }

  if(authLoading) return (
    <div style={{minHeight:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:C.inkDeep,color:C.steelLight,fontFamily:F_MONO,fontSize:12}}>
      <style>{G}</style>Caricamento…
    </div>
  );
  if(!role) return <LoginReale onLogin={login} errore={authErrore} Logo={Logo} G={G} C={C} S={S} F_BODY={F_BODY} F_MONO={F_MONO}/>;

  const navList = isMobile ? navMobile(r.nav) : r.nav;

  return (
    <div style={S.app}>
      <style>{G}</style>

      {nuovaVersione && (
        <div style={{position:"fixed",top:0,left:0,right:0,background:C.ink,color:"#fff",padding:"9px 14px",fontSize:12.5,display:"flex",justifyContent:"center",alignItems:"center",gap:12,zIndex:200}}>
          <span>È disponibile una nuova versione dell'app.</span>
          <button onClick={()=>window.location.reload()} style={{background:"#fff",color:C.ink,border:"none",borderRadius:6,padding:"4px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Aggiorna ora</button>
        </div>
      )}

      {!isMobile && (
        <div style={S.sidebar}>
          <div style={{padding:"20px 14px 18px",borderBottom:`1px solid ${C.surface}`,display:"flex",justifyContent:"center"}}>
            <img src={LOGO_TELOSTECH} alt="Telos Tech" style={{height:46,width:46*2.06,objectFit:"contain",display:"block",filter:"brightness(1.9) contrast(0.85)"}}/>
          </div>
          <div style={{padding:"10px 0",flex:1,overflowY:"auto"}}>
            {r.nav.map(id=>(
              <div key={id} onClick={()=>setArea(id)} style={{...S.navItem,...(area===id?S.navActive:{})}}>
                <span style={{fontSize:15,width:18,textAlign:"center",opacity:area===id?1:0.7}}>{NAV_META[id].icon}</span>
                <span style={{flex:1,fontWeight:area===id?600:400}}>{NAV_META[id].label}</span>
              </div>
            ))}
          </div>
          <div style={{padding:"12px 14px",borderTop:`1px solid ${C.surface}`}}>
            <div onClick={logout} style={{display:"flex",alignItems:"center",gap:9,padding:6,borderRadius:6,cursor:"pointer"}}>
              <div style={{width:30,height:30,borderRadius:5,background:C.cyan,color:C.inkDeep,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:F_MONO,flexShrink:0}}>{r.initials}</div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:12.5,fontWeight:600,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.nome}</div>
                <div style={{fontSize:10.5,color:C.steel,fontFamily:F_MONO,letterSpacing:"0.03em"}}>{r.label.toUpperCase()} · ESCI</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={S.main}>
        <div style={S.topbar}>
          {isMobile && (
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              <Logo variant="telostech" height={22}/>
              <div style={{width:1,height:16,background:C.paperLine,flexShrink:0}}/>
              <Logo variant="symbol" height={18}/>
            </div>
          )}
          <span style={{fontFamily:F_DISPLAY,fontSize:isMobile?13:15,fontWeight:500,color:"#5B6779",flex:1,letterSpacing:"0.01em",textTransform:"uppercase",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {!isMobile && NAV_META[area].label}
          </span>
          {catalogLoading && (
            <span style={{fontSize:10,fontFamily:F_MONO,color:C.steel,flexShrink:0}}>⏳ DB…</span>
          )}
          {!catalogLoading && dbOnline===true && !isMobile && (
            <span title={`${catalog.length} prodotti dal database`} style={{fontSize:10,fontFamily:F_MONO,color:C.ok,flexShrink:0}}>● LIVE</span>
          )}
          {!catalogLoading && dbOnline===false && !isMobile && (
            <span title="Dati demo — DB non raggiungibile" style={{fontSize:10,fontFamily:F_MONO,color:C.warn,flexShrink:0}}>● DEMO</span>
          )}
          {cart.length>0 && area!=="ai" && (
            <span onClick={()=>setArea("preventivi")} className="tnum" style={{fontFamily:F_MONO,fontSize:11.5,fontWeight:600,color:"#fff",background:C.ink,padding:"5px 10px",borderRadius:5,cursor:"pointer",flexShrink:0}}>
              {cart.length} · €{cart.reduce((s,p)=>s+p.netto,0).toFixed(0)}
            </span>
          )}
          {area!=="ai" && (
            <button onClick={()=>setArea("ai")} style={{...S.btnP,padding:isMobile?"7px 11px":"8px 14px",fontSize:12,flexShrink:0}}>✦ {!isMobile&&"Assistente"}</button>
          )}
        </div>

        <div style={S.content}>
          {area==="home" && <Home r={r} role={role} setArea={setArea} isMobile={isMobile} preventivi={preventivi} interventi={interventi} promemoria={promemoria} sessione={sessione}/>}
          {area==="ai" && <AIChat msgs={msgs} msgInput={msgInput} setMsgInput={setMsgInput} sendMsg={sendMsg} aiTyping={aiTyping}/>}
          {area==="prodotti" && <Prodotti cart={cart} setCart={setCart} catalog={catalog} catalogLoading={catalogLoading} sessione={sessione} ruolo={role} setCatalog={setCatalog} setArea={setArea}/>}
          {area==="clienti" && <Clienti sessione={sessione} preventivi={preventivi} ordini={ordini} attrezzature={attrezzature} setAttrezzature={setAttrezzature} interventi={interventi} setInterventi={setInterventi} catalog={catalog} ruolo={role}/>}
          {area==="promemoria" && <Promemoria sessione={sessione} ruolo={role} preventivi={preventivi} interventi={interventi} ordini={ordini} promemoria={promemoria} setPromemoria={setPromemoria} setArea={setArea}/>}
          {area==="preventivi" && <Preventivi cart={cart} setCart={setCart} preventivi={preventivi} setPreventivi={setPreventivi} setOrdini={setOrdini} setArea={setArea} ruolo={role} catalog={catalog} sessione={sessione}/>}
          {area==="ordini" && <Ordini ordini={ordini} setOrdini={setOrdini} preventivi={preventivi} setPreventivi={setPreventivi} setInterventi={setInterventi} catalog={catalog} sessione={sessione} ruolo={role}/>}
          {area==="interventi" && <Interventi interventi={interventi} setInterventi={setInterventi} attrezzature={attrezzature} sessione={sessione} setArea={setArea} setInterventoDaCompletare={setInterventoDaCompletare}/>}
          {area==="rapporti" && <RapportoDemo sessione={sessione} interventi={interventi} setInterventi={setInterventi} interventoDaCompletare={interventoDaCompletare} setInterventoDaCompletare={setInterventoDaCompletare}/>}
          {area==="analytics" && RUOLI_APPROVATORI.includes(role) && <CondizioniAcquisto/>}
          {area==="analytics" && !RUOLI_APPROVATORI.includes(role) && <Placeholder area={area} setArea={setArea}/>}
          {area==="saltati" && RUOLI_APPROVATORI.includes(role) && <PreventiviSaltati preventivi={preventivi}/>}
          {area==="saltati" && !RUOLI_APPROVATORI.includes(role) && <Placeholder area={area} setArea={setArea}/>}
          {area==="admin" && <PannelloAdmin setCatalog={setCatalog} ruolo={role} sessione={sessione}/>}
        </div>

        {isMobile && (
          <div style={{position:"sticky",bottom:0,background:C.inkDeep,borderTop:`1px solid ${C.surface}`,display:"flex",paddingBottom:"env(safe-area-inset-bottom)"}}>
            {navList.map(id=>{
              if(id==="more"){
                return (
                  <button key="more" onClick={()=>setShowMore(true)} style={{flex:1,background:"none",border:"none",padding:"9px 4px 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",color:C.steelLight}}>
                    <span style={{fontSize:17}}>⋯</span>
                    <span style={{fontSize:9.5,fontFamily:F_MONO,letterSpacing:"0.02em"}}>ALTRO</span>
                  </button>
                );
              }
              const active = area===id;
              return (
                <button key={id} onClick={()=>setArea(id)} style={{flex:1,background:"none",border:"none",padding:"9px 4px 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",color:active?C.cyan:C.steelLight,position:"relative"}}>
                  {active && <span style={{position:"absolute",top:0,left:"30%",right:"30%",height:2,background:C.cyan}}/>}
                  <span style={{fontSize:17}}>{NAV_META[id].icon}</span>
                  <span style={{fontSize:9.5,fontFamily:F_MONO,letterSpacing:"0.02em",fontWeight:active?700:400}}>{NAV_META[id].label.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isMobile && showMore && (
        <div onClick={()=>setShowMore(false)} style={{position:"fixed",inset:0,background:"rgba(14,26,64,0.55)",display:"flex",alignItems:"flex-end",zIndex:100}}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.inkDeep,borderRadius:"14px 14px 0 0",width:"100%",padding:"8px 0 calc(env(safe-area-inset-bottom) + 8px)"}}>
            <div style={{width:36,height:4,background:C.surface,borderRadius:2,margin:"6px auto 10px"}}/>
            {r.nav.map(id=>(
              <div key={id} onClick={()=>{setArea(id);setShowMore(false);}} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 20px",cursor:"pointer",color:area===id?"#fff":C.steelLight}}>
                <span style={{fontSize:18,width:20,textAlign:"center"}}>{NAV_META[id].icon}</span>
                <span style={{fontSize:14,fontWeight:area===id?600:400}}>{NAV_META[id].label}</span>
              </div>
            ))}
            <div style={{borderTop:`1px solid ${C.surface}`,marginTop:6}}>
              <div onClick={logout} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 20px",cursor:"pointer",color:C.cyan}}>
                <span style={{fontSize:18,width:20,textAlign:"center"}}>⏻</span>
                <span style={{fontSize:14,fontWeight:500}}>Esci · {r.nome}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LOGIN ──────────────────────────────────────────────────────────────────────
// ─── HOME ───────────────────────────────────────────────────────────────────────
// ─── PROMEMORIA "AUTOMATICI" ────────────────────────────────────────────────
// Non sono righe salvate su una tabella: si calcolano al volo da preventivi e
// interventi già caricati, così restano sempre aggiornati senza rischio di
// doppioni o dati vecchi (stesso principio già usato per le scadenze
// attrezzature in Interventi). Condivisi tra Home (badge/anteprima) e
// Promemoria (elenco completo).
const GIORNI_PREAVVISO_PROMEMORIA = 7;

function giorniA(dataStr){
  if(!dataStr) return null;
  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const d = new Date(dataStr); d.setHours(0,0,0,0);
  return Math.round((d-oggi)/(1000*60*60*24));
}
// Preventivi "Inviato" ancora da gestire (tutto il team, come in ListaPreventivi).
function preventiviDaGestire(preventivi){
  return (preventivi||[]).filter(p=>p.stato==="Inviato");
}
// Trattative "vendita rimandata" con un richiamo impostato, con i giorni al richiamo.
function trattativeDaRecuperare(preventivi){
  return (preventivi||[])
    .filter(p=>p.stato==="Saltato" && p.motivo_saltato_tipo==="rimandata" && p.promemoria_recupero)
    .map(p=>({...p, giorni: giorniA(p.promemoria_recupero)}))
    .sort((a,b)=>new Date(a.promemoria_recupero)-new Date(b.promemoria_recupero));
}
function trattativeDaRecuperareVicine(preventivi){
  return trattativeDaRecuperare(preventivi).filter(p=>p.giorni<=GIORNI_PREAVVISO_PROMEMORIA);
}
// Interventi pianificati (aggiunti, non ancora gestiti/completati).
function interventiDaGestire(interventi){
  return (interventi||[]).filter(i=>i.stato==="Pianificato");
}
function interventiScadenzaVicina(interventi){
  return interventiDaGestire(interventi)
    .filter(i=>i.data_pianificata)
    .map(i=>({...i, giorni: giorniA(i.data_pianificata)}))
    .filter(i=>i.giorni<=GIORNI_PREAVVISO_PROMEMORIA)
    .sort((a,b)=>a.giorni-b.giorni);
}
function interventiMancaInfo(interventi){
  return (interventi||[]).filter(i=>i.manca_info);
}
// Quanti elementi richiedono attenzione a breve — usato per il badge sulla
// dashboard. Volutamente non conta i "da gestire" generici (sono un
// backlog, non un'urgenza), solo le scadenze vicine/scadute e i propri
// promemoria liberi ancora aperti.
function contaAttenzionePromemoria(ruolo, preventivi, interventi, promemoriaPropri){
  let n = (promemoriaPropri||[]).filter(p=>p.stato==="aperto").length;
  if(ruolo==="commerciale" || ruolo==="responsabile" || ruolo==="admin"){
    n += trattativeDaRecuperareVicine(preventivi).length;
  }
  if(ruolo==="tecnico" || ruolo==="responsabile" || ruolo==="admin"){
    n += interventiScadenzaVicina(interventi).length + interventiMancaInfo(interventi).length;
  }
  return n;
}

function Home({r,role,setArea,isMobile,preventivi,interventi,promemoria,sessione}){
  const isT=role==="tecnico";
  const ora = new Date();
  const saluto = ora.getHours()<12?"Buongiorno":ora.getHours()<18?"Buon pomeriggio":"Buonasera";
  const dataFmt = ora.toLocaleDateString("it-IT",{weekday:"short",day:"numeric",month:"short"}).toUpperCase();
  const interventiPianificati = (interventi||[]).filter(i=>i.stato==="Pianificato")
    .sort((a,b)=>new Date(a.data_pianificata||"9999-12-31")-new Date(b.data_pianificata||"9999-12-31"));
  // Promemoria propri (per nome, come già fatto altrove nell'app — es.
  // mieiSaltati in ListaPreventivi — non abbiamo l'id utente lato client).
  const promemoriaPropri = (promemoria||[]).filter(p=>p.autore_nome===sessione?.nome);
  const contaPromemoria = contaAttenzionePromemoria(role, preventivi, interventi, promemoriaPropri);

  return (
    <div>
      {/* Header: Telos Tech (sinistra) | Telos (destra) */}
      <div style={{marginBottom:22,paddingBottom:18,borderBottom:`1px solid ${C.paperLine}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",marginBottom:12}}>
          <Logo variant="full" height={isMobile?22:28}/>
        </div>
        <div style={{fontSize:isMobile?15:18,fontWeight:600,color:C.charcoal,letterSpacing:"0.01em"}}>
          {saluto}, <span style={{color:C.ink}}>{r.nome.split(" ")[0]}</span>
        </div>
        <div style={{fontSize:11.5,color:"#9AA3AB",fontFamily:F_MONO,marginTop:3,letterSpacing:"0.04em"}}>{dataFmt}</div>
      </div>

      {/* Da gestire */}
      <div style={S.eyebrow}>Da gestire</div>
      {isT?(interventiPianificati.length>0 ? interventiPianificati.slice(0,2).map(i=>(
        <div key={i.id} onClick={()=>setArea("interventi")} style={{...S.card,borderLeft:`3px solid ${i.priorita==="alta"?C.danger:C.warn}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13.5}}>{TIPO_LABELS[i.tipo]||i.tipo}</div>
              <div style={{fontSize:11.5,color:"#8A929A",marginTop:2}}>{i.cliente_nome || "Cliente non specificato"}</div>
            </div>
            {i.data_pianificata && <span style={{fontFamily:F_MONO,fontSize:10.5,color:"#8A929A",flexShrink:0}}>{new Date(i.data_pianificata).toLocaleDateString("it-IT")}</span>}
          </div>
        </div>
      )) : (
        <div onClick={()=>setArea("interventi")} style={{...S.card,cursor:"pointer"}}>
          <div style={{fontSize:12.5,color:"#9AA3AB"}}>Nessun intervento pianificato</div>
        </div>
      )):(preventivi.length>0 ? preventivi.slice(0,2).map(p=>(
        <div key={p.id} onClick={()=>setArea("preventivi")} style={{...S.card,borderLeft:`3px solid ${p.stato==="Inviato"?C.warn:C.steel}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13.5}}>{p.cliente || "Cliente non specificato"}</div>
              <div style={{fontSize:11.5,color:"#8A929A",marginTop:2}}>{p.righe.length} articol{p.righe.length===1?"o":"i"} · {p.stato}</div>
            </div>
            <span className="tnum" style={{fontFamily:F_MONO,fontSize:13,fontWeight:600,flexShrink:0}}>€{p.val.toLocaleString("it-IT")}</span>
          </div>
        </div>
      )) : (
        <div onClick={()=>setArea("preventivi")} style={{...S.card,cursor:"pointer"}}>
          <div style={{fontSize:12.5,color:"#9AA3AB"}}>Nessun preventivo in corso — tocca per crearne uno</div>
        </div>
      ))}

      {/* Accesso rapido — card bordate leggere, accento solo sull'icona */}
      <div style={{...S.eyebrow,marginTop:22}}>Accesso rapido</div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:8}}>
        {[
          ["prodotti","▣","Catalogo"],
          ["clienti","◉","Clienti"],
          ["promemoria","⚑","Promemoria",contaPromemoria],
          ["ai","✦","Assistente"],
          [isT?"rapporti":"preventivi",isT?"☑":"▤",isT?"Rapporto":"Preventivo"]
        ].map(([id,icon,lbl,badge])=>(
          <div key={id} onClick={()=>setArea(id)} style={{
            position:"relative",
            background:"#fff", border:`1px solid ${C.paperLine}`, borderRadius:8,
            padding:"16px 12px", cursor:"pointer", textAlign:"center",
            transition:"border-color 0.15s",
          }}
          onMouseEnter={e=>e.currentTarget.style.borderColor=C.ink}
          onMouseLeave={e=>e.currentTarget.style.borderColor=C.paperLine}>
            {badge>0 && (
              <span className="tnum" style={{position:"absolute",top:8,right:8,minWidth:16,height:16,borderRadius:8,background:C.danger,color:"#fff",fontSize:9.5,fontWeight:700,fontFamily:F_MONO,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px"}}>{badge}</span>
            )}
            <div style={{fontSize:20,color:C.ink,marginBottom:6}}>{icon}</div>
            <div style={{fontSize:12,color:C.charcoal,fontWeight:600}}>{lbl}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ASSISTENTE AI ────────────────────────────────────────────────────────────
function AIChat({msgs,msgInput,setMsgInput,sendMsg,aiTyping}){
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:10,paddingBottom:8}}>
        <div style={{display:"flex",gap:9}}>
          <div style={{width:26,height:26,borderRadius:5,background:C.ink,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:C.cyan,flexShrink:0}}>✦</div>
          <div style={{background:"#fff",border:`1px solid ${C.paperLine}`,borderRadius:"3px 10px 10px 10px",padding:"10px 13px",fontSize:13,maxWidth:"82%",lineHeight:1.55}}>Assistente Telos Tech. Chiedi su prodotti, preventivi, rapporti tecnici o clienti.</div>
        </div>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",gap:9,justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            {m.role==="ai"&&<div style={{width:26,height:26,borderRadius:5,background:C.ink,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:C.cyan,flexShrink:0}}>✦</div>}
            <div style={{background:m.role==="ai"?"#fff":C.ink,color:m.role==="ai"?C.charcoal:"#fff",border:m.role==="ai"?`1px solid ${C.paperLine}`:"none",borderRadius:m.role==="ai"?"3px 10px 10px 10px":"10px 3px 10px 10px",padding:"10px 13px",fontSize:13,maxWidth:"82%",whiteSpace:"pre-line",lineHeight:1.55}}>{m.text}</div>
          </div>
        ))}
        {aiTyping && (
          <div style={{display:"flex",gap:9}}>
            <div style={{width:26,height:26,borderRadius:5,background:C.ink,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:C.cyan,flexShrink:0}}>✦</div>
            <div style={{background:"#fff",border:`1px solid ${C.paperLine}`,borderRadius:"3px 10px 10px 10px",padding:"10px 13px",fontSize:13,color:C.steel,fontStyle:"italic"}}>sta scrivendo…</div>
          </div>
        )}
      </div>
      <div style={{borderTop:`1px solid ${C.paperLine}`,paddingTop:11,display:"flex",gap:8}}>
        <input value={msgInput} onChange={e=>setMsgInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!aiTyping)sendMsg(msgInput);}} placeholder="Chiedi qualcosa…" style={S.inp} disabled={aiTyping}/>
        <button onClick={()=>{if(!aiTyping)sendMsg(msgInput);}} disabled={aiTyping} style={{...S.btnAccent,width:42,height:42,padding:0,fontSize:15,opacity:aiTyping?0.5:1}}>↑</button>
      </div>
    </div>
  );
}

// ─── MOTORE DI RICERCA INTELLIGENTE ───────────────────────────────────────────
// Livello 1 (istantaneo): normalizza rimuovendo spazi/slash/punteggiatura e
// confronta per token, così "199 gk", "199/gk", "199-GK" trovano lo stesso pezzo.
// Livello 2 (su richiesta): se la ricerca testuale a token non trova nulla,
// interpreta la query in linguaggio naturale (es. "ponte 32 qli") leggendo
// anche le descrizioni tecniche dei prodotti, via API Anthropic.

function normalizza(s){
  return (s||"")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"") // rimuove accenti
    .replace(/[\/\-_.,;:()]/g," ")                     // slash, trattini, punteggiatura -> spazio
    .replace(/\s+/g," ")
    .trim();
}

// Numeri scritti in lettere -> cifra, per far combaciare la ricerca
// indipendentemente da come sono scritti (es. il catalogo dice "2 colonne"
// e l'utente cerca "due colonne", o viceversa). "uno/un/una" sono esclusi
// perché in italiano sono anche articoli/pronomi molto comuni: convertirli
// in "1" farebbe fallire ricerche normalissime come "un ponte sollevatore"
// (la query pretenderebbe di trovare anche la cifra "1" nel prodotto).
const NUMERI_IN_LETTERE = {
  zero:"0", due:"2", tre:"3", quattro:"4", cinque:"5",
  sei:"6", sette:"7", otto:"8", nove:"9", dieci:"10", undici:"11", dodici:"12",
  tredici:"13", quattordici:"14", quindici:"15", sedici:"16", diciassette:"17",
  diciotto:"18", diciannove:"19", venti:"20",
};

function tokenizza(s){
  return normalizza(s).split(" ").filter(Boolean)
    .map(t => NUMERI_IN_LETTERE[t] || t);
}

// Stemming leggero per l'italiano: tronca i suffissi di genere/numero più
// comuni così "ponte"≈"ponti", "ruota"≈"ruote", "diagnosi"≈"diagnostica"
// vengono riconosciuti come la stessa famiglia di parole. Non è un vero
// motore linguistico, solo euristiche pratiche per i casi più frequenti
// nei nomi prodotto (singolare/plurale maschile e femminile).
function radice(parola){
  if(parola.length <= 4) return parola; // parole corte: non troncare, troppo rischioso
  let p = parola;
  // plurali e desinenze comuni, dalla più specifica alla più generica
  const suffissi = ["azione","zione","mente","issima","istico","aggio","ale","ali","ari","ico","ica","ici","iche","ie","tà","oni","one","ori","ore","tori","tore","anti","ante","enti","ente","i","e","o","a"];
  for(const suf of suffissi){
    if(p.length - suf.length >= 4 && p.endsWith(suf)){
      p = p.slice(0, p.length - suf.length);
      break;
    }
  }
  return p;
}

// ─── CONDIZIONI DI ACQUISTO (demo — in produzione: tabella condizioni_acquisto_marchio) ───
// Condizioni standard per marchio: sconto % sul listino come costo di acquisto.
// Derivate dal catalogo reale, da aggiornare con i contratti fornitori effettivi.
// Condizioni: { sconto: % sul listino, extra: % aggiuntivo a cascata }
// Costo = listino × (1 - sconto/100) × (1 - extra/100)
// Es. 50% + extra 5%: costo = listino × 0.50 × 0.95 = listino × 0.475 (non 55%)
const CONDIZIONI_ACQUISTO_MARCHIO = {
  "AUTEL":       {sconto:9.5,  extra:0},
  "BEISSBARTH":  {sconto:34,   extra:0},
  "BETA":        {sconto:35.5, extra:0},
  "BIO CIRCLE":  {sconto:19,   extra:0},
  "BOSCH":       {sconto:14.5, extra:0},
  "COMET":       {sconto:41,   extra:0},
  "FASANO":      {sconto:41.5, extra:0},
  "FILCAR":      {sconto:54.5, extra:0},
  "FINI":        {sconto:50.5, extra:0},
  "GEATEK":      {sconto:20.5, extra:0},
  "GENERICO":    {sconto:34.5, extra:0},
  "GOVONI":      {sconto:34,   extra:0},
  "GYS":         {sconto:15.5, extra:0},
  "MAGIDO":      {sconto:22,   extra:0},
  "MAHLE Brain Bee":{sconto:5, extra:0},
  "MARELLI":     {sconto:14.5, extra:0},
  "MECLUBE":     {sconto:35,   extra:0},
  "MMB SOFTWARE":{sconto:10,   extra:0},
  "OMCN":        {sconto:39,   extra:0},
  "RAVAGLIOLI":  {sconto:41.5, extra:0},
  "SICAM":       {sconto:32,   extra:0},
  "SNAPON":      {sconto:40.5, extra:0},
  "SPIN":        {sconto:24.5, extra:0},
  "TELWIN":      {sconto:36.5, extra:0},
  "TEXA":        {sconto:22,   extra:0},
  "TREDLAB":     {sconto:0,    extra:0},
  "WORKY":       {sconto:13.5, extra:0},
  "ZECA":        {sconto:43,   extra:0},
};

function scontoEffettivo(sconto, extra){
  // Sconto a cascata: applico prima lo sconto base, poi l'extra sul residuo
  // Risultato: 1 - (1 - s/100) × (1 - e/100) — NON è la somma semplice
  return 100 * (1 - (1 - sconto/100) * (1 - extra/100));
}

// Costi esclusivi per singolo articolo (prevalono sulla condizione marchio)
let COSTI_ESCLUSIVI = {}; // { cod: { costo, note } }

function getCostoAcquisto(p){
  // 1. Costo esclusivo per articolo (la priorità più alta)
  if(COSTI_ESCLUSIVI[p.cod]) return { costo: COSTI_ESCLUSIVI[p.cod].costo, tipo:"esclusivo" };
  // 2. Condizione standard per marchio con eventuale extra
  const cond = CONDIZIONI_ACQUISTO_MARCHIO[p.mar];
  if(cond != null && p.listino > 0){
    const costo = p.listino * (1 - cond.sconto/100) * (1 - (cond.extra||0)/100);
    const effettivo = scontoEffettivo(cond.sconto, cond.extra||0);
    return { costo, tipo:"marchio", sconto_pct: cond.sconto, extra_pct: cond.extra||0, effettivo_pct: effettivo };
  }
  // 3. Nessuna condizione nota — non calcolabile
  return null;
}

// ─── REGOLE DI MARGINE PER LA MODIFICA PREZZO IN PREVENTIVO ──────────────────
const MARGINE_MINIMO_PERC = 15; // sotto questa percentuale -> richiede approvazione
const RUOLI_APPROVATORI = ["responsabile","admin"];

function calcolaMargine(netto, costo){
  if(!costo || costo<=0 || !netto || netto<=0) return null;
  return ((netto - costo) / netto) * 100;
}
function calcolaMarginePerProdotto(p, nettoOverride){
  const netto = nettoOverride ?? p.netto;
  const costoInfo = getCostoAcquisto(p);
  if(!costoInfo) return null;
  return calcolaMargine(netto, costoInfo.costo);
}
function rigaSottoMargine(riga){
  const m = calcolaMargine(riga.netto, riga.costo);
  return m!==null && m < MARGINE_MINIMO_PERC;
}
function puoModificarePrezzoLiberamente(ruolo){
  return RUOLI_APPROVATORI.includes(ruolo);
}

function buildSearchIndex(catalog){
  return catalog.map(p=>{
    const testoPrimario = [p.nome, p.cod, p.mar, p.cat].filter(Boolean).join(" ");
    const testoSecondario = [p.desc, p.desc_prev].filter(Boolean).join(" ");
    const tokensPrimari = tokenizza(testoPrimario);
    const tokensSecondari = tokenizza(testoSecondario);
    return {
      prodotto:p,
      tokensPrimari: new Set(tokensPrimari),
      radiciPrimarie: new Set(tokensPrimari.map(radice)),
      tokensSecondari: new Set(tokensSecondari),
      radiciSecondarie: new Set(tokensSecondari.map(radice)),
      testoPrimarioNorm: normalizza(testoPrimario),
    };
  });
}

// Match per token con pesi differenziati:
//   match esatto in campo primario      -> peso 3    (es. "199" nel codice prodotto)
//   match per radice in campo primario  -> peso 2.2  (es. "ponte" trova "ponti")
//   match (esatto o radice) in campo secondario -> peso 1.6 (es. "ponte" trova
//     un prodotto il cui nome/categoria non lo menzionano ma la cui
//     descrizione sì)
//   match parziale in campo primario    -> peso 1.5  (es. "199" dentro "199gk")
//   match parziale nel testo primario complessivo -> peso 1
// IMPORTANTE: con query di più parole, OGNI parola deve trovare almeno un
// match (di uno dei tipi sopra) perché il prodotto sia incluso — non basta
// che una sola parola "forte" superi la soglia. Senza questo vincolo, una
// parola corta e generica (es. "2", che compare in moltissimi codici e
// descrizioni non correlate) farebbe comparire prodotti totalmente estranei
// anche se le altre parole della ricerca non li riguardano affatto.
function searchToken(query, index){
  const qTokens = tokenizza(query);
  if(qTokens.length===0) return [];
  const SOGLIA_MINIMA = 1.5;
  const LUNGHEZZA_MIN_PARZIALE = 4; // sotto questa lunghezza, niente match per sottostringa (evita coincidenze come "vag" dentro "ravaglioli")

  const scored = index.map(entry=>{
    let score = 0;
    let parolaMancante = false;
    for(const qt of qTokens){
      let punti = 0;
      if(entry.tokensPrimari.has(qt)) punti = 3;
      else if(entry.radiciPrimarie.has(radice(qt))) punti = 2.2;
      else if(entry.tokensSecondari.has(qt) || entry.radiciSecondarie.has(radice(qt))) punti = 1.6;
      else if(qt.length >= LUNGHEZZA_MIN_PARZIALE){
        let partialPrimario = false;
        for(const t of entry.tokensPrimari){
          if(t.length < LUNGHEZZA_MIN_PARZIALE) continue;
          if(t.includes(qt) || qt.includes(t)){ partialPrimario = true; break; }
        }
        if(partialPrimario) punti = 1.5;
        else if(entry.testoPrimarioNorm.replace(/\s/g,"").includes(qt.replace(/\s/g,""))) punti = 1;
      }
      if(punti === 0){ parolaMancante = true; break; } // questa parola non trova nulla: il prodotto non è pertinente
      score += punti;
    }
    return { entry, score, parolaMancante };
  }).filter(s => !s.parolaMancante && s.score >= SOGLIA_MINIMA);

  scored.sort((a,b)=>b.score-a.score);
  return scored.map(s=>s.entry.prodotto);
}

// Chiama la Edge Function ai-assistant, che tiene la chiave Anthropic lato
// server e verifica il token di sessione prima di ogni richiesta — stesso
// schema di sicurezza già usato da admin-users e catalog-admin. Non chiamare
// mai api.anthropic.com direttamente dal frontend: la chiave finirebbe nel
// bundle JS pubblico, esattamente il problema risolto l'8 luglio con la
// service_role key di Supabase.
async function chiamaAiAssistant(payload, accessToken) {
  if (!accessToken) throw new Error("Sessione non trovata: ricarica la pagina e rieffettua il login.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Edge Function ${res.status}`);
  return data;
}

// Livello 2: interpretazione semantica via Anthropic (attraverso la Edge
// Function ai-assistant) per query descrittive che non hanno match diretto
// sui token (es. "ponte da 32 quintali elettromeccanico")
async function searchSemantica(query, catalog, accessToken){
  // Passiamo solo i campi utili per tenere il prompt leggero
  const catalogoCompatto = catalog.map(p=>({
    cod:p.cod, nome:p.nome, mar:p.mar, cat:p.cat,
    desc:p.desc, desc_prev:p.desc_prev,
  }));

  try {
    const { cods } = await chiamaAiAssistant(
      { tipo: "ricerca", query, catalogo: catalogoCompatto },
      accessToken
    );
    return (cods || []).map(cod=>catalog.find(p=>p.cod===cod)).filter(Boolean);
  } catch {
    return [];
  }
}

// ─── CATALOGO PRODOTTI ────────────────────────────────────────────────────────
// Chiave interna (non un valore reale di p.cat) usata per la voce virtuale
// "DA COMPLETARE" nel livello 1 di navigazione — raccoglie i prodotti senza
// categoria assegnata, visibile solo a responsabile/admin (vedi CompletaCategoria).
const DA_COMPLETARE = "__DA_COMPLETARE__";

// Campi che consideriamo "da completare" su un prodotto: categoria, tipologia,
// marca, settore o listino mancanti/non validi. Usata sia per il conteggio
// mostrato nella voce virtuale DA COMPLETARE sia per i filtri e i badge nel
// pannello CompletaCategoria. Un listino pari a 0 è trattato come mancante
// (nel catalogo Telos non esistono prodotti a listino zero, quindi è quasi
// certamente un dato non ancora inserito).
function campiProdottoMancanti(p){
  const mancanti=[];
  if(!p.cat || String(p.cat).trim()==="") mancanti.push("cat");
  if(!p.tip || String(p.tip).trim()==="") mancanti.push("tip");
  if(!p.mar || String(p.mar).trim()==="") mancanti.push("mar");
  if(!p.settori || String(p.settori).trim()==="") mancanti.push("settori");
  if(!p.listino || Number(p.listino)<=0) mancanti.push("listino");
  return mancanti;
}
const ETICHETTA_CAMPO = {cat:"Categoria", tip:"Tipologia", mar:"Marca", settori:"Settore", listino:"Listino"};

function Prodotti({cart,setCart,catalog:catProp,catalogLoading,sessione,ruolo,setCatalog,setArea}){
  const CATS = catProp || CATALOG;
  const accessToken = trovaAccessToken(sessione);
  const [q,setQ]=useState(""); const [detail,setDetail]=useState(null);
  const [editando,setEditando]=useState(null); // prodotto attualmente in modifica (solo admin)
  const categorieCatalogo = useMemo(()=>[...new Set(CATS.map(p=>p.cat).filter(Boolean))].sort(),[CATS]);
  const tipologieCatalogo = useMemo(()=>[...new Set(CATS.map(p=>p.tip).filter(Boolean))].sort(),[CATS]);
  const marchiCatalogo = useMemo(()=>[...new Set(CATS.map(p=>p.mar).filter(Boolean))].sort(),[CATS]);
  // Prodotti senza categoria assegnata (import/inserimento incompleto) e i
  // settori distinti già presenti nel catalogo, usati dal pannello di
  // completamento in blocco "DA COMPLETARE" (solo responsabile/admin).
  const prodottiDaCompletare = useMemo(()=>CATS.filter(p=>campiProdottoMancanti(p).length>0),[CATS]);
  const settoriCatalogo = useMemo(()=>{
    const conteggi=new Map();
    for(const p of CATS){
      for(const s of String(p.settori||"").split(",").map(s=>s.trim()).filter(Boolean)) conteggi.set(s,true);
    }
    return [...conteggi.keys()].sort();
  },[CATS]);
  const puoCompletareCategorie = ruolo==="admin" || ruolo==="responsabile";
  const [aiResults,setAiResults]=useState(null);
  const [aiSearching,setAiSearching]=useState(false);

  // L'indice di ricerca su ~27.000 prodotti è pesante da costruire: farlo
  // durante il render (useMemo) congela l'interfaccia per alcuni secondi.
  // Lo costruiamo in un useEffect (dopo il primo paint), così la vista si
  // apre subito e i pulsanti restano reattivi. Finché non è pronto, la
  // ricerca mostra semplicemente tutto il catalogo.
  const [searchIndex,setSearchIndex]=useState(null);
  useEffect(()=>{
    let annullato=false;
    // costruzione rimandata di un tick per lasciare disegnare la UI
    const t=setTimeout(()=>{
      const idx=buildSearchIndex(CATS);
      if(!annullato) setSearchIndex(idx);
    },0);
    return ()=>{annullato=true;clearTimeout(t);};
  },[CATS]);

  const tokenResults = useMemo(()=>{
    if(!q.trim()) return CATS;
    if(!searchIndex) return CATS; // indice non ancora pronto
    return searchToken(q, searchIndex);
  },[q, searchIndex, CATS]);

  // Se la ricerca a token non trova nulla e la query sembra descrittiva
  // (più di una parola, niente risultati), proviamo il livello semantico AI
  useEffect(()=>{
    setAiResults(null);
    if(!q.trim() || tokenResults.length>0) return;
    const parole = tokenizza(q);
    if(parole.length < 2) return; // query troppo corta per valere la chiamata AI
    let cancelled = false;
    setAiSearching(true);
    searchSemantica(q, CATS, accessToken).then(res=>{
      if(!cancelled){ setAiResults(res); setAiSearching(false); }
    }).catch(()=>{
      if(!cancelled){ setAiResults([]); setAiSearching(false); }
    });
    return ()=>{cancelled=true;};
  },[q, tokenResults.length, CATS]);

  const filtered = tokenResults.length>0 ? tokenResults : (aiResults || []);
  const usingAi = tokenResults.length===0 && aiResults && aiResults.length>0;

  const inCart = new Set(cart.map(c=>c.cod));
  const [toastAggiunta, setToastAggiunta] = useState(null); // {nome} | null
  useEffect(()=>{
    if(!toastAggiunta) return;
    const t = setTimeout(()=>setToastAggiunta(null), 2800);
    return ()=>clearTimeout(t);
  },[toastAggiunta]);
  function toggle(p,e){
    e?.stopPropagation();
    const giaPresente = inCart.has(p.cod);
    setCart(prev=>giaPresente?prev.filter(c=>c.cod!==p.cod):[...prev,p]);
    if(!giaPresente) setToastAggiunta({nome:p.nome});
  }

  // ─── Navigazione a livelli (attiva solo quando NON stai cercando testo) ───
  // Livelli: 1 categoria (cat) · 2 settore (settore, se presente) · 3 tipologia
  // (tip) · 4 marca (mar). Il livello settore si SALTA automaticamente se i
  // prodotti non hanno ancora il campo `settore`, così funziona da subito e
  // comparirà da solo quando aggiungerai quel dato.
  const [selCat,setSelCat]=useState(null);
  const [selSettore,setSelSettore]=useState(null);
  const [selTip,setSelTip]=useState(null);
  const [selMar,setSelMar]=useState(null);

  // valori distinti ordinati per un campo, con conteggio, dato un sottoinsieme
  function opzioni(lista, campo){
    const conteggi=new Map();
    for(const p of lista){
      const v=(p[campo]!==undefined && p[campo]!==null && String(p[campo]).trim()!=="") ? String(p[campo]) : null;
      if(v===null) continue;
      conteggi.set(v,(conteggi.get(v)||0)+1);
    }
    return Array.from(conteggi.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  }

  // un prodotto può appartenere a più settori: "auto,truck" -> ["auto","truck"]
  function settoriDi(p){
    return String(p.settori||"").split(",").map(s=>s.trim()).filter(Boolean);
  }
  // conteggio settori: ogni prodotto conta in ognuno dei suoi settori
  function opzioniSettore(lista){
    const conteggi=new Map();
    for(const p of lista){
      for(const s of settoriDi(p)) conteggi.set(s,(conteggi.get(s)||0)+1);
    }
    return Array.from(conteggi.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  }

  // sottoinsieme corrente in base ai livelli selezionati
  let liv1 = CATS;
  let dopoCat = (selCat && selCat!==DA_COMPLETARE) ? liv1.filter(p=>p.cat===selCat) : null;
  const settoriDisponibili = dopoCat ? opzioniSettore(dopoCat) : [];
  const settoreAttivo = settoriDisponibili.length>0; // il livello esiste solo se ci sono dati
  let dopoSettore = dopoCat
    ? (settoreAttivo ? (selSettore ? dopoCat.filter(p=>settoriDi(p).includes(selSettore)) : null) : dopoCat)
    : null;
  let dopoTip = dopoSettore ? (selTip ? dopoSettore.filter(p=>String(p.tip||"")===selTip) : null) : null;
  let dopoMar = dopoTip ? (selMar ? dopoTip.filter(p=>p.mar===selMar) : null) : null;

  function resetNav(){ setSelCat(null); setSelSettore(null); setSelTip(null); setSelMar(null); }
  // card prodotto riutilizzabile (lista risultati e ultimo livello)
  function CardProdotto(p){
    const isIn=inCart.has(p.cod);
    return (
      <div key={p.cod} onClick={()=>setDetail(p)} style={{...S.card,borderColor:isIn?C.ink:C.paperLine,display:"flex",gap:10}}>
        {p.img && (
          <div style={{width:54,height:54,flexShrink:0,borderRadius:6,border:`1px solid ${C.paperLine}`,background:"#fff",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <img src={p.img} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}} onError={e=>{e.target.parentNode.style.display="none";}}/>
          </div>
        )}
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:5,marginBottom:5,flexWrap:"wrap"}}>
            <Tag tone="steel">{p.mar}</Tag>
            <span style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO}}>{p.cat}</span>
          </div>
          <div style={{fontWeight:600,fontSize:13.5,lineHeight:1.3}}>{p.nome||p.desc}</div>
          <div className="tnum" style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO,marginTop:3}}>{p.cod}</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
          <div className="tnum" style={{fontSize:15,fontWeight:700,fontFamily:F_MONO,color:C.ink}}>€{p.netto.toFixed(2)}</div>
          <Tag tone={p.tipo_prezzo==="promo_telos"?"primary":p.tipo_prezzo==="sconto_base"?"ok":"steel"}>{BADGE_LABEL[p.tipo_prezzo]}</Tag>
          <button onClick={e=>toggle(p,e)} style={{border:`1px solid ${isIn?C.ink:C.paperLine}`,borderRadius:5,padding:"4px 9px",fontSize:10.5,fontWeight:600,background:isIn?C.ink:"none",color:isIn?"#fff":"#5B6770",cursor:"pointer"}}>{isIn?"✓ AGG.":"+ PREV."}</button>
        </div>
      </div>
    );
  }

  // riga di navigazione (una voce di livello: categoria/settore/tipologia/marca)
  function VoceNav(etichetta, conteggio, onClick){
    return (
      <div key={etichetta} onClick={onClick} style={{...S.card,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
        <span style={{fontWeight:600,fontSize:13.5}}>{etichetta}</span>
        <span className="tnum" style={{fontSize:11,color:"#9AA3AB",fontFamily:F_MONO,flexShrink:0}}>{conteggio} ›</span>
      </div>
    );
  }

  // breadcrumb dei livelli selezionati
  function Breadcrumb(){
    const parti=[];
    parti.push({label:"Tutte le categorie", onClick:resetNav});
    if(selCat) parti.push({label:selCat===DA_COMPLETARE?"Da completare":selCat, onClick:()=>{setSelSettore(null);setSelTip(null);setSelMar(null);}});
    if(selSettore) parti.push({label:selSettore, onClick:()=>{setSelTip(null);setSelMar(null);}});
    if(selTip) parti.push({label:selTip, onClick:()=>setSelMar(null)});
    if(selMar) parti.push({label:selMar, onClick:()=>{}});
    return (
      <div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center",marginBottom:12,fontSize:12}}>
        {parti.map((p,i)=>(
          <span key={i} style={{display:"flex",alignItems:"center",gap:4}}>
            {i>0 && <span style={{color:"#C3C8D0"}}>›</span>}
            <span onClick={p.onClick} style={{cursor:i<parti.length-1?"pointer":"default",color:i<parti.length-1?C.ink:"#5B6770",fontWeight:i===parti.length-1?600:400,fontFamily:F_MONO,fontSize:11.5}}>{p.label}</span>
          </span>
        ))}
      </div>
    );
  }

  const inRicerca = q.trim().length>0;

  return (
    <div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Cerca per nome, codice, marchio, o descrivi cosa ti serve…" style={{...S.inp,marginBottom:8}}/>

      {/* ═══ MODALITÀ RICERCA TESTUALE ═══ */}
      {inRicerca && (<>
        {aiSearching && (
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11.5,color:"#8A929A",marginBottom:8}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:C.ink}}/>
            Nessun risultato diretto — interpreto la richiesta con l'assistente…
          </div>
        )}
        {usingAi && (
          <div style={{fontSize:11.5,color:C.ink,background:"rgba(22,39,88,0.06)",borderRadius:6,padding:"6px 10px",marginBottom:8}}>
            ✦ Risultati interpretati dall'assistente per "{q}"
          </div>
        )}
        <div style={{...S.eyebrow,display:"flex",justifyContent:"space-between"}}><span>Risultati</span><span className="tnum">{filtered.length} articoli</span></div>
        {filtered.length===0 && !aiSearching && (
          <div style={{textAlign:"center",padding:"2.5rem 1rem",color:"#9AA3AB"}}>
            <div style={{fontSize:28,marginBottom:8}}>▣</div>
            <div style={{fontSize:13}}>Nessun prodotto trovato per "{q}"</div>
            <div style={{fontSize:11.5,marginTop:4}}>Prova con un codice, un marchio o descrivi cosa serve</div>
          </div>
        )}
        {filtered.slice(0,200).map(CardProdotto)}
        {filtered.length>200 && (
          <div style={{textAlign:"center",fontSize:11.5,color:"#9AA3AB",padding:"10px"}}>
            Mostrati i primi 200 di {filtered.length}. Affina la ricerca per vederne altri.
          </div>
        )}
      </>)}

      {/* ═══ MODALITÀ NAVIGAZIONE A LIVELLI ═══ */}
      {!inRicerca && (<>
        {!searchIndex && (
          <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",marginBottom:8}}>… preparazione ricerca</div>
        )}
        <Breadcrumb/>

        {/* Livello 1: categorie */}
        {!selCat && (<>
          <div style={{...S.eyebrow,display:"flex",justifyContent:"space-between"}}><span>Categorie</span><span className="tnum">{CATS.length} articoli</span></div>
          {opzioni(CATS,"cat").map(([nome,n])=>VoceNav(nome,n,()=>setSelCat(nome)))}
          {puoCompletareCategorie && prodottiDaCompletare.length>0 && (
            <div onClick={()=>setSelCat(DA_COMPLETARE)} style={{...S.card,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,borderColor:C.warn,background:"rgba(217,164,65,0.08)"}}>
              <span style={{fontWeight:600,fontSize:13.5,color:"#8a6418",display:"flex",alignItems:"center",gap:6}}>
                <span>⚠</span> DA COMPLETARE
              </span>
              <span className="tnum" style={{fontSize:11,color:"#8a6418",fontFamily:F_MONO,flexShrink:0}}>{prodottiDaCompletare.length} ›</span>
            </div>
          )}
        </>)}

        {/* Categoria virtuale: prodotti senza categoria, completamento in blocco */}
        {selCat===DA_COMPLETARE && puoCompletareCategorie && (
          <CompletaCategoria
            prodotti={prodottiDaCompletare}
            categorieEsistenti={categorieCatalogo}
            tipologieEsistenti={tipologieCatalogo}
            marchiEsistenti={marchiCatalogo}
            settoriEsistenti={settoriCatalogo}
            ruolo={ruolo}
            sessione={sessione}
            onFatto={()=>{ if(setCatalog) caricaCatalogo(CATALOG).then(d=>setCatalog(d)); }}
          />
        )}

        {/* Livello 2: settore (solo se i dati lo prevedono) */}
        {selCat && settoreAttivo && !selSettore && (<>
          <div style={S.eyebrow}>Settore</div>
          {settoriDisponibili.map(([nome,n])=>VoceNav(nome,n,()=>setSelSettore(nome)))}
        </>)}

        {/* Livello 3: tipologia */}
        {dopoSettore && !selTip && (()=>{
          const tipi=opzioni(dopoSettore,"tip");
          // se c'è una sola tipologia (o nessuna), salta al livello marche
          if(tipi.length<=1){
            const mar=opzioni(dopoSettore,"mar");
            return (<>
              <div style={S.eyebrow}>Marche</div>
              {mar.map(([nome,n])=>VoceNav(nome,n,()=>{setSelTip(tipi[0]?tipi[0][0]:"");setSelMar(nome);}))}
              <div style={{marginTop:8}}><div style={S.eyebrow}>Tutti gli articoli</div>{dopoSettore.map(CardProdotto)}</div>
            </>);
          }
          return (<>
            <div style={S.eyebrow}>Tipologia</div>
            {tipi.map(([nome,n])=>VoceNav(nome,n,()=>setSelTip(nome)))}
          </>);
        })()}

        {/* Livello 4: marca */}
        {dopoTip && !selMar && (<>
          <div style={S.eyebrow}>Marche</div>
          {opzioni(dopoTip,"mar").map(([nome,n])=>VoceNav(nome,n,()=>setSelMar(nome)))}
          <div style={{marginTop:8}}><div style={S.eyebrow}>Tutti gli articoli ({dopoTip.length})</div>{dopoTip.map(CardProdotto)}</div>
        </>)}

        {/* Foglia: prodotti filtrati per marca */}
        {dopoMar && (<>
          <div style={{...S.eyebrow,display:"flex",justifyContent:"space-between"}}><span>Articoli</span><span className="tnum">{dopoMar.length}</span></div>
          {dopoMar.map(CardProdotto)}
        </>)}
      </>)}

      {detail&&<SchedaProdotto p={detail} isIn={inCart.has(detail.cod)} onToggleCart={e=>toggle(detail,e)} onClose={()=>setDetail(null)} ruolo={ruolo} onModifica={()=>setEditando(detail)}/>}

      {toastAggiunta && (
        <div style={{position:"fixed",left:"50%",bottom:24,transform:"translateX(-50%)",zIndex:80,display:"flex",alignItems:"center",gap:12,background:C.ink,color:"#fff",borderRadius:10,padding:"12px 16px",boxShadow:"0 8px 24px rgba(0,0,0,0.25)",maxWidth:"90vw"}}>
          <span style={{fontSize:16,color:C.cyan,flexShrink:0}}>✓</span>
          <span style={{fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>"{toastAggiunta.nome}" aggiunto al preventivo</span>
          <button onClick={()=>{setToastAggiunta(null); if(setArea) setArea("preventivi");}} style={{background:C.cyan,color:C.inkDeep,border:"none",borderRadius:6,padding:"6px 11px",fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"}}>
            Vai al preventivo →
          </button>
        </div>
      )}

      {editando && (
        <EditaProdotto
          ruolo={ruolo}
          p={editando}
          categorieEsistenti={categorieCatalogo}
          tipologieEsistenti={tipologieCatalogo}
          marchiEsistenti={marchiCatalogo}
          sessione={sessione}
          onClose={()=>setEditando(null)}
          onSalvato={()=>{
            setEditando(null);
            setDetail(null);
            if(setCatalog) caricaCatalogo(CATALOG).then(d=>setCatalog(d));
          }}
        />
      )}
    </div>
  );
}

// ─── COMPLETA CATEGORIA (prodotti senza categoria, assegnazione in blocco) ────
// Componente in cima al modulo (non annidato in Prodotti): ha stato proprio
// (selezione, campi del form) che andrebbe perso a ogni render del genitore
// se fosse una funzione locale — stesso principio già seguito per
// SchedaProdotto/EditaProdotto. Visibile solo a responsabile/admin, la
// scrittura passa dalla Edge Function catalog-admin (azione
// "bulkAssegnaCategoria", autorizzata anche per il ruolo responsabile).
function CompletaCategoria({ prodotti, categorieEsistenti, tipologieEsistenti, marchiEsistenti, settoriEsistenti, ruolo, sessione, onFatto }){
  if(ruolo!=="admin" && ruolo!=="responsabile") return null;
  const accessToken = trovaAccessToken(sessione);

  const [filtroTesto,setFiltroTesto]=useState("");
  const [filtriCampo,setFiltriCampo]=useState(()=>new Set()); // sottoinsieme di cat/tip/mar/settori/listino
  const [selezionati,setSelezionati]=useState(()=>new Set());
  const [categoria,setCategoria]=useState("");
  const [tipologia,setTipologia]=useState("");
  const [marca,setMarca]=useState("");
  const [settoriSelezionati,setSettoriSelezionati]=useState(()=>new Set());
  const [settoreNuovo,setSettoreNuovo]=useState("");
  const [confermaAperta,setConfermaAperta]=useState(false);
  const [stato,setStato]=useState("idle"); // idle | salvo | fatto | errore
  const [msg,setMsg]=useState("");

  function toggleFiltroCampo(chiave){
    setFiltriCampo(prev=>{
      const next=new Set(prev);
      if(next.has(chiave)) next.delete(chiave); else next.add(chiave);
      return next;
    });
  }

  const elencoFiltrato = useMemo(()=>{
    const f=filtroTesto.trim().toLowerCase();
    return prodotti.filter(p=>{
      if(f && !((p.nome||"").toLowerCase().includes(f) || (p.cod||"").toLowerCase().includes(f) || (p.mar||"").toLowerCase().includes(f))) return false;
      if(filtriCampo.size>0){
        const mancanti=campiProdottoMancanti(p);
        if(!mancanti.some(c=>filtriCampo.has(c))) return false;
      }
      return true;
    });
  },[prodotti,filtroTesto,filtriCampo]);

  function toggleSel(cod){
    setSelezionati(prev=>{
      const next=new Set(prev);
      if(next.has(cod)) next.delete(cod); else next.add(cod);
      return next;
    });
  }
  function selezionaTuttiVisibili(){
    setSelezionati(prev=>{
      const next=new Set(prev);
      elencoFiltrato.forEach(p=>next.add(p.cod));
      return next;
    });
  }
  function deselezionaTuttiVisibili(){
    setSelezionati(prev=>{
      const next=new Set(prev);
      elencoFiltrato.forEach(p=>next.delete(p.cod));
      return next;
    });
  }
  function toggleSettore(nome){
    setSettoriSelezionati(prev=>{
      const next=new Set(prev);
      if(next.has(nome)) next.delete(nome); else next.add(nome);
      return next;
    });
  }

  const settoriNuoviLista = settoreNuovo.split(",").map(s=>s.trim()).filter(Boolean);
  const settoriFinaliAnteprima = [...settoriSelezionati, ...settoriNuoviLista];
  // Nessun campo è più obbligatorio in sé: basta che ci sia almeno un
  // prodotto selezionato e almeno un campo compilato (i campi lasciati
  // vuoti non vengono toccati) — utile perché ora la lista include anche
  // prodotti a cui manca solo la marca o solo il listino, non solo la categoria.
  const almenoUnCampo = categoria.trim() || tipologia.trim() || marca.trim() || settoriFinaliAnteprima.length>0;
  const pronto = selezionati.size>0 && almenoUnCampo;

  async function eseguiApplicazione(){
    setStato("salvo"); setMsg("Aggiornamento in corso…");
    try{
      const settoriFinali = [...new Set(settoriFinaliAnteprima)].join(",");
      const campi = {};
      if(categoria.trim()) campi.categoria = categoria.trim();
      if(tipologia.trim()) campi.tipologia = tipologia.trim();
      if(marca.trim()) campi.marchio = marca.trim();
      if(settoriFinali) campi.settori = settoriFinali;
      const { aggiornati } = await chiamaCatalogAdmin(
        "bulkAssegnaCategoria", { cods: Array.from(selezionati), campi }, accessToken
      );
      setStato("fatto");
      setMsg(`Fatto: ${aggiornati ?? selezionati.size} prodotti aggiornati.`);
      setSelezionati(new Set());
      setCategoria(""); setTipologia(""); setMarca("");
      setSettoriSelezionati(new Set()); setSettoreNuovo("");
      setConfermaAperta(false);
      if(onFatto) onFatto();
    }catch(err){
      setStato("errore");
      setMsg("Errore: "+err.message);
      setConfermaAperta(false);
    }
  }

  if(prodotti.length===0){
    return (
      <div style={{textAlign:"center",padding:"2.5rem 1rem",color:C.ok}}>
        <div style={{fontSize:28,marginBottom:8}}>✓</div>
        <div style={{fontSize:13.5,fontWeight:600}}>Tutti i prodotti sono completi.</div>
      </div>
    );
  }

  const CHIAVI_FILTRO = ["cat","tip","mar","settori","listino"];

  return (
    <div>
      <div style={{fontSize:12.5,color:C.steel,marginBottom:12,lineHeight:1.6}}>
        Questi {prodotti.length} prodotti hanno almeno un campo mancante tra categoria, tipologia,
        marca, settore o listino. Usa i filtri qui sotto per isolare un tipo di mancanza, seleziona
        i prodotti simili e compila solo i campi che vuoi assegnare in blocco — quelli lasciati vuoti
        non vengono toccati.
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
        {CHIAVI_FILTRO.map(chiave=>{
          const n = prodotti.filter(p=>campiProdottoMancanti(p).includes(chiave)).length;
          if(n===0) return null;
          const attivo = filtriCampo.has(chiave);
          return (
            <span key={chiave} onClick={()=>toggleFiltroCampo(chiave)} style={{fontSize:11.5,fontFamily:F_MONO,padding:"5px 10px",borderRadius:20,border:`1px solid ${attivo?C.warn:C.paperLine}`,background:attivo?C.warn:"#fff",color:attivo?"#fff":"#5B6770",cursor:"pointer"}}>
              Manca {ETICHETTA_CAMPO[chiave].toLowerCase()} ({n})
            </span>
          );
        })}
        {filtriCampo.size>0 && (
          <span onClick={()=>setFiltriCampo(new Set())} style={{fontSize:11.5,fontFamily:F_MONO,padding:"5px 10px",color:"#9AA3AB",cursor:"pointer"}}>✕ azzera filtri</span>
        )}
      </div>

      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
        <input value={filtroTesto} onChange={e=>setFiltroTesto(e.target.value)} placeholder="Filtra per nome, codice o marca…" style={{...S.inp,flex:"1 1 200px"}}/>
        <button onClick={selezionaTuttiVisibili} style={S.btnS}>Seleziona tutti {(filtroTesto||filtriCampo.size>0)?`(${elencoFiltrato.length})`:""}</button>
        <button onClick={deselezionaTuttiVisibili} style={S.btnS}>Deseleziona</button>
      </div>
      <div style={{fontSize:11.5,fontFamily:F_MONO,color:"#9AA3AB",marginBottom:10}} className="tnum">{selezionati.size} selezionati su {prodotti.length}</div>

      <div style={{maxHeight:340,overflowY:"auto",border:`1px solid ${C.paperLine}`,borderRadius:8,marginBottom:16}}>
        {elencoFiltrato.map(p=>{
          const mancanti = campiProdottoMancanti(p);
          return (
            <div key={p.cod} onClick={()=>toggleSel(p.cod)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderBottom:`1px solid ${C.paperLine}`,cursor:"pointer",background:selezionati.has(p.cod)?"rgba(87,206,202,0.10)":"#fff"}}>
              <input type="checkbox" checked={selezionati.has(p.cod)} onChange={()=>toggleSel(p.cod)} onClick={e=>e.stopPropagation()} style={{flexShrink:0,width:16,height:16}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,lineHeight:1.3}}>{p.nome||p.desc}</div>
                <div className="tnum" style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO,marginTop:2}}>{p.cod}{p.mar?` · ${p.mar}`:""}{p.tip?` · ${p.tip}`:""}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                  {mancanti.map(c=>(
                    <span key={c} style={{fontSize:9.5,fontFamily:F_MONO,padding:"2px 6px",borderRadius:10,background:"rgba(217,164,65,0.16)",color:"#8a6418"}}>{ETICHETTA_CAMPO[c]}</span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        {elencoFiltrato.length===0 && (
          <div style={{padding:"16px 12px",fontSize:12.5,color:C.steel,textAlign:"center"}}>Nessun prodotto corrisponde al filtro.</div>
        )}
      </div>

      <div style={{...S.card,cursor:"default",border:`1px solid ${C.warn}`,background:"rgba(217,164,65,0.05)"}}>
        <div style={S.eyebrow}>Assegna ai {selezionati.size} selezionati</div>
        <div style={{fontSize:11.5,color:C.steel,marginTop:2,marginBottom:8}}>Lascia vuoto un campo per non modificarlo su questo gruppo.</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div>
            <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Categoria</label>
            <input value={categoria} onChange={e=>setCategoria(e.target.value)} placeholder="es. BATTERY" style={S.inp} list="da-completare-categorie"/>
            <datalist id="da-completare-categorie">{categorieEsistenti.map(c=>(<option key={c} value={c}/>))}</datalist>
          </div>
          <div>
            <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Tipologia</label>
            <input value={tipologia} onChange={e=>setTipologia(e.target.value)} placeholder="es. TESTER BATTERIE" style={S.inp} list="da-completare-tipologie"/>
            <datalist id="da-completare-tipologie">{tipologieEsistenti.map(t=>(<option key={t} value={t}/>))}</datalist>
          </div>
          <div>
            <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Marca</label>
            <input value={marca} onChange={e=>setMarca(e.target.value)} placeholder="es. BOSCH" style={S.inp} list="da-completare-marche"/>
            <datalist id="da-completare-marche">{marchiEsistenti.map(m=>(<option key={m} value={m}/>))}</datalist>
          </div>
          <div>
            <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Settore</label>
            {settoriEsistenti.length>0 && (
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
                {settoriEsistenti.map(s=>(
                  <span key={s} onClick={()=>toggleSettore(s)} style={{fontSize:11.5,fontFamily:F_MONO,padding:"5px 10px",borderRadius:20,border:`1px solid ${settoriSelezionati.has(s)?C.ink:C.paperLine}`,background:settoriSelezionati.has(s)?C.ink:"#fff",color:settoriSelezionati.has(s)?"#fff":"#5B6770",cursor:"pointer"}}>{s}</span>
                ))}
              </div>
            )}
            <input value={settoreNuovo} onChange={e=>setSettoreNuovo(e.target.value)} placeholder="Aggiungi nuovo settore (o più, separati da virgola)" style={S.inp}/>
          </div>
        </div>

        <div style={{fontSize:11,color:"#9AA3AB",marginTop:10}}>
          Il listino (prezzo) non è assegnabile in blocco — è specifico per prodotto, va completato
          singolarmente da "✎ Modifica" sulla scheda prodotto.
        </div>

        <button onClick={()=>setConfermaAperta(true)} disabled={!pronto} style={{...S.btnAccent,width:"100%",marginTop:14,opacity:pronto?1:0.4}}>
          Applica a {selezionati.size} prodotti
        </button>
        {msg && <div style={{fontSize:12,color:stato==="errore"?C.danger:C.steel,marginTop:10}}>{msg}</div>}
      </div>

      {confermaAperta && (
        <div onClick={e=>{if(e.target===e.currentTarget) setConfermaAperta(false);}} style={{position:"fixed",inset:0,background:"rgba(14,26,64,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:60,padding:20}}>
          <div style={{background:"#fff",borderRadius:12,padding:20,maxWidth:420,width:"100%"}}>
            <div style={{fontSize:14,fontWeight:600,marginBottom:8}}>Confermi l'assegnazione?</div>
            <div style={{fontSize:12.5,color:C.steel,marginBottom:14,lineHeight:1.6}}>
              Stai per aggiornare <strong>{selezionati.size} prodotti</strong> con:
              {categoria.trim() && <> Categoria "<strong>{categoria.trim()}</strong>"</>}
              {tipologia.trim() && <>, Tipologia "<strong>{tipologia.trim()}</strong>"</>}
              {marca.trim() && <>, Marca "<strong>{marca.trim()}</strong>"</>}
              {settoriFinaliAnteprima.length>0 && <>, Settore "<strong>{[...new Set(settoriFinaliAnteprima)].join(", ")}</strong>"</>}.
              L'operazione va corretta manualmente se sbagliata.
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={eseguiApplicazione} disabled={stato==="salvo"} style={{...S.btnAccent,padding:"9px 15px"}}>{stato==="salvo"?"Applico…":"Sì, conferma"}</button>
              <button onClick={()=>setConfermaAperta(false)} style={{...S.btnS,padding:"9px 15px"}}>Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SCHEDA PRODOTTO (dettaglio) ──────────────────────────────────────────────
function SchedaProdotto({p, isIn, onToggleCart, onClose, ruolo, onModifica}){
  const scontoPerc = p.listino>0 ? Math.round((1 - p.netto/p.listino)*100) : 0;
  // Spezza la descrizione preventivo in righe — ogni riga è una caratteristica
  const righeCaratteristiche = (p.desc_prev || p.desc || "").split(/\n|;/).map(r=>r.trim()).filter(Boolean);

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(14,26,64,.55)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:50}}>
      <div style={{background:"#fff",borderRadius:"14px 14px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{position:"sticky",top:0,background:"#fff",padding:"14px 20px 0",zIndex:2}}>
          <div style={{width:36,height:4,background:C.paperLine,borderRadius:2,margin:"0 auto 14px"}}/>
        </div>
        <div style={{padding:"0 20px 24px"}}>
          {/* Header: titolo + chiudi */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
            <div style={{fontFamily:F_DISPLAY,fontSize:21,fontWeight:600,color:C.charcoal}}>{p.nome||p.desc}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,marginLeft:10}}>
              {ruolo==="admin" && (
                <button onClick={onModifica} style={{background:C.paper,border:`1px solid ${C.paperLine}`,borderRadius:7,padding:"6px 11px",fontSize:12,fontWeight:600,cursor:"pointer",color:C.ink}}>
                  ✎ Modifica
                </button>
              )}
              <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#9AA3AB"}}>✕</button>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:18,flexWrap:"wrap"}}>
            <Tag tone="primary">{p.mar}</Tag>
            <span className="tnum" style={{fontSize:11.5,color:"#8A929A",fontFamily:F_MONO}}>{p.cod} · {p.mar} · {p.cat}</span>
          </div>

          {/* Foto prodotto */}
          {p.img && (
            <div style={{background:C.paper,border:`1px solid ${C.paperLine}`,borderRadius:10,padding:16,marginBottom:18,display:"flex",alignItems:"center",justifyContent:"center",minHeight:180}}>
              <img src={p.img} alt={p.nome} style={{maxWidth:"100%",maxHeight:240,objectFit:"contain"}} onError={e=>{e.target.style.display="none";}}/>
            </div>
          )}

          {/* Descrizione generica */}
          <div style={S.eyebrow}>Descrizione generica</div>
          <div style={{fontSize:14,color:C.charcoal,marginBottom:18,lineHeight:1.5}}>{p.desc}</div>

          {/* Descrizione per preventivo — caratteristiche tecnico/commerciali */}
          {righeCaratteristiche.length>0 && (
            <>
              <div style={S.eyebrow}>Descrizione per preventivo</div>
              <div style={{marginBottom:18}}>
                {righeCaratteristiche.map((r,i)=>(
                  <div key={i} style={{fontSize:13.5,color:"#3A4248",padding:"6px 0",borderBottom:i<righeCaratteristiche.length-1?`1px solid ${C.paperLine}`:"none",lineHeight:1.4}}>{r}</div>
                ))}
              </div>
            </>
          )}

          {/* Prezzi: listino + netto affiancati */}
          <div style={{display:"flex",gap:16,padding:"16px 0",borderTop:`1px solid ${C.paperLine}`,borderBottom:`1px solid ${C.paperLine}`,marginBottom:16}}>
            <div style={{flex:1}}>
              <div style={S.eyebrow}>Listino</div>
              <div className="tnum" style={{fontFamily:F_MONO,fontSize:19,fontWeight:600,color:"#8A929A",textDecoration:p.netto<p.listino?"line-through":"none"}}>€{p.listino.toFixed(2)}</div>
            </div>
            <div style={{flex:1}}>
              <div style={{...S.eyebrow,display:"flex",alignItems:"center",gap:4}}><span style={{color:C.ink}}>★</span> Netto Telos</div>
              <div className="tnum" style={{fontFamily:F_MONO,fontSize:22,fontWeight:700,color:C.ink}}>€{p.netto.toFixed(2)}</div>
            </div>
            {scontoPerc>0 && (
              <div style={{flexShrink:0,textAlign:"right"}}>
                <div style={S.eyebrow}>Sconto</div>
                <Tag tone="ok">-{scontoPerc}%</Tag>
              </div>
            )}
          </div>

          <div style={{display:"flex",gap:16,marginBottom:20}}>
            <div>
              <div style={S.eyebrow}>Unità</div>
              <div style={{fontSize:13.5,fontWeight:600}}>{p.um || "Nr."}</div>
            </div>
            <div>
              <div style={S.eyebrow}>Tipo prezzo</div>
              <Tag tone={p.tipo_prezzo==="promo_telos"?"primary":p.tipo_prezzo==="sconto_base"?"ok":"steel"}>{BADGE_LABEL[p.tipo_prezzo]}</Tag>
            </div>
          </div>

          {/* Schede tecniche — file PDF caricati dall'admin, non generati dai dati prodotto */}
          <div style={S.eyebrow}>Schede tecniche</div>
          {(p.schede && p.schede.length > 0) ? (
            <div style={{marginBottom:22}}>
              {p.schede.map((s,i)=>(
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:9,width:"100%",background:C.paper,border:`1px solid ${C.paperLine}`,borderRadius:8,padding:"11px 13px",cursor:"pointer",textAlign:"left",marginBottom:8,textDecoration:"none"}}>
                  <span style={{fontSize:17,color:C.ink}}>⬇</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.charcoal}}>{s.nome}</div>
                    <div style={{fontSize:11,color:"#9AA3AB",marginTop:1}}>Documento PDF</div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div style={{fontSize:12,color:C.steel,marginBottom:22}}>
              Nessuna scheda tecnica caricata{ruolo==="admin" ? " — usa Modifica per aggiungerne una." : "."}
            </div>
          )}

          {p.video && (
            <a href={p.video} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:9,width:"100%",background:C.paper,border:`1px solid ${C.paperLine}`,borderRadius:8,padding:"11px 13px",cursor:"pointer",textAlign:"left",marginBottom:22,textDecoration:"none"}}>
              <span style={{fontSize:17,color:C.ink}}>▶</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:C.charcoal}}>Guarda il video del prodotto</div>
                <div style={{fontSize:11,color:"#9AA3AB",marginTop:1}}>Apre in una nuova scheda</div>
              </div>
            </a>
          )}

          {/* Azioni */}
          <button onClick={onToggleCart} style={{...S.btnAccent,width:"100%",padding:"14px",fontSize:14,background:isIn?C.ok:C.cyan,color:isIn?"#fff":C.inkDeep}}>
            {isIn ? "✓ Nel preventivo" : "+ Aggiungi al preventivo"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CLIENTI ──────────────────────────────────────────────────────────────────
// Stessa ricerca già usata in Preventivi (SelezioneCliente): wildcard OR su
// più campi, con il token di sessione reale perché la RLS di "clienti"
// richiede una sessione autenticata.
const CAMPI_RICERCA_CLIENTI = ["codice","ragione_sociale","rag_sociale_agg","localita","provincia","partita_iva","codice_fiscale","mail","telefono"];

function Clienti({sessione, preventivi, ordini, attrezzature, setAttrezzature, interventi, setInterventi, catalog, ruolo}){
  const accessToken = trovaAccessToken(sessione);
  const [q,setQ] = useState("");
  const [risultati,setRisultati] = useState([]);
  const [caricando,setCaricando] = useState(false);
  const [errore,setErrore] = useState("");
  const [selezionato,setSelezionato] = useState(null);
  const [tabInizialeCliente,setTabInizialeCliente] = useState("dati");
  const [qAttrezzatura,setQAttrezzatura] = useState("");
  const [attrezzaturaAperta,setAttrezzaturaAperta] = useState(null);
  // Quale ricerca è attiva: null (nessuna scelta ancora), "clienti" o
  // "attrezzatura". Prima i due campi erano sempre visibili insieme (con
  // font diversi tra loro, confuso su mobile) — ora si sceglie con un
  // pulsante grande e compare solo il campo pertinente.
  const [modalita,setModalita] = useState(null);
  const timer = useRef(null);

  function selezionaModalita(m){
    setModalita(prev=>prev===m?null:m);
    setQ(""); setQAttrezzatura(""); setRisultati([]); setErrore("");
  }

  useEffect(()=>{
    clearTimeout(timer.current);
    if(!q.trim()){ setRisultati([]); setErrore(""); return; }
    timer.current = setTimeout(async ()=>{
      setCaricando(true); setErrore("");
      try{
        const safe = q.trim().replace(/[,()]/g,"");
        const pattern = "*"+encodeURIComponent(safe)+"*"; // * non va MAI url-encodato
        const orExpr = CAMPI_RICERCA_CLIENTI.map(c=>`${c}.ilike.${pattern}`).join(",");
        const params = `select=codice,ragione_sociale,rag_sociale_agg,indirizzo,localita,provincia,cap,partita_iva,codice_fiscale,telefono,mail,filiale&or=(${orExpr})&limit=30`;
        const dati = await sbGetAuth("clienti", params, accessToken);
        setRisultati(dati||[]);
      }catch(err){
        setErrore(err.message); setRisultati([]);
      }
      setCaricando(false);
    }, 350);
    return ()=>clearTimeout(timer.current);
  },[q]);

  // Ricerca per attrezzatura: filtro lato client sull'elenco già caricato
  // (nome prodotto, numero di serie, marca).
  const risultatiAttrezzatura = useMemo(()=>{
    if(!qAttrezzatura.trim()) return [];
    const qq = qAttrezzatura.trim().toLowerCase();
    return (attrezzature||[]).filter(a=>
      (a.nome_prodotto||"").toLowerCase().includes(qq) ||
      (a.numero_serie||"").toLowerCase().includes(qq) ||
      (a.marchio||"").toLowerCase().includes(qq)
    ).slice(0,30);
  },[qAttrezzatura,attrezzature]);

  if(attrezzaturaAperta){
    return <ModificaAttrezzatura
      attrezzatura={attrezzaturaAperta}
      onChiudi={()=>setAttrezzaturaAperta(null)}
      onSalvata={(agg)=>{ setAttrezzature(prev=>prev.map(x=>x.id===agg.id?agg:x)); setAttrezzaturaAperta(null); }}
      onEliminata={(id)=>{ setAttrezzature(prev=>prev.filter(x=>x.id!==id)); setAttrezzaturaAperta(null); }}
      catalog={catalog} sessione={sessione}
    />;
  }

  if(selezionato){
    return <ClienteDettaglio cliente={selezionato} onIndietro={()=>{setSelezionato(null); setTabInizialeCliente("dati");}} preventivi={preventivi} ordini={ordini}
      attrezzature={attrezzature} setAttrezzature={setAttrezzature} interventi={interventi} setInterventi={setInterventi}
      catalog={catalog} ruolo={ruolo} sessione={sessione} tabIniziale={tabInizialeCliente}/>;
  }

  // Stile comune ai due pulsanti di scelta: stesso font/dimensione/peso,
  // cambia solo il colore per distinguerli — grandi e comodi da toccare su
  // schermo piccolo (min. 52px di altezza).
  function bottoneModalita(tono, attivo, onClick, icona, etichetta){
    const palette = tono==="clienti"
      ? { bg:C.ink, bgInattivo:"rgba(22,39,88,0.08)", fg:"#fff", fgInattivo:C.ink, ombra:"rgba(22,39,88,0.28)" }
      : { bg:C.cyan, bgInattivo:"rgba(87,206,202,0.14)", fg:C.inkDeep, fgInattivo:"#2E8783", ombra:"rgba(87,206,202,0.4)" };
    return (
      <button onClick={onClick} style={{
        flex:"1 1 150px", display:"flex", alignItems:"center", justifyContent:"center", gap:8,
        padding:"16px 14px", minHeight:52, borderRadius:10, border:"none", cursor:"pointer",
        fontFamily:F_BODY, fontWeight:700, fontSize:13.5, letterSpacing:"0.02em",
        background: attivo?palette.bg:palette.bgInattivo, color: attivo?palette.fg:palette.fgInattivo,
        boxShadow: attivo?`0 2px 10px ${palette.ombra}`:"none",
      }}>
        <span style={{fontSize:17}}>{icona}</span>{etichetta}
      </button>
    );
  }

  return (
    <div>
      <div style={S.eyebrow}>Clienti</div>

      <div style={{display:"flex",gap:10,marginTop:10,marginBottom:14,flexWrap:"wrap"}}>
        {bottoneModalita("clienti", modalita==="clienti", ()=>selezionaModalita("clienti"), "🔍", "CERCA CLIENTI")}
        {bottoneModalita("attrezzatura", modalita==="attrezzatura", ()=>selezionaModalita("attrezzatura"), "🔧", "CERCA ATTREZZATURA")}
      </div>

      {modalita==="clienti" && (
        <input
          value={q} onChange={e=>setQ(e.target.value)}
          placeholder="Cerca per ragione sociale, città, P.IVA, codice fiscale…"
          style={{...S.inp,padding:"13px 16px",fontSize:14,marginBottom:14}}
          autoFocus
        />
      )}
      {modalita==="attrezzatura" && (
        <input
          value={qAttrezzatura} onChange={e=>setQAttrezzatura(e.target.value)}
          placeholder="Cerca per nome, numero di serie o marca…"
          style={{...S.inp,padding:"13px 16px",fontSize:14,marginBottom:14}}
          autoFocus
        />
      )}

      {errore && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>⚠ {errore}</div>}

      {modalita===null && (
        <div style={{textAlign:"center",padding:"2.5rem 1rem",color:"#9AA3AB"}}>
          <div style={{fontSize:28,marginBottom:8}}>◉</div>
          <div style={{fontSize:13}}>Scegli se cercare un cliente o un'attrezzatura</div>
        </div>
      )}

      {modalita==="attrezzatura" && (<>
        {qAttrezzatura.trim() ? (<>
          <div style={{...S.eyebrow,marginBottom:8}}>Attrezzature ({risultatiAttrezzatura.length})</div>
          {risultatiAttrezzatura.length===0 && (
            <div style={{textAlign:"center",padding:"1.5rem 1rem",color:"#9AA3AB",fontSize:13,marginBottom:8}}>Nessuna attrezzatura per «{qAttrezzatura}»</div>
          )}
          {risultatiAttrezzatura.map(a=>(
            <div key={a.id} onClick={()=>setAttrezzaturaAperta(a)} style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{minWidth:0}}>
                  {a.marchio && <Tag tone="steel">{a.marchio}</Tag>}
                  <div style={{fontWeight:600,fontSize:13.5,marginTop:6}}>{a.nome_prodotto}</div>
                  <div className="tnum" style={{fontSize:11,color:"#9AA3AB",fontFamily:F_MONO,marginTop:3}}>S/N {a.numero_serie}</div>
                </div>
                {a.stato==="Dismessa" && <Tag tone="danger">Dismessa</Tag>}
              </div>
            </div>
          ))}
        </>) : (
          <div style={{textAlign:"center",padding:"2rem 1rem",color:"#9AA3AB",fontSize:13}}>Digita per cercare un'attrezzatura</div>
        )}
      </>)}

      {modalita==="clienti" && (<>
        {caricando && <div style={{fontSize:12.5,color:"#8A929A",padding:"8px 0"}}>Ricerca in corso…</div>}
        {!caricando && q.trim() && !errore && risultati.length===0 && (
          <div style={{textAlign:"center",padding:"2rem 1rem",color:"#9AA3AB",fontSize:13}}>Nessun cliente trovato per «{q}»</div>
        )}
        {!caricando && !q.trim() && (
          <div style={{textAlign:"center",padding:"2rem 1rem",color:"#9AA3AB",fontSize:13}}>Digita per cercare un cliente</div>
        )}
        {risultati.length>0 && (
          <div style={{...S.eyebrow,marginBottom:8}}>Clienti ({risultati.length})</div>
        )}
        {risultati.map(c=>(
          <div key={c.codice} onClick={()=>setSelezionato(c)} style={S.card}>
            <div style={{fontWeight:600,fontSize:13.5}}>{c.ragione_sociale}</div>
            {c.rag_sociale_agg && <div style={{fontSize:12,color:C.steel,marginTop:1}}>{c.rag_sociale_agg}</div>}
            <div style={{fontSize:11.5,color:"#8A929A",marginTop:3}}>
              {[c.localita, c.provincia && `(${c.provincia})`].filter(Boolean).join(" ")}
              {c.partita_iva && <span className="tnum" style={{fontFamily:F_MONO,marginLeft:8}}>P.IVA {c.partita_iva}</span>}
            </div>
          </div>
        ))}
      </>)}
    </div>
  );
}

// ─── PROMEMORIA ────────────────────────────────────────────────────────────
// Promemoria liberi legati ai clienti (tabella "promemoria", propri per
// commerciale/tecnico, visibili anche di tutto il team per responsabile/
// admin — stesso schema di visibilità già usato per "Saltati"). A questi si
// affiancano le sezioni automatiche, calcolate al volo da preventivi/
// interventi (vedi funzioni sopra Home) e non salvate da nessuna parte.
function Promemoria({sessione, ruolo, preventivi, interventi, ordini, promemoria, setPromemoria, setArea}){
  const accessToken = trovaAccessToken(sessione);
  const puoVedereTeam = ruolo==="responsabile" || ruolo==="admin";
  const [vistaTeam,setVistaTeam] = useState(false);
  const [formAperto,setFormAperto] = useState(false);
  const [clienteForm,setClienteForm] = useState(null);
  const [testoForm,setTestoForm] = useState("");
  const [scadenzaForm,setScadenzaForm] = useState("");
  const [salvando,setSalvando] = useState(false);
  const [errore,setErrore] = useState("");
  const [confermaEliminaId,setConfermaEliminaId] = useState(null);

  // "Propri" per nome (come mieiSaltati in ListaPreventivi) — non abbiamo
  // l'id utente lato client, solo il nome della sessione.
  const mieiPromemoria = useMemo(()=>(promemoria||[]).filter(p=>p.autore_nome===sessione?.nome),[promemoria,sessione]);
  const elencoBase = (puoVedereTeam && vistaTeam) ? (promemoria||[]) : mieiPromemoria;
  const aperti = useMemo(()=>[...elencoBase.filter(p=>p.stato==="aperto")].sort((a,b)=>{
    const ga=giorniA(a.scadenza), gb=giorniA(b.scadenza);
    if(ga===null && gb===null) return new Date(b.creato_il||0)-new Date(a.creato_il||0);
    if(ga===null) return 1;
    if(gb===null) return -1;
    return ga-gb;
  }),[elencoBase]);
  const fatti = useMemo(()=>[...elencoBase.filter(p=>p.stato==="fatto")]
    .sort((a,b)=>new Date(b.completato_il||0)-new Date(a.completato_il||0)).slice(0,10),[elencoBase]);

  const mostraCommerciale = ruolo==="commerciale" || ruolo==="responsabile" || ruolo==="admin";
  const mostraTecnico = ruolo==="tecnico" || ruolo==="responsabile" || ruolo==="admin";
  const daGestirePrev = useMemo(()=>preventiviDaGestire(preventivi),[preventivi]);
  const daRecuperareVicine = useMemo(()=>trattativeDaRecuperareVicine(preventivi),[preventivi]);
  // Ordini con una segnalazione del responsabile ancora da leggere, creati
  // dall'utente corrente (vedi "nota_responsabile"/"avviso_commerciale" in
  // Ordini → In gestione).
  const ordiniConAvviso = useMemo(()=>(ordini||[]).filter(o=>o.avviso_commerciale && o.creato_da_nome===sessione?.nome),[ordini,sessione]);
  const interventiGestireList = useMemo(()=>interventiDaGestire(interventi),[interventi]);
  const interventiScadenzaList = useMemo(()=>interventiScadenzaVicina(interventi),[interventi]);
  const interventiMancaList = useMemo(()=>interventiMancaInfo(interventi),[interventi]);

  async function salvaNuovo(){
    if(!testoForm.trim()) return;
    setSalvando(true); setErrore("");
    try{
      const payload = {
        cliente_codice: clienteForm?.codice || null,
        cliente_nome: clienteForm?.ragione_sociale || null,
        testo: testoForm.trim(),
        scadenza: scadenzaForm || null,
        autore_nome: sessione?.nome || null,
      };
      const [salvato] = await sbAuth("POST","promemoria","",payload,accessToken);
      setPromemoria(prev=>[salvato,...prev]);
      setTestoForm(""); setClienteForm(null); setScadenzaForm(""); setFormAperto(false);
    }catch(err){
      setErrore("Salvataggio non riuscito: "+err.message);
    }
    setSalvando(false);
  }
  async function segnaFatto(p){
    const payload = {stato:"fatto", completato_il:new Date().toISOString()};
    try{
      await sbAuth("PATCH","promemoria",`id=eq.${p.id}`,payload,accessToken);
      setPromemoria(prev=>prev.map(x=>x.id===p.id?{...x,...payload}:x));
    }catch(err){ setErrore("Errore: "+err.message); }
  }
  async function riapri(p){
    const payload = {stato:"aperto", completato_il:null};
    try{
      await sbAuth("PATCH","promemoria",`id=eq.${p.id}`,payload,accessToken);
      setPromemoria(prev=>prev.map(x=>x.id===p.id?{...x,...payload}:x));
    }catch(err){ setErrore("Errore: "+err.message); }
  }
  async function eliminaConfermato(id){
    try{
      await sbAuth("DELETE","promemoria",`id=eq.${id}`,null,accessToken);
      setPromemoria(prev=>prev.filter(x=>x.id!==id));
    }catch(err){ setErrore("Errore: "+err.message); }
    setConfermaEliminaId(null);
  }

  function rigaPromemoria(p){
    const giorni = giorniA(p.scadenza);
    const scaduto = giorni!==null && giorni<0;
    const vicino = giorni!==null && giorni>=0 && giorni<=GIORNI_PREAVVISO_PROMEMORIA;
    return (
      <div key={p.id} style={{...S.card,cursor:"default",...(scaduto?{borderColor:C.danger}:vicino?{borderColor:C.warn}:{})}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div style={{minWidth:0}}>
            {p.cliente_nome && <div style={{fontWeight:600,fontSize:13.5}}>{p.cliente_nome}</div>}
            <div style={{fontSize:13,color:C.charcoal,marginTop:p.cliente_nome?3:0,lineHeight:1.4}}>{p.testo}</div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:6,flexWrap:"wrap"}}>
              {p.scadenza && (
                <span className="tnum" style={{fontSize:10.5,fontFamily:F_MONO,color:scaduto?C.danger:vicino?"#8a6418":"#9AA3AB",fontWeight:scaduto||vicino?700:400}}>
                  {scaduto?"⚠ scaduto il ":"entro il "}{new Date(p.scadenza).toLocaleDateString("it-IT")}
                </span>
              )}
              {vistaTeam && p.autore_nome && <Tag tone="steel">{p.autore_nome}</Tag>}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
            <button onClick={()=>segnaFatto(p)} style={{...S.btnS,padding:"6px 10px",fontSize:11.5}}>✓ Fatto</button>
            <button onClick={()=>setConfermaEliminaId(p.id)} style={{...S.btnS,padding:"6px 10px",fontSize:11.5,color:C.danger}}>Elimina</button>
          </div>
        </div>
        {confermaEliminaId===p.id && (
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.paperLine}`}}>
            <div style={{fontSize:12,color:C.steel,marginBottom:8}}>Eliminare questo promemoria? L'operazione non è reversibile.</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>eliminaConfermato(p.id)} style={{...S.btnAccent,padding:"7px 12px",background:C.danger,color:"#fff"}}>Sì, elimina</button>
              <button onClick={()=>setConfermaEliminaId(null)} style={{...S.btnS,padding:"7px 12px"}}>Annulla</button>
            </div>
          </div>
        )}
      </div>
    );
  }
  function rigaPromemoriaFatto(p){
    return (
      <div key={p.id} style={{...S.card,cursor:"default",opacity:0.65,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
        <div style={{minWidth:0}}>
          {p.cliente_nome && <div style={{fontWeight:600,fontSize:12.5}}>{p.cliente_nome}</div>}
          <div style={{fontSize:12,color:C.steel,marginTop:2}}>{p.testo}</div>
        </div>
        <button onClick={()=>riapri(p)} style={{...S.btnS,padding:"5px 10px",fontSize:11,flexShrink:0}}>↺ Riapri</button>
      </div>
    );
  }
  function rigaPreventivoDaGestire(p){
    return (
      <div key={p.id} onClick={()=>setArea("preventivi")} style={{...S.card,borderLeft:`3px solid ${C.warn}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:600,fontSize:13.5}}>{p.cliente || "Cliente non specificato"}</div>
            <div style={{fontSize:11.5,color:"#8A929A",marginTop:2}}>{p.righe.length} articol{p.righe.length===1?"o":"i"} · Inviato</div>
          </div>
          <span className="tnum" style={{fontFamily:F_MONO,fontSize:13,fontWeight:600,flexShrink:0}}>€{p.val.toLocaleString("it-IT")}</span>
        </div>
      </div>
    );
  }
  function rigaTrattativa(p){
    const scaduto = p.giorni<0;
    return (
      <div key={p.id} onClick={()=>setArea("preventivi")} style={{...S.card,borderLeft:`3px solid ${scaduto?C.danger:C.warn}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:600,fontSize:13.5}}>{p.cliente || "Cliente non specificato"}</div>
            <div style={{fontSize:11.5,color:scaduto?C.danger:"#8A929A",marginTop:2,fontWeight:scaduto?600:400}}>
              {scaduto?`⚠ Richiamo scaduto da ${Math.abs(p.giorni)}gg`:p.giorni===0?"Richiamare oggi":`Richiamare tra ${p.giorni}gg`}
            </div>
          </div>
          <span className="tnum" style={{fontFamily:F_MONO,fontSize:13,fontWeight:600,flexShrink:0}}>€{p.val.toLocaleString("it-IT")}</span>
        </div>
      </div>
    );
  }
  function rigaOrdineAvviso(o){
    return (
      <div key={o.id} onClick={()=>setArea("ordini")} style={{...S.card,borderLeft:`3px solid ${C.warn}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:600,fontSize:13.5}}>{o.cliente || "Cliente non specificato"}</div>
            <div style={{fontSize:11.5,color:"#8a6418",marginTop:2}}>ⓘ {o.nota_responsabile}</div>
          </div>
          <span className="tnum" style={{fontFamily:F_MONO,fontSize:13,fontWeight:600,flexShrink:0}}>€{o.val.toLocaleString("it-IT")}</span>
        </div>
      </div>
    );
  }
  function rigaIntervento(i, badgeTesto, tono){
    return (
      <div key={i.id} onClick={()=>setArea("interventi")} style={{...S.card,borderLeft:`3px solid ${tono}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:600,fontSize:13.5}}>{TIPO_LABELS[i.tipo]||i.tipo}</div>
            <div style={{fontSize:11.5,color:"#8A929A",marginTop:2}}>{i.cliente_nome || "Cliente non specificato"}</div>
            {i.nota_manca_info && <div style={{fontSize:11,color:"#8a6418",marginTop:3}}>ⓘ {i.nota_manca_info}</div>}
          </div>
          <Tag tone={tono===C.danger?"danger":tono===C.warn?"warn":"steel"}>{badgeTesto}</Tag>
        </div>
      </div>
    );
  }

  const tuttoVuoto = aperti.length===0 && !(mostraCommerciale && (daRecuperareVicine.length>0||daGestirePrev.length>0||ordiniConAvviso.length>0))
    && !(mostraTecnico && (interventiMancaList.length>0||interventiScadenzaList.length>0||interventiGestireList.length>0));

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div style={S.eyebrow}>Promemoria</div>
        {puoVedereTeam && (
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setVistaTeam(false)} style={{...S.btnS,padding:"5px 10px",fontSize:11,...(!vistaTeam?{background:C.ink,color:"#fff",borderColor:C.ink}:{})}}>Miei</button>
            <button onClick={()=>setVistaTeam(true)} style={{...S.btnS,padding:"5px 10px",fontSize:11,...(vistaTeam?{background:C.ink,color:"#fff",borderColor:C.ink}:{})}}>Tutti</button>
          </div>
        )}
      </div>

      <div style={{marginTop:10,marginBottom:18}}>
        {formAperto ? (
          <div style={{...S.card,cursor:"default",border:`1px solid ${C.ink}`}}>
            <div style={S.eyebrow}>Nuovo promemoria</div>
            <div style={{marginTop:8,marginBottom:10}}>
              <SelezioneCliente clienteSelezionato={clienteForm} onSeleziona={setClienteForm} sessione={sessione}/>
            </div>
            <textarea value={testoForm} onChange={e=>setTestoForm(e.target.value)} placeholder="Cosa devi ricordare?" rows={3} style={{...S.inp,resize:"vertical",marginBottom:10}}/>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Scadenza (opzionale)</label>
              <input type="date" value={scadenzaForm} onChange={e=>setScadenzaForm(e.target.value)} style={S.inp}/>
            </div>
            {errore && <div style={{fontSize:12,color:C.danger,marginBottom:10}}>⚠ {errore}</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={salvaNuovo} disabled={!testoForm.trim()||salvando} style={{...S.btnAccent,padding:"10px 16px",opacity:testoForm.trim()?1:0.4}}>{salvando?"Salvo…":"Salva promemoria"}</button>
              <button onClick={()=>{setFormAperto(false); setTestoForm(""); setClienteForm(null); setScadenzaForm(""); setErrore("");}} style={{...S.btnS,padding:"10px 16px"}}>Annulla</button>
            </div>
          </div>
        ) : (
          <button onClick={()=>setFormAperto(true)} style={{...S.btnAccent,padding:"14px 24px",fontSize:14.5,fontWeight:700}}>+ Nuovo promemoria</button>
        )}
      </div>

      {tuttoVuoto && fatti.length===0 && (
        <div style={{textAlign:"center",padding:"2.5rem 1rem",color:"#9AA3AB"}}>
          <div style={{fontSize:28,marginBottom:8}}>✓</div>
          <div style={{fontSize:13}}>Niente da ricordare al momento.</div>
        </div>
      )}

      <div style={{...S.eyebrow,marginTop:4,marginBottom:8}}>{vistaTeam?"Promemoria del team":"I tuoi promemoria"} ({aperti.length})</div>
      {aperti.length===0 && <div style={{fontSize:12.5,color:"#9AA3AB",padding:"4px 0 8px"}}>Nessun promemoria aperto.</div>}
      {aperti.map(rigaPromemoria)}

      {mostraCommerciale && ordiniConAvviso.length>0 && (<>
        <div style={{...S.eyebrow,marginTop:22,marginBottom:8}}>Ordini con una segnalazione ({ordiniConAvviso.length})</div>
        {ordiniConAvviso.map(rigaOrdineAvviso)}
      </>)}
      {mostraCommerciale && daRecuperareVicine.length>0 && (<>
        <div style={{...S.eyebrow,marginTop:22,marginBottom:8}}>Trattative da recuperare a breve ({daRecuperareVicine.length})</div>
        {daRecuperareVicine.map(rigaTrattativa)}
      </>)}
      {mostraCommerciale && daGestirePrev.length>0 && (<>
        <div style={{...S.eyebrow,marginTop:22,marginBottom:8}}>Preventivi da gestire ({daGestirePrev.length})</div>
        {daGestirePrev.slice(0,8).map(rigaPreventivoDaGestire)}
        {daGestirePrev.length>8 && <div onClick={()=>setArea("preventivi")} style={{fontSize:12,color:C.ink,cursor:"pointer",padding:"6px 0",fontWeight:600}}>Vedi tutti in Preventivi →</div>}
      </>)}

      {mostraTecnico && interventiMancaList.length>0 && (<>
        <div style={{...S.eyebrow,marginTop:22,marginBottom:8}}>Manca qualcosa per chiudere ({interventiMancaList.length})</div>
        {interventiMancaList.map(i=>rigaIntervento(i,"manca info",C.warn))}
      </>)}
      {mostraTecnico && interventiScadenzaList.length>0 && (<>
        <div style={{...S.eyebrow,marginTop:22,marginBottom:8}}>Interventi in scadenza ({interventiScadenzaList.length})</div>
        {interventiScadenzaList.map(i=>rigaIntervento(i, i.giorni<0?`scaduto da ${Math.abs(i.giorni)}gg`:i.giorni===0?"oggi":`tra ${i.giorni}gg`, i.giorni<0?C.danger:C.warn))}
      </>)}
      {mostraTecnico && interventiGestireList.length>0 && (<>
        <div style={{...S.eyebrow,marginTop:22,marginBottom:8}}>Interventi da gestire ({interventiGestireList.length})</div>
        {interventiGestireList.slice(0,8).map(i=>rigaIntervento(i,"pianificato",C.steel))}
        {interventiGestireList.length>8 && <div onClick={()=>setArea("interventi")} style={{fontSize:12,color:C.ink,cursor:"pointer",padding:"6px 0",fontWeight:600}}>Vedi tutti in Interventi →</div>}
      </>)}

      {fatti.length>0 && (<>
        <div style={{...S.eyebrow,marginTop:22,marginBottom:8}}>Completati di recente</div>
        {fatti.map(rigaPromemoriaFatto)}
      </>)}
    </div>
  );
}

// ─── MODIFICA ATTREZZATURA ──────────────────────────────────────────────────
// Le attrezzature sono pensate come un unico archivio: qui si corregge un
// inserimento sbagliato, si sposta un'attrezzatura su un altro cliente
// (venduta/passata di mano), la si segna dismessa (senza perderne la
// storia) o, se davvero necessario, la si elimina.
function ModificaAttrezzatura({ attrezzatura, onChiudi, onSalvata, onEliminata, catalog, sessione }){
  const accessToken = trovaAccessToken(sessione);
  const [nome,setNome] = useState(attrezzatura.nome_prodotto||"");
  const [marchio,setMarchio] = useState(attrezzatura.marchio||"");
  const [numeroSerie,setNumeroSerie] = useState(attrezzatura.numero_serie||"");
  const [dataInstallazione,setDataInstallazione] = useState(attrezzatura.data_installazione||"");
  const [scadenzaAggiornamenti,setScadenzaAggiornamenti] = useState(attrezzatura.scadenza_aggiornamenti||"");
  const [scadenzaVerifiche,setScadenzaVerifiche] = useState(attrezzatura.scadenza_verifiche||"");
  const [note,setNote] = useState(attrezzatura.note||"");
  const [stato,setStato] = useState(attrezzatura.stato||"Attiva");
  const [salvando,setSalvando] = useState(false);
  const [errore,setErrore] = useState("");
  const [confermaElimina,setConfermaElimina] = useState(false);

  // Cliente attuale (mostrato per nome) e cambio cliente (spostamento)
  const [clienteAttuale,setClienteAttuale] = useState(null);
  const [caricandoCliente,setCaricandoCliente] = useState(true);
  const [cambioClienteAperto,setCambioClienteAperto] = useState(false);
  const [nuovoCliente,setNuovoCliente] = useState(null);

  useEffect(()=>{
    let annullato = false;
    (async()=>{
      try{
        const dati = await sbGetAuth("clienti", `select=codice,ragione_sociale&codice=eq.${encodeURIComponent(attrezzatura.cliente_codice||"")}`, accessToken);
        if(!annullato) setClienteAttuale(dati && dati[0] ? dati[0] : null);
      }catch{ if(!annullato) setClienteAttuale(null); }
      if(!annullato) setCaricandoCliente(false);
    })();
    return ()=>{ annullato=true; };
  },[attrezzatura.cliente_codice]);

  const marchiCatalogo = useMemo(()=>{
    if(!catalog) return [];
    return [...new Set(catalog.map(p=>p.mar).filter(Boolean))].sort();
  },[catalog]);

  async function salva(){
    if(!nome.trim() || !numeroSerie.trim()) return;
    setSalvando(true); setErrore("");
    try{
      const payload = {
        nome_prodotto: nome.trim(),
        marchio: marchio || null,
        numero_serie: numeroSerie.trim(),
        data_installazione: dataInstallazione || null,
        scadenza_aggiornamenti: scadenzaAggiornamenti || null,
        scadenza_verifiche: scadenzaVerifiche || null,
        note: note.trim() || null,
        stato,
      };
      if(nuovoCliente) payload.cliente_codice = nuovoCliente.codice;
      await sbAuth("PATCH","attrezzature",`id=eq.${attrezzatura.id}`,payload,accessToken);
      onSalvata({ ...attrezzatura, ...payload });
    }catch(err){
      setErrore("Salvataggio non riuscito: "+err.message);
    }
    setSalvando(false);
  }
  async function elimina(){
    setErrore("");
    try{
      await sbAuth("DELETE","attrezzature",`id=eq.${attrezzatura.id}`,null,accessToken);
      onEliminata(attrezzatura.id);
    }catch(err){
      setErrore("Eliminazione non riuscita: "+err.message);
      setConfermaElimina(false);
    }
  }

  return (
    <div>
      <button onClick={onChiudi} style={{...S.btnS,marginBottom:14}}>← Indietro</button>
      <div style={S.eyebrow}>Modifica attrezzatura</div>

      {errore && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14,marginTop:10}}>⚠ {errore}</div>}

      <div style={{...S.card,cursor:"default",marginTop:10,marginBottom:16}}>
        <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Cliente</div>
        {caricandoCliente ? (
          <div style={{fontSize:12.5,color:"#9AA3AB"}}>Caricamento…</div>
        ) : !cambioClienteAperto ? (
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:600,fontSize:13.5}}>{nuovoCliente?.ragione_sociale || clienteAttuale?.ragione_sociale || attrezzatura.cliente_codice}</span>
            <button onClick={()=>setCambioClienteAperto(true)} style={{background:"none",border:"none",color:C.steel,fontSize:11.5,cursor:"pointer",textDecoration:"underline"}}>Sposta su un altro cliente</button>
          </div>
        ) : (
          <div>
            <SelezioneCliente clienteSelezionato={nuovoCliente} onSeleziona={c=>{setNuovoCliente(c); setCambioClienteAperto(false);}} sessione={sessione}/>
            <button onClick={()=>setCambioClienteAperto(false)} style={{marginTop:8,background:"none",border:"none",color:"#9AA3AB",fontSize:11.5,cursor:"pointer"}}>Annulla spostamento</button>
          </div>
        )}
        {nuovoCliente && (
          <div style={{fontSize:11.5,color:C.warn,marginTop:8}}>⚠ Verrà spostata su {nuovoCliente.ragione_sociale} al salvataggio.</div>
        )}
      </div>

      <div style={{...S.card,cursor:"default",marginBottom:16}}>
        <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Nome prodotto</label>
        <input value={nome} onChange={e=>setNome(e.target.value)} style={{...S.inp,marginBottom:12}}/>

        <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Marca</label>
        <select value={marchio} onChange={e=>setMarchio(e.target.value)} style={{...S.inp,marginBottom:12,color:marchio?C.charcoal:"#9AA3AB"}}>
          <option value="">— nessuna —</option>
          {marchiCatalogo.map(m=>(<option key={m} value={m}>{m}</option>))}
        </select>

        <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Numero di serie</label>
        <input value={numeroSerie} onChange={e=>setNumeroSerie(e.target.value)} style={{...S.inp,marginBottom:12,fontFamily:F_MONO}}/>

        <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Data installazione prodotto</label>
        <input type="date" value={dataInstallazione} onChange={e=>setDataInstallazione(e.target.value)} style={{...S.inp,marginBottom:12}}/>

        <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Scadenza aggiornamenti</label>
        <input type="date" value={scadenzaAggiornamenti} onChange={e=>setScadenzaAggiornamenti(e.target.value)} style={{...S.inp,marginBottom:12}}/>

        <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Scadenza verifiche di controllo</label>
        <input type="date" value={scadenzaVerifiche} onChange={e=>setScadenzaVerifiche(e.target.value)} style={{...S.inp,marginBottom:12}}/>

        <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Note</label>
        <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} style={{...S.inp,resize:"vertical",fontFamily:F_BODY}}/>
      </div>

      <div style={{...S.card,cursor:"default",marginBottom:16}}>
        <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Stato</div>
        <div style={{display:"flex",gap:8}}>
          {["Attiva","Dismessa"].map(s=>(
            <button key={s} onClick={()=>setStato(s)} style={{
              flex:1,border:`1px solid ${stato===s?(s==="Dismessa"?C.danger:C.ink):C.paperLine}`,borderRadius:8,padding:"10px",fontSize:12.5,cursor:"pointer",
              background:stato===s?(s==="Dismessa"?C.danger:C.ink):"#fff",color:stato===s?"#fff":"#5B6770",fontWeight:stato===s?600:400
            }}>{s}</button>
          ))}
        </div>
        {stato==="Dismessa" && <div style={{fontSize:11.5,color:"#9AA3AB",marginTop:8}}>Resta nello storico del cliente, ma non compare più tra le attrezzature attive né nei promemoria scadenze.</div>}
      </div>

      <button onClick={salva} disabled={salvando||!nome.trim()||!numeroSerie.trim()} style={{...S.btnAccent,width:"100%",padding:"13px",fontWeight:700,marginBottom:12}}>
        {salvando?"Salvo…":"💾 Salva modifiche"}
      </button>

      {!confermaElimina ? (
        <button onClick={()=>setConfermaElimina(true)} style={{width:"100%",padding:"12px",background:"#fff",color:C.danger,border:`1px solid ${C.danger}`,borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
          🗑 Elimina attrezzatura
        </button>
      ) : (
        <div style={{background:"rgba(200,75,58,0.08)",border:`1px solid ${C.danger}`,borderRadius:9,padding:16}}>
          <div style={{fontSize:13,fontWeight:700,color:C.danger,marginBottom:6}}>Confermi l'eliminazione definitiva?</div>
          <div style={{fontSize:12,color:C.steel,marginBottom:14}}>Se è solo fuori uso, valuta "Dismessa" sopra invece di eliminarla: qui si perde ogni storico.</div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={elimina} style={{flex:1,padding:"12px",background:C.danger,color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>Sì, elimina</button>
            <button onClick={()=>setConfermaElimina(false)} style={{flex:1,padding:"12px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>Annulla</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClienteDettaglio({cliente, onIndietro, preventivi, ordini, attrezzature, setAttrezzature, interventi, setInterventi, catalog, ruolo, sessione, tabIniziale}){
  const accessToken = trovaAccessToken(sessione);
  const [tab,setTab] = useState(tabIniziale || "dati");
  const [erroreLocale,setErroreLocale] = useState("");
  const [attrezzaturaInModifica,setAttrezzaturaInModifica] = useState(null);
  const preventiviCliente = (preventivi||[]).filter(p=>p.cliente_codice===cliente.codice);
  const ordiniCliente = (ordini||[]).filter(o=>o.cliente_codice===cliente.codice);
  const attrezzatureCliente = (attrezzature||[]).filter(a=>a.cliente_codice===cliente.codice);
  const interventiCliente = (interventi||[]).filter(i=>i.cliente_codice===cliente.codice);

  if(attrezzaturaInModifica){
    return <ModificaAttrezzatura
      attrezzatura={attrezzaturaInModifica}
      onChiudi={()=>setAttrezzaturaInModifica(null)}
      onSalvata={(agg)=>{ setAttrezzature(prev=>prev.map(x=>x.id===agg.id?agg:x)); setAttrezzaturaInModifica(null); }}
      onEliminata={(id)=>{ setAttrezzature(prev=>prev.filter(x=>x.id!==id)); setAttrezzaturaInModifica(null); }}
      catalog={catalog} sessione={sessione}
    />;
  }

  // ── Form: aggiungi attrezzatura ──
  const [formAttrezzaturaAperto,setFormAttrezzaturaAperto] = useState(false);
  const [qProdotto,setQProdotto] = useState("");
  const [prodottoScelto,setProdottoScelto] = useState(null);
  const [nomeLibero,setNomeLibero] = useState("");
  const [marchioLibero,setMarchioLibero] = useState("");
  const [numeroSerie,setNumeroSerie] = useState("");
  const [dataInstallazione,setDataInstallazione] = useState("");
  const [scadenzaAggiornamenti,setScadenzaAggiornamenti] = useState("");
  const [scadenzaVerifiche,setScadenzaVerifiche] = useState("");
  const [noteAttrezzatura,setNoteAttrezzatura] = useState("");
  const [salvandoAttrezzatura,setSalvandoAttrezzatura] = useState(false);

  // Elenco marchi già in uso nel catalogo, per il menu a tendina quando
  // l'attrezzatura non viene scelta da lì (es. attrezzatura di terzi, o non
  // ancora a catalogo) — evita marche scritte in modo incoerente a mano.
  const marchiCatalogo = useMemo(()=>{
    if(!catalog) return [];
    return [...new Set(catalog.map(p=>p.mar).filter(Boolean))].sort();
  },[catalog]);

  const risultatiProdotto = useMemo(()=>{
    if(!qProdotto.trim() || !catalog) return [];
    const qq = qProdotto.trim().toLowerCase();
    return catalog.filter(p=>
      (p.nome||"").toLowerCase().includes(qq) || (p.cod||"").toLowerCase().includes(qq)
    ).slice(0,8);
  },[qProdotto,catalog]);

  function resetFormAttrezzatura(){
    setFormAttrezzaturaAperto(false); setQProdotto(""); setProdottoScelto(null);
    setNomeLibero(""); setMarchioLibero(""); setNumeroSerie(""); setDataInstallazione("");
    setScadenzaAggiornamenti(""); setScadenzaVerifiche(""); setNoteAttrezzatura("");
  }
  async function salvaAttrezzatura(){
    const nome = prodottoScelto ? prodottoScelto.nome : nomeLibero.trim();
    const marchio = prodottoScelto ? prodottoScelto.mar : marchioLibero.trim();
    if(!nome || !numeroSerie.trim()) return;
    setSalvandoAttrezzatura(true); setErroreLocale("");
    try{
      const payload = {
        cliente_codice: cliente.codice,
        prodotto_cod: prodottoScelto?.cod || null,
        nome_prodotto: nome,
        marchio: marchio || null,
        numero_serie: numeroSerie.trim(),
        data_installazione: dataInstallazione || null,
        scadenza_aggiornamenti: scadenzaAggiornamenti || null,
        scadenza_verifiche: scadenzaVerifiche || null,
        note: noteAttrezzatura.trim() || null,
        creato_da_nome: sessione?.nome || null,
      };
      const [salvato] = await sbAuth("POST","attrezzature","",payload,accessToken);
      setAttrezzature(prev=>[salvato,...prev]);
      resetFormAttrezzatura();
    }catch(err){
      setErroreLocale("Salvataggio non riuscito: "+err.message);
    }
    setSalvandoAttrezzatura(false);
  }

  // ── Form: pianifica intervento ──
  const [formInterventoAperto,setFormInterventoAperto] = useState(false);
  const [tipoIntervento,setTipoIntervento] = useState("");
  const [dataIntervento,setDataIntervento] = useState("");
  const [prioritaIntervento,setPrioritaIntervento] = useState("media");
  const [noteIntervento,setNoteIntervento] = useState("");
  const [salvandoIntervento,setSalvandoIntervento] = useState(false);

  function resetFormIntervento(){
    setFormInterventoAperto(false); setTipoIntervento(""); setDataIntervento("");
    setPrioritaIntervento("media"); setNoteIntervento("");
  }
  async function salvaIntervento(){
    if(!tipoIntervento) return;
    setSalvandoIntervento(true); setErroreLocale("");
    try{
      const payload = {
        cliente_codice: cliente.codice,
        cliente_nome: cliente.ragione_sociale,
        tipo: tipoIntervento,
        priorita: prioritaIntervento,
        stato: "Pianificato",
        data_pianificata: dataIntervento || null,
        note: noteIntervento.trim() || null,
        creato_da_nome: sessione?.nome || null,
      };
      const [salvato] = await sbAuth("POST","interventi","",payload,accessToken);
      setInterventi(prev=>[salvato,...prev]);
      resetFormIntervento();
    }catch(err){
      setErroreLocale("Salvataggio non riuscito: "+err.message);
    }
    setSalvandoIntervento(false);
  }

  return (
    <div>
      <button onClick={onIndietro} style={{...S.btnS,marginBottom:14}}>← Tutti i clienti</button>

      <div style={{...S.card,cursor:"default",marginBottom:16}}>
        <div style={{fontFamily:F_DISPLAY,fontSize:19,fontWeight:600}}>{cliente.ragione_sociale}</div>
        {cliente.rag_sociale_agg && <div style={{fontSize:13,color:C.steel,marginTop:2}}>{cliente.rag_sociale_agg}</div>}
        <div className="tnum" style={{fontSize:11.5,color:"#9AA3AB",fontFamily:F_MONO,marginTop:6}}>COD {cliente.codice}</div>
      </div>

      {erroreLocale && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>⚠ {erroreLocale}</div>}

      <div style={{display:"flex",borderBottom:`1px solid ${C.paperLine}`,marginBottom:18,flexWrap:"wrap"}}>
        {[["dati","Dati"],["preventivi",`Preventivi (${preventiviCliente.length})`],["ordini",`Ordini (${ordiniCliente.length})`],["interventi",`Interventi (${interventiCliente.length})`],["attrezzature",`Attrezzature (${attrezzatureCliente.length})`]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{
            background:"none",border:"none",borderBottom:`2px solid ${tab===id?C.ink:"transparent"}`,
            padding:"8px 14px",fontSize:12.5,cursor:"pointer",
            color:tab===id?C.ink:C.steel,fontWeight:tab===id?600:400,
          }}>{lbl}</button>
        ))}
      </div>

      {tab==="dati" && (
        <div style={{display:"flex",flexDirection:"column",gap:1}}>
          {[
            ["Indirizzo", [cliente.indirizzo, cliente.cap, cliente.localita, cliente.provincia && `(${cliente.provincia})`].filter(Boolean).join(" ")],
            ["Telefono", cliente.telefono],
            ["E-mail", cliente.mail],
            ["Partita IVA", cliente.partita_iva],
            ["Codice fiscale", cliente.codice_fiscale],
            ["Filiale di riferimento", cliente.filiale],
          ].filter(([,v])=>v).map(([lbl,v])=>(
            <div key={lbl} style={{display:"flex",justifyContent:"space-between",padding:"10px 4px",borderBottom:`1px solid ${C.paperLine}`,fontSize:13}}>
              <span style={{color:C.steel}}>{lbl}</span>
              <span style={{fontWeight:600,textAlign:"right"}}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {tab==="preventivi" && (
        preventiviCliente.length===0 ? (
          <div style={{textAlign:"center",padding:"2rem 1rem",color:"#9AA3AB",fontSize:13}}>Nessun preventivo per questo cliente.</div>
        ) : preventiviCliente.map(p=>(
          <div key={p.id} style={{...S.card,cursor:"default",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
            <div style={{minWidth:0}}>
              <div className="tnum" style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO}}>{codicePreventivo(p)}</div>
              <div style={{fontSize:11.5,color:"#8A929A",marginTop:1}}>{(p.righe||[]).length} articoli</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div className="tnum" style={{fontWeight:700,fontSize:14,fontFamily:F_MONO}}>€{(p.val||0).toLocaleString("it-IT")}</div>
              <Tag tone={STATO_COLORE[p.stato]||"steel"} style={{marginTop:5}}>{p.stato}</Tag>
            </div>
          </div>
        ))
      )}

      {tab==="ordini" && (
        ordiniCliente.length===0 ? (
          <div style={{textAlign:"center",padding:"2rem 1rem",color:"#9AA3AB",fontSize:13}}>Nessun ordine per questo cliente.</div>
        ) : ordiniCliente.map(o=>(
          <div key={o.id} style={{...S.card,cursor:"default",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
            <div style={{minWidth:0}}>
              <div className="tnum" style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO}}>{codiceOrdine(o)}</div>
              <div style={{fontSize:11.5,color:"#8A929A",marginTop:1}}>{(o.righe||[]).length} articoli</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div className="tnum" style={{fontWeight:700,fontSize:14,fontFamily:F_MONO}}>€{(o.val||0).toLocaleString("it-IT")}</div>
              <Tag tone={toneOrdine(o.stato)} style={{marginTop:5}}>{o.stato}</Tag>
            </div>
          </div>
        ))
      )}

      {tab==="interventi" && (
        <div>
          {!formInterventoAperto ? (
            <button onClick={()=>setFormInterventoAperto(true)} style={{...S.btnAccent,width:"100%",padding:"12px",marginBottom:16,fontWeight:700}}>
              + Pianifica intervento
            </button>
          ) : (
            <div style={{...S.card,cursor:"default",marginBottom:16}}>
              <div style={{fontSize:13.5,fontWeight:700,marginBottom:10}}>Nuovo intervento</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                {Object.keys(TIPO_LABELS).map(t=>(
                  <button key={t} onClick={()=>setTipoIntervento(t)} style={{
                    border:`1px solid ${tipoIntervento===t?C.ink:C.paperLine}`,borderRadius:8,padding:"10px 8px",fontSize:12.5,cursor:"pointer",
                    background:tipoIntervento===t?C.ink:"#fff",color:tipoIntervento===t?"#fff":"#5B6770",fontWeight:tipoIntervento===t?600:500
                  }}>{TIPO_LABELS[t]}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <input type="date" value={dataIntervento} onChange={e=>setDataIntervento(e.target.value)} style={{...S.inp,flex:1}}/>
                <select value={prioritaIntervento} onChange={e=>setPrioritaIntervento(e.target.value)} style={{...S.inp,flex:1}}>
                  <option value="bassa">Priorità bassa</option>
                  <option value="media">Priorità media</option>
                  <option value="alta">Priorità alta</option>
                </select>
              </div>
              <textarea value={noteIntervento} onChange={e=>setNoteIntervento(e.target.value)} rows={2} placeholder="Note (opzionale)" style={{...S.inp,resize:"vertical",fontFamily:F_BODY,marginBottom:12}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={salvaIntervento} disabled={!tipoIntervento||salvandoIntervento} style={{flex:1,padding:"11px",background:tipoIntervento?C.ink:"#c8c8c8",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:tipoIntervento?"pointer":"default"}}>
                  {salvandoIntervento?"Salvo…":"Salva"}
                </button>
                <button onClick={resetFormIntervento} style={{flex:1,padding:"11px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>Annulla</button>
              </div>
            </div>
          )}

          {interventiCliente.length===0 ? (
            <div style={{textAlign:"center",padding:"1.5rem 1rem",color:"#9AA3AB",fontSize:13}}>Nessun intervento registrato per questo cliente.</div>
          ) : interventiCliente.map(i=>(
            <div key={i.id} style={{...S.card,cursor:"default"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                <div style={{minWidth:0}}>
                  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:4}}>
                    <Tag tone="primary">{TIPO_LABELS[i.tipo]||i.tipo}</Tag>
                    {i.data_pianificata && <span className="tnum" style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO}}>{new Date(i.data_pianificata).toLocaleDateString("it-IT")}</span>}
                  </div>
                  {i.note && <div style={{fontSize:12.5,color:C.charcoal}}>{i.note}</div>}
                  {i.creato_da_nome && <div style={{fontSize:11,color:"#8A929A",marginTop:3}}>Da {i.creato_da_nome}</div>}
                </div>
                <Tag tone={i.stato==="Completato"?"ok":i.priorita==="alta"?"danger":i.priorita==="media"?"warn":"steel"}>{i.stato==="Completato"?"Completato":i.priorita}</Tag>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==="attrezzature" && (
        <div>
          {!formAttrezzaturaAperto ? (
            <button onClick={()=>setFormAttrezzaturaAperto(true)} style={{...S.btnAccent,width:"100%",padding:"12px",marginBottom:16,fontWeight:700}}>
              + Registra attrezzatura
            </button>
          ) : (
            <div style={{...S.card,cursor:"default",marginBottom:16}}>
              <div style={{fontSize:13.5,fontWeight:700,marginBottom:10}}>Nuova attrezzatura installata</div>

              {!prodottoScelto ? (
                <>
                  <input value={qProdotto} onChange={e=>setQProdotto(e.target.value)} placeholder="Cerca nel catalogo per nome o codice…" style={{...S.inp,marginBottom:8}}/>
                  {risultatiProdotto.map(p=>(
                    <div key={p.cod} onClick={()=>{setProdottoScelto(p); setQProdotto("");}} style={{padding:"8px 10px",border:`1px solid ${C.paperLine}`,borderRadius:7,marginBottom:5,cursor:"pointer",fontSize:12.5}}>
                      <strong>{p.nome}</strong> <span style={{color:"#9AA3AB",fontFamily:F_MONO,fontSize:11}}>{p.cod}</span>
                    </div>
                  ))}
                  <div style={{fontSize:11,color:"#9AA3AB",margin:"6px 0"}}>oppure, se non è a catalogo:</div>
                  <input value={nomeLibero} onChange={e=>setNomeLibero(e.target.value)} placeholder="Nome prodotto" style={{...S.inp,marginBottom:8}}/>
                  <select value={marchioLibero} onChange={e=>setMarchioLibero(e.target.value)} style={{...S.inp,marginBottom:8,color:marchioLibero?C.charcoal:"#9AA3AB"}}>
                    <option value="">Marca (opzionale)</option>
                    {marchiCatalogo.map(m=>(<option key={m} value={m}>{m}</option>))}
                  </select>
                </>
              ) : (
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.paper,borderRadius:7,padding:"8px 10px",marginBottom:10}}>
                  <span style={{fontSize:12.5,fontWeight:600}}>{prodottoScelto.nome}</span>
                  <button onClick={()=>setProdottoScelto(null)} style={{background:"none",border:"none",color:"#9AA3AB",cursor:"pointer",fontSize:14}}>✕</button>
                </div>
              )}

              <input value={numeroSerie} onChange={e=>setNumeroSerie(e.target.value)} placeholder="Numero di serie *" style={{...S.inp,marginBottom:12,fontFamily:F_MONO}}/>

              <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Data installazione prodotto</label>
              <input type="date" value={dataInstallazione} onChange={e=>setDataInstallazione(e.target.value)} style={{...S.inp,marginBottom:12}}/>

              <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Scadenza aggiornamenti (opzionale)</label>
              <input type="date" value={scadenzaAggiornamenti} onChange={e=>setScadenzaAggiornamenti(e.target.value)} style={{...S.inp,marginBottom:12}}/>

              <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Scadenza verifiche di controllo (opzionale)</label>
              <input type="date" value={scadenzaVerifiche} onChange={e=>setScadenzaVerifiche(e.target.value)} style={{...S.inp,marginBottom:8}}/>
              {(scadenzaAggiornamenti || scadenzaVerifiche) && (
                <div style={{fontSize:11,color:"#9AA3AB",marginBottom:12}}>Un promemoria comparirà a responsabili e tecnici 30 giorni prima di ciascuna scadenza.</div>
              )}

              <textarea value={noteAttrezzatura} onChange={e=>setNoteAttrezzatura(e.target.value)} rows={2} placeholder="Note (opzionale)" style={{...S.inp,resize:"vertical",fontFamily:F_BODY,marginBottom:12}}/>

              <div style={{display:"flex",gap:8}}>
                <button onClick={salvaAttrezzatura} disabled={(!prodottoScelto && !nomeLibero.trim())||!numeroSerie.trim()||salvandoAttrezzatura} style={{flex:1,padding:"11px",background:((prodottoScelto||nomeLibero.trim())&&numeroSerie.trim())?C.ink:"#c8c8c8",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {salvandoAttrezzatura?"Salvo…":"Salva"}
                </button>
                <button onClick={resetFormAttrezzatura} style={{flex:1,padding:"11px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>Annulla</button>
              </div>
            </div>
          )}

          {attrezzatureCliente.length===0 ? (
            <div style={{textAlign:"center",padding:"1.5rem 1rem",color:"#9AA3AB",fontSize:13}}>Nessuna attrezzatura registrata per questo cliente.</div>
          ) : attrezzatureCliente.map(a=>{
            const statoAgg = statoScadenza(a.scadenza_aggiornamenti);
            const statoVer = statoScadenza(a.scadenza_verifiche);
            return (
            <div key={a.id} style={{...S.card,cursor:"default",...(a.stato==="Dismessa"?{opacity:0.6}:{})}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{minWidth:0}}>
                  {a.marchio && <Tag tone="steel">{a.marchio}</Tag>}
                  {a.stato==="Dismessa" && <Tag tone="danger">Dismessa</Tag>}
                  <div style={{fontWeight:600,fontSize:13.5,marginTop:6}}>{a.nome_prodotto}</div>
                </div>
                <button onClick={()=>setAttrezzaturaInModifica(a)} style={{background:"none",border:"none",color:C.steel,fontSize:11.5,cursor:"pointer",textDecoration:"underline",flexShrink:0}}>✎ Modifica</button>
              </div>
              <div className="tnum" style={{fontSize:11,color:"#9AA3AB",fontFamily:F_MONO,marginTop:3}}>S/N {a.numero_serie}</div>
              {a.data_installazione && <div style={{fontSize:11.5,color:"#8A929A",marginTop:3}}>Installata il {new Date(a.data_installazione).toLocaleDateString("it-IT")}</div>}
              {a.scadenza_aggiornamenti && (
                <div style={{fontSize:11.5,marginTop:3,color:statoAgg.scaduta?C.danger:statoAgg.vicina?C.warn:"#8A929A",fontWeight:statoAgg.scaduta||statoAgg.vicina?600:400}}>
                  {statoAgg.scaduta?"⚠ ":""}Aggiornamenti in scadenza il {new Date(a.scadenza_aggiornamenti).toLocaleDateString("it-IT")}
                </div>
              )}
              {a.scadenza_verifiche && (
                <div style={{fontSize:11.5,marginTop:3,color:statoVer.scaduta?C.danger:statoVer.vicina?C.warn:"#8A929A",fontWeight:statoVer.scaduta||statoVer.vicina?600:400}}>
                  {statoVer.scaduta?"⚠ ":""}Verifica di controllo in scadenza il {new Date(a.scadenza_verifiche).toLocaleDateString("it-IT")}
                </div>
              )}
              {a.note && <div style={{fontSize:12,color:C.charcoal,marginTop:5}}>{a.note}</div>}
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

// ─── PREVENTIVI ───────────────────────────────────────────────────────────────
// Loghi/grafica fissi del modello Telos (caricati una tantum su Storage,
// bucket pubblico "preventivo-assets" — vedi istruzioni di caricamento).
const ASSET_BASE = `${SUPABASE_URL}/storage/v1/object/public/preventivo-assets`;
const LOGO_TELOS_TECH = `${ASSET_BASE}/telos-tech-logo.png`;
const LOGO_CHEVRON = `${ASSET_BASE}/chevron.png`;
const LOGO_STRISCIA_MARCHI = `${ASSET_BASE}/striscia-loghi-marchi.png`;
const LOGO_TELOS_SPA = `${ASSET_BASE}/telos-spa-logo.png`;
const LOGO_BADGE_PARTNER = `${ASSET_BASE}/badge-partner.png`;

const TESTO_CONDIZIONI = `
<h2>Condizioni di accettazione del preventivo</h2>
<p class="intro">La sottoscrizione del presente preventivo, mediante apposizione di timbro e firma del Cliente nello spazio dedicato, vale quale accettazione integrale dell'offerta e produce gli effetti di un ordine contrattuale vincolante ai sensi degli artt. 1326 e ss. del Codice Civile.</p>
<h3>1. Conclusione del contratto</h3>
<p>Il preventivo costituisce proposta contrattuale ai sensi dell'art. 1326 c.c. Il contratto si intende concluso nel momento in cui Telos S.p.A. riceve copia del presente documento sottoscritta dal Cliente con timbro e firma per accettazione, anche a mezzo email o PEC. L'accettazione deve pervenire entro la data di scadenza indicata; decorso tale termine la proposta si intende decaduta, salvo conferma scritta del fornitore.</p>
<h3>2. Oggetto, prezzi e validità</h3>
<p>I prezzi indicati sono espressi in Euro, si intendono al netto di IVA e di ogni altra imposta o contributo di legge, e sono validi per la quantità e configurazione descritte nel preventivo. Eventuali variazioni richieste dal Cliente successive all'accettazione potranno comportare un adeguamento dei prezzi e dei tempi di consegna, da concordarsi per iscritto.</p>
<h3>3. Modalità di pagamento</h3>
<p>I pagamenti dovranno essere effettuati secondo le modalità e i termini indicati nel preventivo. In caso di ritardato pagamento si applicano gli interessi moratori previsti dal D.Lgs. 231/2002 in materia di lotta contro i ritardi di pagamento nelle transazioni commerciali, fatto salvo il maggior danno.</p>
<h3>4. Consegna, installazione e rischio</h3>
<p>I termini di consegna sono indicativi e decorrono dalla data di ricevimento dell'accettazione e dell'eventuale acconto. Salvo diverso accordo scritto, la consegna si intende Franco Fabbrica (EXW Incoterms 2020): il rischio di perimento o danneggiamento dei beni si trasferisce al Cliente al momento della messa a disposizione dei beni medesimi.</p>
<h3>5. Riserva di proprietà</h3>
<p>Ai sensi dell'art. 1523 c.c., i beni oggetto del preventivo restano di proprietà di Telos S.p.A. fino all'integrale pagamento del prezzo pattuito. Il Cliente si impegna a custodirli con la diligenza del buon padre di famiglia e a non alienarli o costituire diritti di garanzia in favore di terzi prima del saldo.</p>
<h3>6. Garanzia e responsabilità</h3>
<p>Trovano applicazione le garanzie di legge previste dal Codice Civile (artt. 1490 e ss.) e, ove ricorra trattativa con consumatore, dal D.Lgs. 206/2005 (Codice del Consumo). La responsabilità di Telos S.p.A. per eventuali danni è limitata, nei limiti consentiti dalla legge, al valore della fornitura, con esclusione di danni indiretti, mancato guadagno o perdita di chance.</p>
<h3>7. Recesso e annullamento</h3>
<p>L'accettazione del preventivo è vincolante per il Cliente professionale. Per i contratti conclusi a distanza o fuori dai locali commerciali con soggetto consumatore si applica il diritto di recesso entro 14 giorni ai sensi degli artt. 52 e ss. del Codice del Consumo, ove ne ricorrano i presupposti.</p>
<h3>8. Trattamento dei dati personali</h3>
<p>I dati personali del Cliente sono trattati da Telos S.p.A., in qualità di Titolare, per la gestione del rapporto contrattuale e degli adempimenti di legge, nel rispetto del Regolamento (UE) 2016/679 (GDPR) e del D.Lgs. 196/2003. L'informativa estesa è disponibile su richiesta e sul sito www.telosspa.it.</p>
<h3>9. Foro competente e legge applicabile</h3>
<p>Il contratto è regolato dalla legge italiana. Per ogni controversia derivante dall'interpretazione o esecuzione del presente preventivo è competente in via esclusiva il Foro di Torino, salvo, ove inderogabilmente previsto dalla legge, il foro del consumatore.</p>
`;

// Genera il PDF del preventivo in tre parti: copertina, pagina/e contenuto
// (intestazione Telos SPA, tabella articoli con foto dal catalogo, totali,
// finanziamento/noleggio se scelto, note), pagina condizioni + firma —
// stesso schema dei preventivi Telos già in uso.
// "righe": array di {cod, mar, nome, netto, listino, qty, img, desc_prev} —
// img/desc_prev vanno arricchiti dal chiamante pescandoli dal catalogo,
// perché le righe salvate nel preventivo non li contengono.
function generaPreventivoPDF(righe, total, meta={}){
  const iva = total * 0.22;
  const totaleIva = total + iva;
  const oggi = new Date().toLocaleDateString("it-IT");
  const codiceMostrato = meta.codice || `PRV-${Date.now().toString().slice(-6)}`;
  const scadenzaMostrata = meta.scadenza ? new Date(meta.scadenza).toLocaleDateString("it-IT") : null;
  const pagamentoMostrato = meta.pagamento_modalita
    ? `${meta.pagamento_modalita}${meta.pagamento_dettagli?` — ${meta.pagamento_dettagli}`:""}`
    : "Da concordare";
  const referente = meta.referente_telos || "";

  const righeHtml = righe.map((r,i) => {
    const totRiga = r.netto * (r.qty||1);
    const caratteristiche = (r.desc_prev||"").split(/\n|;/).map(x=>x.trim()).filter(Boolean);
    return `
    <tr class="riga-prodotto ${i%2===1?"riga-alt":""}">
      <td class="cella-prodotto">
        <div class="prodotto-tag"><span class="tag">${r.mar||""}</span></div>
        <div class="prodotto-nome">${r.nome||""}</div>
        <div class="prodotto-codice">${r.cod||""}</div>
        ${r.img ? `<div class="prodotto-img"><img src="${r.img}" alt=""/></div>` : ""}
      </td>
      <td class="cella-descr">
        ${r.desc ? `<div class="descr-testo">${r.desc}</div>` : ""}
        ${caratteristiche.length ? `<div class="caratteristiche-testo">${caratteristiche.join("<br/>")}</div>` : ""}
      </td>
      <td class="cella-num">${r.qty||1}</td>
      <td class="cella-num">€${(r.listino||0).toFixed(2)}</td>
      <td class="cella-num">€${r.netto.toFixed(2)}</td>
      <td class="cella-num cella-tot">€${totRiga.toFixed(2)}</td>
    </tr>`;
  }).join("");

  const finanziamentoHtml = meta.finanziamento_tipo && meta.finanziamento_rata ? `
    <div class="finanziamento-riga">${meta.finanziamento_tipo==="noleggio"?"Noleggio":"Finanziamento"}: €${meta.finanziamento_rata.toFixed(2)} x ${meta.finanziamento_mesi} mesi</div>
    ${meta.finanziamento_spese_contratto!=null ? `<div class="finanziamento-nota">Spese di istruttoria: €${meta.finanziamento_spese_contratto.toFixed(2)}</div>` : ""}
    ${meta.finanziamento_tipo==="noleggio" && meta.finanziamento_riscatto!=null ? `<div class="finanziamento-nota">Riscatto finale (1% imponibile): €${meta.finanziamento_riscatto.toFixed(2)}</div>` : ""}
  ` : "";

  const w = window.open("", "_blank");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Preventivo ${codiceMostrato}</title>
<style>
  @page{size:A4;margin:0}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:210mm}
  body{font-family:Arial,sans-serif;color:#232323;font-size:12.5px}
  .pagina{width:210mm;min-height:297mm;padding:14mm 16mm;page-break-after:always;display:flex;flex-direction:column}
  .pagina:last-child{page-break-after:auto}

  /* ── Copertina ── */
  .cover{text-align:center;align-items:center;padding-top:0}
  .cover-spacer{flex:1}
  .cover-logo{width:58mm;margin-top:4mm;position:relative;left:-3mm}
  .cover-cliente{font-size:28px;font-weight:700;margin-bottom:8px}
  .cover-referente{font-size:15px;font-style:italic;color:#3A4248}
  .cover-chevron{width:52mm}
  .cover-titolo{font-size:25px;font-weight:700}
  .cover-strip{width:calc(100% + 20mm);margin-left:-10mm;margin-right:-10mm;margin-bottom:9mm}
  .cover-contatti{font-size:11.5px;color:#162758;font-weight:700;line-height:1.8}
  .cover-contatti span{display:block;font-weight:400;color:#5B6770}

  /* ── Pagina contenuto ── */
  .corpo-contenuto{flex:1}
  .hd-content{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #162758}
  .hd-content .logo-telos-spa{height:46px}
  .hd-content .badge-partner{height:36px}
  .riga-titolo{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}
  .titolo-ordine{font-size:21px;font-weight:700;color:#162758;white-space:nowrap}
  .meta-box{display:grid;grid-template-columns:auto auto;column-gap:10px;row-gap:3px;font-size:11px;justify-content:end;flex-shrink:0}
  .meta-box .etichetta{color:#7C879E;text-align:right}
  .meta-box .valore{text-align:left;font-weight:600;white-space:nowrap}
  .cliente-box{font-size:12.5px;margin-bottom:20px}
  .cliente-box .nome{font-weight:700;font-size:14px}

  table.articoli{width:100%;border-collapse:collapse;margin-bottom:18px;table-layout:fixed}
  table.articoli thead th{background:#162758;color:#fff;padding:9px 10px;font-size:10.5px;text-align:left}
  table.articoli thead th.cella-num{text-align:right}
  .riga-prodotto td{border-bottom:1px solid #E3E5EA;padding:12px 10px;vertical-align:top;font-size:11.5px}
  .riga-alt td{background:#F3F6FB}
  .cella-prodotto{width:22%}
  .tag{display:inline-block;font-size:9px;font-weight:600;text-transform:uppercase;background:#EEF0F4;color:#5B6770;padding:2px 7px;border-radius:3px;margin-bottom:3px}
  .prodotto-nome{font-weight:600}
  .prodotto-codice{font-family:monospace;font-size:9.5px;color:#9AA3AB;margin-top:2px}
  .cella-descr{width:40%}
  .prodotto-img{width:100%;max-width:140px;height:100px;border-radius:6px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-top:8px}
  .prodotto-img img{max-width:100%;max-height:100%;object-fit:contain}
  .caratteristiche-testo{font-size:9.5px;color:#7C879E;line-height:1.5;margin-top:6px}
  .descr-testo{font-size:10.5px;color:#5B6770;line-height:1.5}
  .cella-num{text-align:right;white-space:nowrap;width:9.5%}
  .cella-tot{font-weight:700;color:#162758}

  .totali-box{text-align:right;margin-top:8px}
  .tot-imponibile{font-size:17px;font-weight:700;color:#162758}
  .finanziamento-riga{font-size:12px;color:#162758;font-weight:600;margin-top:4px}
  .finanziamento-nota{font-size:10px;color:#7C879E}

  .note-box{margin-top:22px;font-size:11px;color:#3A4248}
  .note-box .lbl{font-weight:700;margin-bottom:4px}
  .note-box .testo{white-space:pre-line}

  .footer-legale{font-size:9px;color:#9AA3AB;border-top:1px solid #E3E5EA;padding-top:8px;margin-top:16px}
  .footer-legale b{color:#5B6770}

  /* ── Pagina condizioni ── */
  .condizioni h2{font-size:17px;color:#162758;margin-bottom:14px}
  .condizioni h3{font-size:11.5px;color:#162758;margin-top:14px;margin-bottom:4px}
  .condizioni p{font-size:10.5px;line-height:1.55;color:#3A4248}
  .condizioni p.intro{font-style:italic;margin-bottom:14px}
  .firma-box{margin-top:36px;border:1px solid #162758;border-radius:6px;padding:16px}
  .firma-box .titolo{font-weight:700;font-size:12px;margin-bottom:6px}
  .firma-box .testo{font-size:10.5px;color:#3A4248;margin-bottom:36px}
  .firma-linee{display:flex;justify-content:space-between;font-size:10px;color:#7C879E}
  .firma-linee div{width:45%;border-top:1px solid #232323;padding-top:4px}
  .firma-digitale img{max-width:200px;max-height:80px;display:block;margin-top:6px}
  .firma-digitale-nota{font-size:9.5px;color:#7C879E;margin-top:6px;font-style:italic}
</style></head><body>

${meta.includi_copertina!==false ? `
<div class="pagina cover">
  <img class="cover-logo" src="${LOGO_TELOS_TECH}" alt="Telos Tech"/>
  <div class="cover-spacer"></div>
  <div>
    <div class="cover-cliente">${(meta.cliente||"CLIENTE").toUpperCase()}</div>
    ${referente ? `<div class="cover-referente">vs. referente: ${referente}</div>` : ""}
  </div>
  <div class="cover-spacer"></div>
  <img class="cover-chevron" src="${LOGO_CHEVRON}" alt=""/>
  <div class="cover-spacer"></div>
  <div class="cover-titolo">Preventivo</div>
  <div class="cover-spacer"></div>
  <img class="cover-strip" src="${LOGO_STRISCIA_MARCHI}" alt=""/>
  <div class="cover-contatti">TELOS SPA - Reparto Telos Tech<span>Via Aosta, 5 - 10078 Venaria Reale (TO)</span><span>Tel. 0114242932 - E-Mail: attrezzatura@telosgroup.it</span></div>
</div>
` : ""}
<div class="pagina">
  <div class="corpo-contenuto">
    <div class="hd-content">
      <img class="logo-telos-spa" src="${LOGO_TELOS_SPA}" alt="Telos SPA"/>
      <img class="badge-partner" src="${LOGO_BADGE_PARTNER}" alt=""/>
    </div>
    <div class="riga-titolo">
      <div class="titolo-ordine">PROPOSTA ORDINE</div>
      <div class="meta-box">
        <div class="etichetta">Numero</div><div class="valore">${codiceMostrato}</div>
        <div class="etichetta">Data</div><div class="valore">${oggi}</div>
        <div class="etichetta">Scadenza</div><div class="valore">${scadenzaMostrata||"—"}</div>
        <div class="etichetta">Pagamento</div><div class="valore">${pagamentoMostrato}</div>
      </div>
    </div>
    <div class="cliente-box">
      <div style="color:#7C879E;font-size:10px">Spett.le Cliente</div>
      <div class="nome">${meta.cliente||""}</div>
    </div>

    <table class="articoli">
      <thead><tr>
        <th>Prodotto</th><th>Descrizione</th><th class="cella-num">Qtà</th><th class="cella-num">Listino</th><th class="cella-num">Netto</th><th class="cella-num">Totale</th>
      </tr></thead>
      <tbody>${righeHtml}</tbody>
    </table>

    <div class="totali-box">
      <div class="tot-imponibile">Totale (IVA esclusa): €${total.toFixed(2)}</div>
      ${finanziamentoHtml}
    </div>

    ${meta.note ? `<div class="note-box"><div class="lbl">Note:</div><div class="testo">${meta.note}</div></div>` : ""}
  </div>

  <div class="footer-legale">
    <b>TELOS S.P.A.</b> P.I./C.F. 00525920013 - capitale sociale € 3.586.191,18 i.v. - REA TO-457465 | www.telosspa.it<br/>
    <b>SEDE Legale:</b> VENARIA (TO) - 10078 - Via Aosta 5 - Tel. 011.4242932 · <b>Amministrazione:</b> amministrazione.torino@telosgroup.it
  </div>
</div>

<div class="pagina condizioni">
  <div class="corpo-contenuto">
    ${TESTO_CONDIZIONI}
    <div class="firma-box">
      <div class="titolo">Timbro e Firma per accettazione</div>
      <div class="testo">Il sottoscritto Cliente dichiara di aver letto, compreso e integralmente accettato il preventivo e le condizioni che precedono, che assumono valore di ordine contrattuale vincolante.</div>
      ${meta.firma_cliente ? `
      <div class="firma-digitale">
        <img src="${meta.firma_cliente}" alt="Firma cliente"/>
        <div class="firma-digitale-nota">Firmato digitalmente da ${meta.firma_nome||"Cliente"}${meta.firma_data ? ` il ${new Date(meta.firma_data).toLocaleString("it-IT",{dateStyle:"short",timeStyle:"short"})}` : ""}</div>
      </div>
      ` : `
      <div class="firma-linee"><div>Luogo e data</div><div>Timbro e firma del Cliente</div></div>
      `}
    </div>
  </div>
  <div class="footer-legale">
    <b>TELOS S.P.A.</b> P.I./C.F. 00525920013 - capitale sociale € 3.586.191,18 i.v. - REA TO-457465 | www.telosspa.it<br/>
    <b>SEDE Legale:</b> VENARIA (TO) - 10078 - Via Aosta 5 - Tel. 011.4242932 · <b>Amministrazione:</b> amministrazione.torino@telosgroup.it
  </div>
</div>

<script>
(function(){
  // Aspetta che tutte le immagini (loghi, foto prodotto) siano davvero
  // caricate prima di stampare — con un timeout fisso, alla primissima
  // apertura (prima che il browser avesse le immagini in cache) la stampa
  // partiva prima che i loghi finissero di caricare, e restavano bianchi.
  var stampato = false;
  function stampaUnaVolta(){ if(stampato) return; stampato = true; window.print(); }
  var imgs = Array.prototype.slice.call(document.images);
  var rimanenti = imgs.filter(function(im){ return !im.complete; }).length;
  if(rimanenti===0){ setTimeout(stampaUnaVolta, 150); }
  else {
    imgs.forEach(function(im){
      if(im.complete) return;
      im.addEventListener('load', function(){ rimanenti--; if(rimanenti<=0) stampaUnaVolta(); });
      im.addEventListener('error', function(){ rimanenti--; if(rimanenti<=0) stampaUnaVolta(); });
    });
  }
  setTimeout(stampaUnaVolta, 4000); // rete di sicurezza se qualcosa si blocca
})();
</script>
</body></html>`;
  w.document.write(html);
  w.document.close();
}

// ─── RICERCA PRODOTTI INLINE (per aggiungere articoli a un preventivo bozza) ──
// Riusa lo stesso motore di ricerca a token + radice + fallback AI del Catalogo,
// montato in piccolo dentro la vista dettaglio del preventivo.
function RicercaProdottiInline({onSeleziona, righeEsistenti, ruolo, catalog:catProp, sessione}){
  const CATS = catProp || CATALOG;
  const accessToken = trovaAccessToken(sessione);
  const [q,setQ]=useState("");
  const [aiResults,setAiResults]=useState(null);
  const [aiSearching,setAiSearching]=useState(false);
  const [schedaProdotto,setSchedaProdotto]=useState(null); // prodotto aperto in dettaglio

  // stesso accorgimento del Catalogo: indice costruito dopo il paint per non
  // congelare l'interfaccia (~27.000 prodotti).
  const [searchIndex,setSearchIndex]=useState(null);
  useEffect(()=>{
    let annullato=false;
    const t=setTimeout(()=>{
      const idx=buildSearchIndex(CATS);
      if(!annullato) setSearchIndex(idx);
    },0);
    return ()=>{annullato=true;clearTimeout(t);};
  },[CATS]);

  const tokenResults = useMemo(()=>{
    if(!q.trim()) return [];
    if(!searchIndex) return [];
    return searchToken(q, searchIndex);
  },[q, searchIndex]);

  useEffect(()=>{
    setAiResults(null);
    if(!q.trim() || tokenResults.length>0) return;
    const parole = tokenizza(q);
    if(parole.length < 2) return;
    let cancelled = false;
    setAiSearching(true);
    searchSemantica(q, CATS, accessToken).then(res=>{
      if(!cancelled){ setAiResults(res); setAiSearching(false); }
    }).catch(()=>{ if(!cancelled){ setAiResults([]); setAiSearching(false); } });
    return ()=>{cancelled=true;};
  },[q, tokenResults.length, CATS]);

  const risultati = (tokenResults.length>0 ? tokenResults : (aiResults||[])).slice(0,8);
  const codiciPresenti = new Set(righeEsistenti.map(r=>r.cod));

  return (
    <div style={{marginBottom:18}}>
      <div style={S.eyebrow}>Aggiungi articolo</div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Cerca per nome, codice, marchio…" style={{...S.inp,marginBottom:8}}/>
      {aiSearching && <div style={{fontSize:11.5,color:"#8A929A",marginBottom:8}}>Nessun risultato diretto — interpreto la richiesta…</div>}
      {q.trim() && risultati.length===0 && !aiSearching && (
        <div style={{fontSize:12,color:"#9AA3AB",padding:"8px 0"}}>Nessun prodotto trovato per "{q}"</div>
      )}
      {risultati.map(p=>{
        const presente = codiciPresenti.has(p.cod);
        return (
          <div key={p.cod} onClick={()=>setSchedaProdotto(p)} style={{
            ...S.card, cursor:"pointer", display:"flex", gap:10, alignItems:"center", opacity: presente?0.6:1,
          }}>
            {p.img && (
              <div style={{width:42,height:42,flexShrink:0,borderRadius:6,border:`1px solid ${C.paperLine}`,background:"#fff",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <img src={p.img} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}} onError={e=>{e.target.parentNode.style.display="none";}}/>
              </div>
            )}
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",gap:5,marginBottom:3,flexWrap:"wrap"}}>
                <Tag tone="steel">{p.mar}</Tag>
                <span style={{fontSize:10,color:"#9AA3AB",fontFamily:F_MONO}}>{p.cod}</span>
              </div>
              <div style={{fontWeight:600,fontSize:13,lineHeight:1.3}}>{p.nome||p.desc}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              <span className="tnum" style={{fontWeight:700,fontFamily:F_MONO,fontSize:13,color:C.ink}}>€{p.netto.toFixed(2)}</span>
              {presente ? (
                <span style={{fontSize:10.5,color:C.ok,fontWeight:600}}>✓ Già inserito</span>
              ) : (
                <span style={{fontSize:11,color:C.steel}}>›</span>
              )}
            </div>
          </div>
        );
      })}

      {schedaProdotto && (
        <SchedaProdottoSelezione
          p={schedaProdotto}
          ruolo={ruolo}
          giaPresente={codiciPresenti.has(schedaProdotto.cod)}
          onConferma={(rigaCompilata)=>{ onSeleziona(rigaCompilata); setSchedaProdotto(null); setQ(""); }}
          onClose={()=>setSchedaProdotto(null)}
        />
      )}
    </div>
  );
}

// ─── SCHEDA PRODOTTO IN FASE DI SELEZIONE (vista, quantità, sconto) ──────────
function SchedaProdottoSelezione({p, ruolo, giaPresente, onConferma, onClose}){
  const [qty,setQty]=useState(1);
  const [nettoUnitario,setNettoUnitario]=useState(p.netto);
  const [costoEsclusivo,setCostoEsclusivo]=useState(COSTI_ESCLUSIVI[p.cod]?.costo ?? null);
  const [noteCosto,setNoteCosto]=useState(COSTI_ESCLUSIVI[p.cod]?.note ?? "");
  const [editCosto,setEditCosto]=useState(false);

  const puoModificare = puoModificarePrezzoLiberamente(ruolo);
  const vediCosti = puoModificare; // stessa condizione — solo responsabile/admin

  const costoInfo = getCostoAcquisto({...p, netto: nettoUnitario});
  const costoCalcolato = costoEsclusivo ?? costoInfo?.costo;
  const margine = calcolaMargine(nettoUnitario, costoCalcolato);
  const sottoMargine = margine!==null && margine < MARGINE_MINIMO_PERC;
  const scontoApplicato = p.listino>0 ? ((1 - nettoUnitario/p.listino)*100) : 0;
  const totaleRiga = nettoUnitario * qty;
  const totaleRigaCosto = costoCalcolato ? costoCalcolato * qty : null;
  const margineEuro = totaleRigaCosto ? totaleRiga - totaleRigaCosto : null;

  function salvaCostoEsclusivo(){
    if(costoEsclusivo!=null) COSTI_ESCLUSIVI[p.cod] = { costo: costoEsclusivo, note: noteCosto };
    else delete COSTI_ESCLUSIVI[p.cod];
    setEditCosto(false);
  }

  function conferma(){
    onConferma({
      cod: p.cod, mar: p.mar, nome: p.nome||p.desc,
      listino: p.listino, netto: nettoUnitario, qty,
      costo: costoCalcolato,
      sottoMargine: sottoMargine,
      notaProdotto: p.note || null,
    });
  }

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(14,26,64,.55)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60}}>
      <div style={{background:"#fff",borderRadius:"14px 14px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{position:"sticky",top:0,background:"#fff",padding:"14px 20px 0"}}>
          <div style={{width:36,height:4,background:C.paperLine,borderRadius:2,margin:"0 auto 14px"}}/>
        </div>
        <div style={{padding:"0 20px 24px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
            <div style={{fontFamily:F_DISPLAY,fontSize:19,fontWeight:600}}>{p.nome||p.desc}</div>
            <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#9AA3AB",flexShrink:0,marginLeft:10}}>✕</button>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
            <Tag tone="primary">{p.mar}</Tag>
            <span className="tnum" style={{fontSize:11,color:"#8A929A",fontFamily:F_MONO}}>{p.cod} · {p.cat}</span>
          </div>

          {p.img && (
            <div style={{background:C.paper,border:`1px solid ${C.paperLine}`,borderRadius:10,padding:14,marginBottom:16,display:"flex",alignItems:"center",justifyContent:"center",minHeight:140}}>
              <img src={p.img} alt={p.nome} style={{maxWidth:"100%",maxHeight:180,objectFit:"contain"}} onError={e=>{e.target.style.display="none";}}/>
            </div>
          )}

          {p.desc && <div style={{fontSize:13,color:"#5B6770",marginBottom:16,lineHeight:1.55}}>{p.desc}</div>}

          {giaPresente && (
            <div style={{fontSize:12,color:C.ok,background:"rgba(63,157,99,0.08)",borderRadius:6,padding:"8px 10px",marginBottom:14}}>
              Questo articolo è già nel preventivo. Confermando, la quantità verrà sostituita.
            </div>
          )}

          {/* Quantità */}
          <div style={S.eyebrow}>Quantità</div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
            <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{...S.btnS,width:38,height:38,padding:0,fontSize:16}}>−</button>
            <input type="number" min="1" value={qty} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))} className="tnum" style={{...S.inp,width:70,textAlign:"center",fontWeight:700,fontFamily:F_MONO}}/>
            <button onClick={()=>setQty(q=>q+1)} style={{...S.btnS,width:38,height:38,padding:0,fontSize:16}}>+</button>
          </div>

          {/* Prezzi: listino + netto affiancati */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
            <div>
              <div style={S.eyebrow}>Listino</div>
              <div className="tnum" style={{fontSize:16,fontWeight:600,fontFamily:F_MONO,color:"#9AA3AB",textDecoration:"line-through"}}>€{(p.listino||0).toFixed(2)}</div>
            </div>
            <div>
              <div style={S.eyebrow}>Netto {puoModificare ? "" : "Telos"}</div>
              {puoModificare ? (
                <input type="number" step="0.01" value={nettoUnitario} onChange={e=>setNettoUnitario(parseFloat(e.target.value)||0)} className="tnum" style={{...S.inp,fontSize:16,fontWeight:700,fontFamily:F_MONO,color:C.ink,padding:"6px 8px"}}/>
              ) : (
                <div className="tnum" style={{fontSize:16,fontWeight:700,fontFamily:F_MONO,color:C.ink}}>€{nettoUnitario.toFixed(2)}</div>
              )}
            </div>
          </div>
          {puoModificare && p.listino>0 && (
            <div style={{fontSize:11,color:"#9AA3AB",marginTop:-10,marginBottom:14}}>Sconto su listino: {scontoApplicato.toFixed(1)}%</div>
          )}
          {!puoModificare && (
            <div style={{fontSize:11,color:C.steel,marginBottom:14}}>Modifica prezzo riservata a responsabili e admin</div>
          )}

          {/* ── SEZIONE COSTO — solo responsabile/admin ── */}
          {vediCosti && (
            <div style={{background:C.paper,border:`1px solid ${C.paperLine}`,borderRadius:10,padding:"12px 14px",marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontFamily:F_MONO,fontSize:10.5,fontWeight:600,color:"#6B7280",textTransform:"uppercase",letterSpacing:"0.06em"}}>🔒 Costo acquisto</div>
                <button onClick={()=>setEditCosto(e=>!e)} style={{fontSize:11,color:C.ink,background:"none",border:`0.5px solid ${C.paperLine}`,borderRadius:5,padding:"3px 8px",cursor:"pointer"}}>{editCosto?"Chiudi":"Modifica"}</button>
              </div>

              {!editCosto ? (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div>
                    <div style={{fontSize:10.5,color:"#9AA3AB",marginBottom:2}}>
                      {costoEsclusivo!=null
                        ? "Costo esclusivo articolo"
                        : costoInfo?.tipo==="marchio"
                          ? `Cond. marchio: −${costoInfo.sconto_pct}%${costoInfo.extra_pct>0?` +${costoInfo.extra_pct}%`:""} (eff. −${costoInfo.effettivo_pct.toFixed(1)}%)`
                          : "Costo non disponibile"}
                    </div>
                    <div className="tnum" style={{fontSize:15,fontWeight:700,fontFamily:F_MONO,color:costoCalcolato?C.charcoal:"#9AA3AB"}}>
                      {costoCalcolato ? `€${costoCalcolato.toFixed(2)}` : "N/D"}
                    </div>
                    {costoEsclusivo!=null && noteCosto && <div style={{fontSize:10.5,color:C.steel,marginTop:3}}>{noteCosto}</div>}
                  </div>
                  <div>
                    <div style={{fontSize:10.5,color:"#9AA3AB",marginBottom:2}}>Margine</div>
                    <div className="tnum" style={{fontSize:15,fontWeight:700,fontFamily:F_MONO,color:sottoMargine?C.danger:C.ok}}>
                      {margine!=null ? `${margine.toFixed(1)}%` : "N/D"}
                    </div>
                    {margineEuro!=null && <div className="tnum" style={{fontSize:10.5,color:"#9AA3AB",marginTop:3}}>€{margineEuro.toFixed(2)} sulla riga</div>}
                  </div>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div>
                    <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>Costo esclusivo per questo articolo (lascia vuoto per usare la condizione marchio)</div>
                    <input type="number" step="0.01" value={costoEsclusivo??""} placeholder={costoInfo?.costo ? `Cond. marchio: €${costoInfo.costo.toFixed(2)}` : "Inserisci costo"} onChange={e=>setCostoEsclusivo(e.target.value?parseFloat(e.target.value):null)} className="tnum" style={{...S.inp,fontFamily:F_MONO,fontWeight:600}}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>Note (es. "accordo speciale scad. 31/12/2024")</div>
                    <input value={noteCosto} onChange={e=>setNoteCosto(e.target.value)} placeholder="Opzionale" style={S.inp}/>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={salvaCostoEsclusivo} style={{...S.btnAccent,flex:1,padding:"9px"}}>Salva</button>
                    {costoEsclusivo!=null && <button onClick={()=>{setCostoEsclusivo(null);setNoteCosto("");}} style={{...S.btnS,fontSize:11}}>Rimuovi esclusivo</button>}
                  </div>
                </div>
              )}
            </div>
          )}

          {sottoMargine && (
            <div style={{fontSize:12,color:"#8a6418",background:"rgba(217,164,65,0.14)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>
              ⚠ Margine sotto la soglia minima ({MARGINE_MINIMO_PERC}%). {puoModificare ? "Come responsabile/admin puoi comunque procedere." : "Il preventivo verrà segnato come in attesa di approvazione."}
            </div>
          )}

          {/* Riepilogo riga */}
          <div style={{display:"flex",justifyContent:"space-between",padding:"14px 0",borderTop:`1px solid ${C.paperLine}`,marginTop:6,marginBottom:18}}>
            <span style={{fontWeight:600,fontSize:13}}>Totale riga (×{qty})</span>
            <span className="tnum" style={{fontWeight:700,fontSize:18,fontFamily:F_MONO,color:C.ink}}>€{totaleRiga.toFixed(2)}</span>
          </div>

          <button onClick={conferma} style={{...S.btnAccent,width:"100%",padding:"13px"}}>
            {giaPresente ? "Aggiorna nel preventivo" : "+ Aggiungi al preventivo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Preventivi({cart,setCart,preventivi,setPreventivi,setOrdini,setArea,ruolo,catalog,sessione}){
  const [view,setView]=useState("lista"); // lista | nuovo | dettaglio
  const [selId,setSelId]=useState(null);
  const [confermaEliminazione,setConfermaEliminazione]=useState(false);
  const [confermaSalto,setConfermaSalto]=useState(false);
  const [tipoMotivoSalto,setTipoMotivoSalto]=useState(""); // prezzo_alto | concorrente | rimandata | altro
  const [dettaglioMotivoSalto,setDettaglioMotivoSalto]=useState(""); // nome concorrente, o testo libero per "altro"
  const [promemoriaRecupero,setPromemoriaRecupero]=useState("");
  const [bozza,setBozza]=useState(null); // scadenza/referente/pagamento in modifica locale, salvati solo al click su "Salva"
  const [bozzaSalvata,setBozzaSalvata]=useState(false); // conferma temporanea dopo il salvataggio
  const [mostraFirma,setMostraFirma]=useState(false);
  const [nomeFirmatario,setNomeFirmatario]=useState("");
  const [clienteLibero,setClienteLibero]=useState(false); // true = form nome libero al posto della ricerca in anagrafica
  const [nomeClienteLibero,setNomeClienteLibero]=useState("");
  useEffect(()=>{ setConfermaEliminazione(false); setConfermaSalto(false); setTipoMotivoSalto(""); setDettaglioMotivoSalto(""); setPromemoriaRecupero(""); setBozzaSalvata(false); setMostraFirma(false); setNomeFirmatario(""); setClienteLibero(false); setNomeClienteLibero(""); },[selId]);
  const [erroreSync,setErroreSync]=useState("");
  const [utentiTelos,setUtentiTelos]=useState(null); // null=non caricato, [] o [...]
  const [erroreUtentiTelos,setErroreUtentiTelos]=useState("");
  const total=cart.reduce((s,p)=>s+p.netto,0);
  const accessToken = trovaAccessToken(sessione);

  // Elenco utenti solo per chi può effettivamente scegliere il referente
  // (stesso permesso già usato per l'approvazione margini/prezzi)
  useEffect(()=>{
    if(!puoModificarePrezzoLiberamente(ruolo) || utentiTelos!==null) return;
    chiamaUtentiInfo(accessToken)
      .then(d=>setUtentiTelos(d?.utenti ?? []))
      .catch(err=>{ setUtentiTelos([]); setErroreUtentiTelos(err.message); });
  },[ruolo]);

  function totaleRighe(righe){
    return righe.reduce((s,r)=>s+r.netto*(r.qty||1),0);
  }
  // Se almeno una riga è sotto soglia di margine e il preventivo non è ancora
  // stato esplicitamente approvato, lo stato visibile diventa "In attesa di approvazione"
  function statoConApprovazione(p){
    if(["Convertito in ordine","Saltato"].includes(p.stato)) return p.stato;
    const haRigaSottoMargine = (p.righe||[]).some(r=>r.sottoMargine);
    if(haRigaSottoMargine && !p.approvato) return "In attesa di approvazione";
    return p.stato;
  }

  const [bozzaNonSalvata,setBozzaNonSalvata]=useState(null); // preventivo nuovo non ancora persistito (id="__nuovo__")
  function trovaPreventivo(id){
    return id==="__nuovo__" ? bozzaNonSalvata : preventivi.find(p=>p.id===id);
  }
  function nuovoOggettoLocale(righeIniziali){
    const oggi = new Date().toISOString().slice(0,10);
    return {
      id:"__nuovo__",
      cliente:"", stato:"Bozza", approvato:false, righe:righeIniziali, val: totaleRighe(righeIniziali),
      scadenza: aggiungiGiorniLavorativi(oggi, 20),
      pagamento_modalita: "USUALE CODIFICATA",
      pagamento_dettagli: "",
      referente_telos: sessione?.nome || "",
      creato_da_nome: sessione?.nome || "",
      note: "",
    };
  }
  // Salva davvero su Supabase una bozza locale che ha appena raggiunto i
  // requisiti minimi (cliente + almeno un articolo) — prima di allora il
  // preventivo esiste solo in memoria, per non riempire il database di righe
  // vuote ogni volta che qualcuno clicca "Nuovo preventivo" e poi ci ripensa.
  async function persistiBozza(datiLocali){
    setErroreSync("");
    const { id, ...payload } = datiLocali;
    try{
      const [salvato] = await sbAuth("POST","preventivi","",payload,accessToken);
      setPreventivi(prev=>[salvato,...prev]);
      setBozzaNonSalvata(null);
      setSelId(salvato.id);
    }catch(err){
      setErroreSync("Creazione non riuscita: "+err.message);
      setBozzaNonSalvata(datiLocali); // resta locale, l'utente può ritentare modificando qualcosa
    }
  }
  function creaDaCart(){
    if(cart.length===0) return;
    const righe = cart.map(p=>({cod:p.cod, mar:p.mar, nome:p.nome||p.desc, netto:p.netto, listino:p.listino, qty:1, sottoMargine:false}));
    setBozzaNonSalvata(nuovoOggettoLocale(righe));
    setCart([]);
    setSelId("__nuovo__");
    setView("dettagli-edit");
  }
  function creaVuoto(){
    setBozzaNonSalvata(nuovoOggettoLocale([]));
    setSelId("__nuovo__");
    setView("dettagli-edit");
  }

  const selezionato = trovaPreventivo(selId);

  // La bozza locale si inizializza solo quando si apre un preventivo diverso
  // (dipende da selId, non da selezionato) — altrimenti un aggiornamento dal
  // server nel frattempo (es. nota automatica da un articolo appena aggiunto)
  // cancellerebbe le modifiche non ancora salvate dall'utente.
  useEffect(()=>{
    if(!selezionato) return;
    setBozza({
      scadenza: selezionato.scadenza||"",
      referente_telos: selezionato.referente_telos||"",
      pagamento_modalita: selezionato.pagamento_modalita||"USUALE CODIFICATA",
      pagamento_dettagli: selezionato.pagamento_dettagli||"",
    });
  },[selId]);

  function salvaBozza(){
    if(!bozza || !selezionato) return;
    aggiorna(selezionato.id, { ...bozza });
    setBozzaSalvata(true);
    setTimeout(()=>setBozzaSalvata(false), 2500);
  }

  // Aggiornamento ottimistico (l'interfaccia reagisce subito) + salvataggio
  // reale su Supabase in background. Se il salvataggio fallisce, l'interfaccia
  // resta con la modifica locale ma compare un avviso — non annulliamo per
  // non far perdere all'utente quanto appena scritto.
  async function aggiorna(id, patch){
    // Bozza non ancora salvata: resta tutto in memoria finché non ha almeno
    // un cliente e un articolo — a quel punto si salva da sola su Supabase.
    if(id==="__nuovo__"){
      if(!bozzaNonSalvata) return;
      const righe = patch.righe || bozzaNonSalvata.righe;
      const aggiornato = { ...bozzaNonSalvata, ...patch, val: totaleRighe(righe) };
      if(aggiornato.cliente && aggiornato.righe.length>0){
        persistiBozza(aggiornato);
      } else {
        setBozzaNonSalvata(aggiornato);
      }
      return;
    }
    const corrente = preventivi.find(p=>p.id===id);
    if(!corrente) return;
    const righe = patch.righe || corrente.righe;
    const patchCompleto = { ...patch, val: totaleRighe(righe) };
    // Se il totale cambia (articoli aggiunti/rimossi/modificati) e c'è già
    // un finanziamento/noleggio scelto, ricalcola la rata sul nuovo importo
    // invece di lasciarla ferma al valore vecchio — a meno che questa stessa
    // chiamata non stia già impostando esplicitamente i campi finanziamento
    // (es. quando l'utente cambia tipo/durata a mano).
    const tipoFinanziamento = patch.finanziamento_tipo!==undefined ? patch.finanziamento_tipo : corrente.finanziamento_tipo;
    if(patch.righe && tipoFinanziamento && patch.finanziamento_rata===undefined){
      const mesi = corrente.finanziamento_mesi || 36;
      const calcolo = calcolaFinanziamento(tipoFinanziamento, patchCompleto.val, mesi);
      patchCompleto.finanziamento_rata = calcolo ? calcolo.rata : null;
      patchCompleto.finanziamento_spese_contratto = calcolo ? calcolo.speseContratto : null;
      patchCompleto.finanziamento_riscatto = calcolo ? calcolo.riscatto : null;
    }
    setPreventivi(prev=>prev.map(p=>p.id===id ? {...p, ...patchCompleto} : p));
    try{
      await sbAuth("PATCH","preventivi",`id=eq.${id}`,patchCompleto,accessToken);
      setErroreSync("");
    }catch(err){
      setErroreSync("Modifica non salvata sul server: "+err.message);
    }
  }
  function eliminaRiga(id, cod){
    const p = trovaPreventivo(id);
    if(!p) return;
    aggiorna(id, { righe: p.righe.filter(r=>r.cod!==cod) });
  }
  // Modifica quantità o prezzo netto di una riga già presente, senza doverla
  // rimuovere e ricercare il prodotto da capo. Ricalcola anche il margine
  // (una modifica al netto potrebbe far scendere o rientrare dalla soglia
  // minima), e resta comunque soggetta ad approvazione se serve.
  function modificaRiga(id, cod, campo, valore){
    const p = trovaPreventivo(id);
    if(!p) return;
    const righe = p.righe.map(r=>{
      if(r.cod!==cod) return r;
      const aggiornata = { ...r, [campo]: valore };
      aggiornata.sottoMargine = rigaSottoMargine(aggiornata);
      return aggiornata;
    });
    aggiorna(id, { righe, approvato:false });
  }
  // Aggiunge un articolo, oppure ne aggiorna qty/netto se è già presente
  // (così riaprire la scheda di un prodotto già in preventivo permette di
  // correggere la quantità senza creare una riga duplicata). Se il prodotto
  // ha una nota associata (campo "note" in anagrafica, es. "richiede
  // installazione trifase"), la aggiunge al campo Note del preventivo — una
  // volta sola per nota, e resta comunque modificabile/rimovibile a mano
  // come qualsiasi altro testo in quel campo.
  function aggiungiRiga(id, riga){
    const p = trovaPreventivo(id);
    if(!p) return;
    const esiste = p.righe.some(r=>r.cod===riga.cod);
    const righe = esiste ? p.righe.map(r=>r.cod===riga.cod ? riga : r) : [...p.righe, riga];
    const patch = { righe, approvato:false };
    const notaProdotto = (riga.notaProdotto||"").trim();
    if(!esiste && notaProdotto && !(p.note||"").includes(notaProdotto)){
      patch.note = p.note ? `${p.note}\n${notaProdotto}` : notaProdotto;
    }
    aggiorna(id, patch);
  }
  async function convertiInOrdine(p){
    if(!p.firma_cliente) return; // rete di sicurezza, il pulsante è già disabilitato senza firma
    setErroreSync("");
    const nuovo = {
      preventivo_id: p.id,
      preventivo_progressivo: p.progressivo,
      cliente: p.cliente,
      cliente_codice: p.cliente_codice || null,
      righe: p.righe,
      val: p.val,
      stato: "Inserito",
      creato_da_nome: sessione?.nome || null,
      firma_cliente: p.firma_cliente,
      firma_data: p.firma_data,
      firma_nome: p.firma_nome,
    };
    try{
      const [salvato] = await sbAuth("POST","ordini","",nuovo,accessToken);
      setOrdini(prev=>[salvato,...prev]);
      aggiorna(p.id, {stato:"Convertito in ordine"});
      setArea("ordini");
    }catch(err){
      setErroreSync("Conversione in ordine non riuscita: "+err.message);
    }
  }
  // Chiude un preventivo per trattativa saltata, con motivazione strutturata.
  // "motivo_saltato" resta come testo riassuntivo leggibile ovunque (PDF,
  // vista admin), mentre i campi strutturati permettono di raggruppare/
  // confrontare i casi (es. tutte le "scelta concorrente" con un nome preciso).
  function motivoValido(){
    if(!tipoMotivoSalto) return false;
    if(tipoMotivoSalto==="concorrente") return dettaglioMotivoSalto.trim().length>0;
    if(tipoMotivoSalto==="rimandata") return !!promemoriaRecupero;
    if(tipoMotivoSalto==="altro") return dettaglioMotivoSalto.trim().length>0;
    return true; // prezzo_alto non richiede dettagli aggiuntivi
  }
  function segnaSaltato(id){
    if(!motivoValido()) return;
    let motivoTesto = MOTIVI_SALTO[tipoMotivoSalto];
    if(tipoMotivoSalto==="concorrente") motivoTesto += `: ${dettaglioMotivoSalto.trim()}`;
    if(tipoMotivoSalto==="altro") motivoTesto = dettaglioMotivoSalto.trim();
    if(tipoMotivoSalto==="rimandata") motivoTesto += ` — promemoria per il ${new Date(promemoriaRecupero).toLocaleDateString("it-IT")}`;
    aggiorna(id, {
      stato:"Saltato",
      motivo_saltato: motivoTesto,
      motivo_saltato_tipo: tipoMotivoSalto,
      motivo_saltato_dettaglio: dettaglioMotivoSalto.trim() || null,
      promemoria_recupero: tipoMotivoSalto==="rimandata" ? promemoriaRecupero : null,
    });
    setConfermaSalto(false);
    setTipoMotivoSalto(""); setDettaglioMotivoSalto(""); setPromemoriaRecupero("");
  }
  // Elimina un preventivo intero (non una singola riga). Bloccato per quelli
  // già trasformati in ordine: cancellarli lascerebbe l'ordine collegato
  // orfano di riferimento. La conferma avviene nell'interfaccia (due passaggi
  // espliciti), non con il popup del browser — troppo facile da cliccare via
  // senza leggere. Aggiornamento ottimistico con rollback se la cancellazione
  // sul server fallisce, per non far credere all'utente che sia sparito
  // quando in realtà è ancora lì.
  async function eliminaPreventivo(id){
    setConfermaEliminazione(false);
    if(id==="__nuovo__"){
      // mai salvata su Supabase: basta scartare la bozza locale, chiunque può farlo
      setBozzaNonSalvata(null);
      setSelId(null);
      setView("lista");
      return;
    }
    const p = preventivi.find(x=>x.id===id);
    if(!p || p.stato==="Convertito in ordine") return;
    if(p.stato!=="Bozza" && !RUOLI_APPROVATORI.includes(ruolo)) return; // da "Inviato" in poi solo responsabile/admin — bloccato anche a livello di RLS
    setErroreSync("");
    setPreventivi(prev=>prev.filter(x=>x.id!==id));
    setSelId(null);
    setView("lista");
    try{
      await sbAuth("DELETE","preventivi",`id=eq.${id}`,null,accessToken);
    }catch(err){
      setPreventivi(prev=>[p,...prev]); // rollback: torna visibile in lista
      setErroreSync("Eliminazione non riuscita: "+err.message);
    }
  }

  // ── VISTA: NUOVO PREVENTIVO DA CART (riepilogo prima di salvare) ──
  if(view==="lista" && cart.length>0){
    return (
      <div>
        {erroreSync && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>⚠ {erroreSync}</div>}
        <div style={{background:C.ink,borderRadius:10,padding:"16px 16px",marginBottom:16}}>
          <div style={{...S.eyebrow,color:C.steel}}>Selezionati dal catalogo</div>
          {cart.map(p=>(
            <div key={p.cod} style={{display:"flex",justifyContent:"space-between",fontSize:12.5,padding:"5px 0",color:"#fff"}}>
              <span style={{opacity:0.85}}>{p.mar} {p.nome}</span>
              <span className="tnum" style={{fontWeight:600,fontFamily:F_MONO}}>€{p.netto.toFixed(2)}</span>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",marginTop:10,paddingTop:10,borderTop:`1px solid ${C.surfaceRaised}`}}>
            <span style={{color:"#fff",fontWeight:600,fontSize:13}}>Totale</span>
            <span className="tnum" style={{color:C.cyan,fontWeight:700,fontSize:18,fontFamily:F_MONO}}>€{total.toFixed(2)}</span>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <button onClick={creaDaCart} style={{...S.btnAccent,flex:1,padding:"12px"}}>Crea preventivo da questi articoli</button>
            <button onClick={()=>setCart([])} style={S.btnS}>Svuota</button>
          </div>
        </div>
        <ListaPreventivi preventivi={preventivi} onApri={(id)=>{setSelId(id);setView("dettaglio");}} onNuovo={creaVuoto} sessione={sessione}/>
      </div>
    );
  }

  // ── VISTA: LISTA ──
  if(view==="lista"){
    return (<>
      {erroreSync && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>⚠ {erroreSync}</div>}
      <ListaPreventivi preventivi={preventivi} onApri={(id)=>{setSelId(id);setView("dettaglio");}} onNuovo={creaVuoto} sessione={sessione}/>
    </>);
  }

  // ── VISTA: DETTAGLIO (sola lettura con azioni di stato) o EDIT (bozza modificabile) ──
  if((view==="dettaglio"||view==="dettagli-edit") && selezionato){
    // Modificabile finché non è stato trasformato in un ordine vero o chiuso
    // per trattativa saltata — in entrambi i casi il preventivo resta
    // storico/di sola lettura.
    const editable = !["Convertito in ordine","Saltato"].includes(selezionato.stato);
    const statoVisibile = statoConApprovazione(selezionato);
    const inAttesaApprovazione = statoVisibile==="In attesa di approvazione";
    const puoApprovare = inAttesaApprovazione && puoModificarePrezzoLiberamente(ruolo);

    return (
      <div>
        <button onClick={()=>{ if(selezionato?.id==="__nuovo__") setBozzaNonSalvata(null); setView("lista"); }} style={{...S.btnS,marginBottom:14}}>← Tutti i preventivi</button>

        {selezionato.id==="__nuovo__" && (
          <div style={{fontSize:12,color:"#8a6418",background:"rgba(217,164,65,0.14)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>
            ⓘ Non ancora salvato — seleziona un cliente e aggiungi almeno un articolo per salvarlo automaticamente.
          </div>
        )}

        {erroreSync && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>⚠ {erroreSync}</div>}

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <div className="tnum" style={{fontFamily:F_MONO,fontSize:12,color:"#9AA3AB"}}>{codicePreventivo(selezionato)}</div>
          <Tag tone={inAttesaApprovazione?"warn":(STATO_COLORE[selezionato.stato]||"steel")}>{statoVisibile}</Tag>
        </div>

        {editable ? (
          <div style={{marginBottom:14}}>
            {clienteLibero ? (
              <div style={{...S.card,cursor:"default",border:`1px solid ${C.ink}`}}>
                <div style={S.eyebrow}>Cliente non in anagrafica</div>
                <input
                  value={nomeClienteLibero}
                  onChange={e=>setNomeClienteLibero(e.target.value)}
                  placeholder="Ragione sociale / nome cliente"
                  style={{...S.inp,marginTop:8,marginBottom:10}}
                  autoFocus
                />
                <div style={{display:"flex",gap:8}}>
                  <button
                    onClick={()=>{
                      aggiorna(selezionato.id, {
                        cliente: nomeClienteLibero.trim(),
                        cliente_codice: null, cliente_localita: "", cliente_provincia: "", cliente_piva: "",
                      });
                      setClienteLibero(false);
                    }}
                    disabled={!nomeClienteLibero.trim()}
                    style={{...S.btnAccent,padding:"9px 15px",opacity:nomeClienteLibero.trim()?1:0.4}}
                  >
                    Usa questo nome
                  </button>
                  <button onClick={()=>{ setClienteLibero(false); setNomeClienteLibero(""); }} style={{...S.btnS,padding:"9px 15px"}}>Annulla</button>
                </div>
                <div style={{fontSize:11,color:"#9AA3AB",marginTop:10,lineHeight:1.5}}>
                  Non essendo in anagrafica, questo preventivo non comparirà nella scheda di nessun cliente —
                  se in seguito lo aggiungi ai Clienti, torna qui e usa la ricerca per collegarlo.
                </div>
              </div>
            ) : (<>
              {!selezionato.cliente_codice && selezionato.cliente && (
                <div style={{fontSize:12,color:C.steel,marginBottom:8}}>
                  Cliente attuale (non in anagrafica): <strong>{selezionato.cliente}</strong>
                </div>
              )}
              <SelezioneCliente
                clienteSelezionato={selezionato.cliente_codice ? {
                  codice: selezionato.cliente_codice,
                  ragione_sociale: selezionato.cliente,
                  localita: selezionato.cliente_localita,
                  provincia: selezionato.cliente_provincia,
                  partita_iva: selezionato.cliente_piva,
                } : null}
                onSeleziona={(c)=>aggiorna(selezionato.id, c ? {
                  cliente: c.ragione_sociale,
                  cliente_codice: c.codice,
                  cliente_localita: c.localita || "",
                  cliente_provincia: c.provincia || "",
                  cliente_piva: c.partita_iva || "",
                } : {
                  cliente:"", cliente_codice:null, cliente_localita:"", cliente_provincia:"", cliente_piva:"",
                })}
                sessione={sessione}
              />
              {!selezionato.cliente_codice && (
                <button onClick={()=>{ setClienteLibero(true); setNomeClienteLibero(selezionato.cliente||""); }} style={{...S.btnS,marginTop:8,padding:"7px 12px",fontSize:12}}>
                  {selezionato.cliente ? "✎ Modifica nome cliente" : "+ Cliente non in anagrafica"}
                </button>
              )}
            </>)}
          </div>
        ) : (
          <div style={{fontFamily:F_DISPLAY,fontSize:19,fontWeight:600,marginBottom:14}}>{selezionato.cliente || "Cliente non specificato"}</div>
        )}

        {inAttesaApprovazione && (
          <div style={{fontSize:12,color:"#8a6418",background:"rgba(217,164,65,0.14)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>
            ⚠ Uno o più articoli hanno un margine sotto la soglia minima ({MARGINE_MINIMO_PERC}%). {puoApprovare ? "Puoi approvarlo qui sotto." : "In attesa di approvazione da un responsabile o admin."}
          </div>
        )}

        {/* Dettagli preventivo: scadenza, pagamento, referente, note */}
        <div style={{...S.card,cursor:"default",marginBottom:16}}>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:editable?12:0}}>
            <div style={{flex:"1 1 160px"}}>
              <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Scadenza preventivo</div>
              {editable && bozza ? (
                <input type="date" value={bozza.scadenza} onChange={e=>setBozza(b=>({...b,scadenza:e.target.value}))} style={S.inp}/>
              ) : (
                <div style={{fontSize:13,fontWeight:600}}>{selezionato.scadenza ? new Date(selezionato.scadenza).toLocaleDateString("it-IT") : "—"}</div>
              )}
            </div>
            <div style={{flex:"1 1 200px"}}>
              <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Referente Telos</div>
              {editable && bozza && puoModificarePrezzoLiberamente(ruolo) ? (
                <>
                  <select value={bozza.referente_telos} onChange={e=>setBozza(b=>({...b,referente_telos:e.target.value}))} style={S.inp}>
                    {bozza.referente_telos && !(utentiTelos||[]).some(u=>u.nome===bozza.referente_telos) && (
                      <option value={bozza.referente_telos}>{bozza.referente_telos}</option>
                    )}
                    {(utentiTelos||[]).map(u=>{
                      const nomeCompleto = [u.nome, u.cognome].filter(Boolean).join(" ");
                      return <option key={u.id} value={nomeCompleto}>{nomeCompleto}</option>;
                    })}
                  </select>
                  {erroreUtentiTelos && (
                    <div style={{fontSize:11,color:C.danger,marginTop:4}}>⚠ Elenco utenti non caricato: {erroreUtentiTelos}</div>
                  )}
                  {!erroreUtentiTelos && utentiTelos && utentiTelos.length===0 && (
                    <div style={{fontSize:11,color:"#9AA3AB",marginTop:4}}>Nessun altro utente trovato.</div>
                  )}
                </>
              ) : (
                <div style={{fontSize:13,fontWeight:600}}>{selezionato.referente_telos || "—"}</div>
              )}
            </div>
          </div>

          {editable && bozza ? (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Modalità di pagamento</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <select value={bozza.pagamento_modalita} onChange={e=>setBozza(b=>({...b,pagamento_modalita:e.target.value}))} style={{...S.inp,flex:"1 1 180px"}}>
                  {["USUALE CODIFICATA","RI.BA.","RIMESSA DIRETTA","RID","DA CONCORDARE"].map(o=>(<option key={o} value={o}>{o}</option>))}
                </select>
                <input value={bozza.pagamento_dettagli} onChange={e=>setBozza(b=>({...b,pagamento_dettagli:e.target.value}))} placeholder="Dettagli (es. 60gg fine mese, al 15 del mese…)" style={{...S.inp,flex:"2 1 240px"}}/>
              </div>
            </div>
          ) : (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Modalità di pagamento</div>
              <div style={{fontSize:13,fontWeight:600}}>{selezionato.pagamento_modalita}{selezionato.pagamento_dettagli?` — ${selezionato.pagamento_dettagli}`:""}</div>
            </div>
          )}

          <div>
            <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>Note</div>
            {editable ? (
              <textarea value={selezionato.note||""} onChange={e=>aggiorna(selezionato.id,{note:e.target.value})} rows={3} placeholder="Note per il cliente — alcune vengono aggiunte automaticamente in base agli articoli inseriti, ma restano modificabili" style={{...S.inp,resize:"vertical",fontFamily:F_BODY}}/>
            ) : (
              <div style={{fontSize:13,whiteSpace:"pre-line"}}>{selezionato.note || "—"}</div>
            )}
          </div>

          <label style={{display:"flex",alignItems:"center",gap:8,marginTop:14,cursor:editable?"pointer":"default",fontSize:13}}>
            <input
              type="checkbox"
              checked={selezionato.includi_copertina!==false}
              disabled={!editable}
              onChange={e=>aggiorna(selezionato.id,{includi_copertina:e.target.checked})}
              style={{width:16,height:16,accentColor:C.ink}}
            />
            Includi la pagina di copertina nel PDF
          </label>
        </div>

        {/* Aggiungi articoli — resa ben visibile: è l'azione più frequente
            mentre si compila un preventivo */}
        {editable && (
          <div style={{...S.card,cursor:"default",marginBottom:16,background:"#fff",border:`2px solid ${C.cyan}`}}>
            <div style={{fontSize:14.5,fontWeight:700,color:C.ink,marginBottom:10}}>+ Aggiungi articoli al preventivo</div>
            <RicercaProdottiInline onSeleziona={(riga)=>aggiungiRiga(selezionato.id, riga)} righeEsistenti={selezionato.righe} ruolo={ruolo} catalog={catalog} sessione={sessione}/>
          </div>
        )}

        <div style={S.eyebrow}>Articoli ({selezionato.righe.length})</div>
        {selezionato.righe.length===0 && (
          <div style={{fontSize:12.5,color:"#9AA3AB",padding:"10px 0"}}>Nessun articolo — usa la ricerca qui sopra per aggiungerne.</div>
        )}
        {selezionato.righe.map(r=>(
          <div key={r.cod} style={{...S.card,cursor:"default",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,...(r.sottoMargine?{borderColor:C.warn,background:"rgba(217,164,65,0.05)"}:{})}}>
            <div style={{minWidth:0}}>
              <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                <Tag tone="steel">{r.mar}</Tag>
                {r.sottoMargine && <Tag tone="warn">margine basso</Tag>}
              </div>
              <div style={{fontWeight:600,fontSize:13,marginTop:4}}>{r.nome}</div>
              {editable ? (
                <div style={{display:"flex",alignItems:"center",gap:5,marginTop:6}}>
                  <input
                    type="number" min="1" step="1" value={r.qty||1}
                    onChange={e=>modificaRiga(selezionato.id, r.cod, "qty", Math.max(1, parseInt(e.target.value,10)||1))}
                    onClick={e=>e.stopPropagation()}
                    style={{width:46,padding:"5px 6px",fontSize:12,fontFamily:F_MONO,border:`1px solid ${C.paperLine}`,borderRadius:5,textAlign:"center"}}
                  />
                  <span style={{fontSize:11,color:"#9AA3AB"}}>×  €</span>
                  <input
                    type="number" min="0" step="0.01" value={r.netto}
                    onChange={e=>modificaRiga(selezionato.id, r.cod, "netto", Math.max(0, parseFloat(e.target.value)||0))}
                    onClick={e=>e.stopPropagation()}
                    style={{width:84,padding:"5px 6px",fontSize:12,fontFamily:F_MONO,border:`1px solid ${C.paperLine}`,borderRadius:5,textAlign:"right"}}
                  />
                  <span style={{fontSize:10.5,color:"#9AA3AB"}}>cad.</span>
                </div>
              ) : (
                <div className="tnum" style={{fontSize:11,color:"#9AA3AB",marginTop:2}}>€{r.netto.toFixed(2)} × {r.qty||1}</div>
              )}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              <span className="tnum" style={{fontWeight:700,fontFamily:F_MONO,fontSize:14}}>€{(r.netto*(r.qty||1)).toFixed(2)}</span>
              {editable && <button onClick={()=>eliminaRiga(selezionato.id,r.cod)} style={{background:"none",border:"none",fontSize:16,color:"#9AA3AB",cursor:"pointer"}}>✕</button>}
            </div>
          </div>
        ))}

        <div style={{display:"flex",justifyContent:"space-between",padding:"14px 0",borderTop:`1px solid ${C.paperLine}`,marginTop:8}}>
          <span style={{fontWeight:600,fontSize:14}}>Totale</span>
          <span className="tnum" style={{fontWeight:700,fontSize:18,fontFamily:F_MONO,color:C.ink}}>€{selezionato.val.toFixed(2)}</span>
        </div>

        {/* Finanziamento / Noleggio — rata calcolata automaticamente in base
            al totale del preventivo e alla durata scelta */}
        <div style={{...S.card,cursor:"default",marginBottom:16}}>
          <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Finanziamento / Noleggio</div>
          {editable ? (
            <>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                {[["","Nessuno"],["finanziamento","Finanziamento"],["noleggio","Noleggio"]].map(([v,lbl])=>{
                  const on = (selezionato.finanziamento_tipo||"")===v;
                  return (
                    <button key={v||"nessuno"} onClick={()=>{
                      if(!v){ aggiorna(selezionato.id,{finanziamento_tipo:null,finanziamento_mesi:null,finanziamento_rata:null,finanziamento_spese_contratto:null,finanziamento_riscatto:null}); return; }
                      const mesi = selezionato.finanziamento_mesi || 36;
                      const calcolo = calcolaFinanziamento(v, selezionato.val, mesi);
                      aggiorna(selezionato.id, calcolo ? {
                        finanziamento_tipo:v, finanziamento_mesi:mesi,
                        finanziamento_rata:calcolo.rata, finanziamento_spese_contratto:calcolo.speseContratto,
                        finanziamento_riscatto:calcolo.riscatto,
                      } : { finanziamento_tipo:v, finanziamento_mesi:mesi, finanziamento_rata:null, finanziamento_spese_contratto:null, finanziamento_riscatto:null });
                    }} style={{
                      border:`1px solid ${on?C.ink:C.paperLine}`, borderRadius:7, padding:"8px 14px",
                      fontSize:12.5, cursor:"pointer", fontWeight:on?600:400,
                      background:on?C.ink:"#fff", color:on?"#fff":"#5B6770",
                    }}>{lbl}</button>
                  );
                })}
              </div>

              {selezionato.finanziamento_tipo && (
                <>
                  <select value={selezionato.finanziamento_mesi||36} onChange={e=>{
                    const mesi = parseInt(e.target.value,10);
                    const calcolo = calcolaFinanziamento(selezionato.finanziamento_tipo, selezionato.val, mesi);
                    aggiorna(selezionato.id, calcolo ? {
                      finanziamento_mesi:mesi, finanziamento_rata:calcolo.rata,
                      finanziamento_spese_contratto:calcolo.speseContratto, finanziamento_riscatto:calcolo.riscatto,
                    } : { finanziamento_mesi:mesi, finanziamento_rata:null, finanziamento_spese_contratto:null, finanziamento_riscatto:null });
                  }} style={{...S.inp,marginBottom:10}}>
                    {DURATE_MESI.map(m=>(<option key={m} value={m}>{m} mesi</option>))}
                  </select>

                  {selezionato.finanziamento_rata ? (
                    <div style={{fontSize:12.5,color:C.steel,lineHeight:1.8}}>
                      <div><strong style={{color:C.ink,fontFamily:F_MONO}}>€{selezionato.finanziamento_rata.toFixed(2)}</strong> al mese × {selezionato.finanziamento_mesi} rate</div>
                      {selezionato.finanziamento_spese_contratto!=null && <div>Spese di istruttoria: €{selezionato.finanziamento_spese_contratto.toFixed(2)}</div>}
                      {selezionato.finanziamento_tipo==="noleggio" && selezionato.finanziamento_riscatto!=null && <div>Riscatto finale (1% imponibile): €{selezionato.finanziamento_riscatto.toFixed(2)}</div>}
                    </div>
                  ) : (
                    <div style={{fontSize:12,color:C.warn}}>⚠ Importo fuori tabella per questo prodotto — verifica manualmente con l'ufficio finanziamenti.</div>
                  )}
                </>
              )}
            </>
          ) : selezionato.finanziamento_tipo ? (
            <div style={{fontSize:13,fontWeight:600}}>
              {selezionato.finanziamento_tipo==="noleggio"?"Noleggio":"Finanziamento"}: €{(selezionato.finanziamento_rata||0).toFixed(2)} × {selezionato.finanziamento_mesi} mesi
            </div>
          ) : (
            <div style={{fontSize:12.5,color:"#9AA3AB"}}>Nessuno</div>
          )}
        </div>

        {/* Azioni di stato */}
        <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:6}}>
          {editable && (
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <button onClick={salvaBozza} disabled={!bozza} style={{...S.btnAccent,flex:1,padding:"12px",fontWeight:700,opacity:bozza?1:0.4,cursor:bozza?"pointer":"default"}}>
                💾 Salva
              </button>
              {bozzaSalvata && <span style={{fontSize:12.5,color:C.ok,fontWeight:600,flexShrink:0}}>✓ Salvato</span>}
            </div>
          )}
          {puoApprovare && (
            <button onClick={()=>aggiorna(selezionato.id,{approvato:true})} style={{...S.btnAccent,padding:"12px",background:C.ok,color:"#fff"}}>
              ✓ Approva sconto e procedi
            </button>
          )}
          {selezionato.stato==="Bozza" && !inAttesaApprovazione && (
            <button onClick={()=>aggiorna(selezionato.id,{stato:"Inviato"})} disabled={!selezionato.cliente||selezionato.righe.length===0} style={{...S.btnAccent,padding:"12px",opacity:(!selezionato.cliente||selezionato.righe.length===0)?0.4:1}}>
              Segna come inviato al cliente
            </button>
          )}
          {selezionato.stato==="Bozza" && inAttesaApprovazione && !puoApprovare && (
            <button disabled style={{...S.btnAccent,padding:"12px",opacity:0.4}}>In attesa di approvazione</button>
          )}
          <button onClick={()=>{
            const righeArricchite = selezionato.righe.map(r=>{
              const prodottoCatalogo = (catalog||[]).find(p=>p.cod===r.cod);
              return { ...r, img: prodottoCatalogo?.img, desc: prodottoCatalogo?.desc, desc_prev: prodottoCatalogo?.desc_prev };
            });
            generaPreventivoPDF(righeArricchite, selezionato.val, {
              codice: codicePreventivo(selezionato),
              cliente: selezionato.cliente,
              scadenza: selezionato.scadenza,
              pagamento_modalita: selezionato.pagamento_modalita,
              pagamento_dettagli: selezionato.pagamento_dettagli,
              referente_telos: selezionato.referente_telos,
              note: selezionato.note,
              finanziamento_tipo: selezionato.finanziamento_tipo,
              finanziamento_mesi: selezionato.finanziamento_mesi,
              finanziamento_rata: selezionato.finanziamento_rata,
              finanziamento_spese_contratto: selezionato.finanziamento_spese_contratto,
              finanziamento_riscatto: selezionato.finanziamento_riscatto,
              includi_copertina: selezionato.includi_copertina,
              firma_cliente: selezionato.firma_cliente,
              firma_data: selezionato.firma_data,
              firma_nome: selezionato.firma_nome,
            });
          }} style={{...S.btnAccent,padding:"14px",fontSize:14,fontWeight:700,background:C.cyan,color:C.inkDeep}}>
            📄 Genera preventivo PDF
          </button>
          {selezionato.stato==="Inviato" && (
            <div style={{...S.card,cursor:"default"}}>
              <div style={{fontSize:13.5,fontWeight:700,marginBottom:4}}>Firma del cliente</div>
              <div style={{fontSize:12,color:C.steel,marginBottom:12}}>
                Obbligatoria prima di convertire il preventivo in ordine — passa il dispositivo al cliente per l'accettazione.
              </div>

              {selezionato.firma_cliente && !mostraFirma && (
                <div style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{fontSize:12.5,fontWeight:600,color:C.ok}}>
                      ✓ Firmato da {selezionato.firma_nome}{selezionato.firma_data ? ` — ${new Date(selezionato.firma_data).toLocaleString("it-IT",{dateStyle:"short",timeStyle:"short"})}` : ""}
                    </span>
                    <button onClick={()=>setMostraFirma(true)} style={{background:"none",border:"none",color:C.steel,fontSize:11.5,cursor:"pointer",textDecoration:"underline"}}>Rifirma</button>
                  </div>
                  <img src={selezionato.firma_cliente} alt="Firma cliente" style={{maxWidth:220,border:`1px solid ${C.paperLine}`,borderRadius:6,background:"#fff",display:"block"}}/>
                </div>
              )}

              {(!selezionato.firma_cliente || mostraFirma) && (
                !mostraFirma ? (
                  <button onClick={()=>setMostraFirma(true)} style={{...S.btnAccent,width:"100%",padding:"12px",fontWeight:700}}>
                    ✍️ Raccogli firma cliente
                  </button>
                ) : (
                  <>
                    <input
                      value={nomeFirmatario}
                      onChange={e=>setNomeFirmatario(e.target.value)}
                      placeholder="Nome e cognome di chi firma"
                      style={{...S.inp,marginBottom:12}}
                      autoFocus
                    />
                    {nomeFirmatario.trim() ? (
                      <FirmaPad
                        onSalva={(dataUrl)=>{
                          aggiorna(selezionato.id, {
                            firma_cliente: dataUrl,
                            firma_data: new Date().toISOString(),
                            firma_nome: nomeFirmatario.trim(),
                          });
                          setMostraFirma(false);
                          setNomeFirmatario("");
                        }}
                        onAnnulla={selezionato.firma_cliente ? ()=>setMostraFirma(false) : undefined}
                      />
                    ) : (
                      <div style={{fontSize:11.5,color:"#9AA3AB"}}>Scrivi nome e cognome per abilitare l'area di firma.</div>
                    )}
                  </>
                )
              )}
            </div>
          )}
          {selezionato.stato==="Inviato" && (
            <button onClick={()=>convertiInOrdine(selezionato)} disabled={!selezionato.firma_cliente} style={{...S.btnAccent,padding:"13px",background:selezionato.firma_cliente?C.ink:"#c8c8c8",color:"#fff",fontSize:14,cursor:selezionato.firma_cliente?"pointer":"default"}}>
              ⬡ Converti in ordine{!selezionato.firma_cliente ? " (serve la firma)" : ""}
            </button>
          )}
          {selezionato.stato==="Convertito in ordine" && (
            <button onClick={()=>setArea("ordini")} style={{...S.btnP,padding:"12px"}}>Vedi l'ordine →</button>
          )}
          {selezionato.stato==="Saltato" && selezionato.motivo_saltato && (
            <div style={{fontSize:12.5,color:C.steel,background:"rgba(200,75,58,0.06)",border:`1px solid ${C.paperLine}`,borderRadius:8,padding:"11px 13px"}}>
              <div style={{fontWeight:600,color:C.danger,marginBottom:3}}>Trattativa saltata</div>
              {selezionato.motivo_saltato}
            </div>
          )}
        </div>

        {editable && (
          <div style={{marginTop:20}}>
            {!confermaSalto ? (
              <button onClick={()=>setConfermaSalto(true)} style={{width:"100%",padding:"12px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:9,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                ⊘ Chiudi per trattativa saltata
              </button>
            ) : (
              <div style={{background:C.paper,border:`1px solid ${C.paperLine}`,borderRadius:9,padding:16}}>
                <div style={{fontSize:13.5,fontWeight:700,marginBottom:10}}>Perché la trattativa è saltata?</div>

                <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:12}}>
                  {Object.entries(MOTIVI_SALTO).map(([v,lbl])=>{
                    const on = tipoMotivoSalto===v;
                    return (
                      <button key={v} onClick={()=>setTipoMotivoSalto(v)} style={{
                        display:"flex",alignItems:"center",gap:9,textAlign:"left",width:"100%",
                        border:`1px solid ${on?C.ink:C.paperLine}`, borderRadius:8, padding:"10px 12px",
                        fontSize:13, cursor:"pointer", fontWeight:on?600:400,
                        background:on?C.ink:"#fff", color:on?"#fff":"#3A4248",
                      }}>
                        <span style={{width:14,height:14,borderRadius:7,border:`1.5px solid ${on?"#fff":"#9AA3AB"}`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {on && <span style={{width:6,height:6,borderRadius:3,background:"#fff"}}/>}
                        </span>
                        {lbl}
                      </button>
                    );
                  })}
                </div>

                {tipoMotivoSalto==="concorrente" && (
                  <input
                    value={dettaglioMotivoSalto}
                    onChange={e=>setDettaglioMotivoSalto(e.target.value)}
                    placeholder="Nome del concorrente…"
                    style={{...S.inp,marginBottom:12}}
                    autoFocus
                  />
                )}
                {tipoMotivoSalto==="rimandata" && (
                  <div style={{marginBottom:12}}>
                    <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>
                      Promemoria per richiamare il cliente
                    </label>
                    <input type="date" value={promemoriaRecupero} onChange={e=>setPromemoriaRecupero(e.target.value)} style={S.inp}/>
                  </div>
                )}
                {tipoMotivoSalto==="altro" && (
                  <textarea
                    value={dettaglioMotivoSalto}
                    onChange={e=>setDettaglioMotivoSalto(e.target.value)}
                    rows={3}
                    placeholder="Descrivi il motivo…"
                    style={{...S.inp,resize:"vertical",fontFamily:F_BODY,marginBottom:12}}
                    autoFocus
                  />
                )}

                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>segnaSaltato(selezionato.id)} disabled={!motivoValido()} style={{flex:1,padding:"12px",background:motivoValido()?C.ink:"#c8c8c8",color:"#fff",border:"none",borderRadius:8,fontSize:13.5,fontWeight:700,cursor:motivoValido()?"pointer":"default"}}>
                    Conferma chiusura
                  </button>
                  <button onClick={()=>{setConfermaSalto(false); setTipoMotivoSalto(""); setDettaglioMotivoSalto(""); setPromemoriaRecupero("");}} style={{flex:1,padding:"12px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:8,fontSize:13.5,fontWeight:600,cursor:"pointer"}}>
                    Annulla
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {editable && (selezionato.stato==="Bozza" || RUOLI_APPROVATORI.includes(ruolo)) && (
          <div style={{marginTop:20,paddingTop:20,borderTop:`1px solid ${C.paperLine}`}}>
            {!confermaEliminazione ? (
              <button onClick={()=>setConfermaEliminazione(true)} style={{width:"100%",padding:"14px",background:C.danger,color:"#fff",border:"none",borderRadius:9,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                🗑 Elimina preventivo
              </button>
            ) : (
              <div style={{background:"rgba(200,75,58,0.08)",border:`1px solid ${C.danger}`,borderRadius:9,padding:16}}>
                <div style={{fontSize:13.5,fontWeight:700,color:C.danger,marginBottom:6}}>Confermi l'eliminazione definitiva?</div>
                <div style={{fontSize:12.5,color:C.steel,marginBottom:14}}>
                  Il preventivo {codicePreventivo(selezionato)}{selezionato.cliente?` (${selezionato.cliente})`:""} verrà cancellato per sempre. L'operazione non è reversibile.
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>eliminaPreventivo(selezionato.id)} style={{flex:1,padding:"12px",background:C.danger,color:"#fff",border:"none",borderRadius:8,fontSize:13.5,fontWeight:700,cursor:"pointer"}}>
                    Sì, elimina definitivamente
                  </button>
                  <button onClick={()=>setConfermaEliminazione(false)} style={{flex:1,padding:"12px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:8,fontSize:13.5,fontWeight:600,cursor:"pointer"}}>
                    Annulla
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── FIRMA CLIENTE ─────────────────────────────────────────────────────────
// Pad di firma su canvas: funziona sia a dito (tablet/smartphone, via
// Pointer Events che unificano touch/penna/mouse) sia con il mouse su PC.
// Esporta la firma come PNG in base64, salvato direttamente sul preventivo.
function FirmaPad({ onSalva, onAnnulla }){
  const canvasRef = useRef(null);
  const disegnando = useRef(false);
  const [vuoto,setVuoto] = useState(true);

  useEffect(()=>{
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#162758";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0,0,canvas.width,canvas.height);
  },[]);

  function posizione(e){
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return { x: (e.clientX-rect.left)*scaleX, y: (e.clientY-rect.top)*scaleY };
  }
  function iniziaTratto(e){
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    disegnando.current = true;
    const { x, y } = posizione(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x,y);
    setVuoto(false);
  }
  function disegna(e){
    if(!disegnando.current) return;
    e.preventDefault();
    const { x, y } = posizione(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x,y);
    ctx.stroke();
  }
  function fineTratto(){ disegnando.current = false; }

  function pulisci(){
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    setVuoto(true);
  }
  function conferma(){
    if(vuoto) return;
    onSalva(canvasRef.current.toDataURL("image/png"));
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={600} height={220}
        style={{width:"100%",maxWidth:600,height:180,border:`2px solid ${C.paperLine}`,borderRadius:10,touchAction:"none",background:"#fff",display:"block",cursor:"crosshair"}}
        onPointerDown={iniziaTratto}
        onPointerMove={disegna}
        onPointerUp={fineTratto}
        onPointerLeave={fineTratto}
        onPointerCancel={fineTratto}
      />
      <div style={{fontSize:11,color:"#9AA3AB",marginTop:6,textAlign:"center"}}>Firma qui sopra — con il dito su tablet/smartphone, o con il mouse</div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button onClick={pulisci} style={{flex:1,padding:"11px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancella</button>
        <button onClick={conferma} disabled={vuoto} style={{flex:2,padding:"11px",background:vuoto?"#c8c8c8":C.ink,color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:vuoto?"default":"pointer"}}>✓ Conferma firma</button>
      </div>
      {onAnnulla && <button onClick={onAnnulla} style={{width:"100%",marginTop:8,padding:"9px",background:"none",border:"none",color:"#9AA3AB",fontSize:12,cursor:"pointer"}}>Annulla</button>}
    </div>
  );
}

function ListaPreventivi({preventivi,onApri,onNuovo,sessione}){
  const [filtro,setFiltro]=useState("");
  const q=filtro.trim().toLowerCase();
  const filtra = arr => q ? arr.filter(p=>(p.cliente||"").toLowerCase().includes(q)) : arr;

  const daCompletare = filtra(preventivi.filter(p=>p.stato==="Bozza"));
  const daGestire = filtra(preventivi.filter(p=>p.stato==="Inviato"));
  const inOrdine = filtra(preventivi.filter(p=>p.stato==="Convertito in ordine"));
  // Preventivo il cui ordine collegato è stato sospeso (vedi Ordini →
  // Sospendi/Riattiva) — resta visibile qui finché l'ordine non riparte.
  const sospesi = filtra(preventivi.filter(p=>p.stato==="Sospeso"));
  // Trattative "vendita rimandata" con un promemoria impostato: categoria a
  // parte, più visibile, invece che perse in mezzo ai saltati definitivi.
  const daRecuperare = filtra(preventivi.filter(p=>p.stato==="Saltato" && p.motivo_saltato_tipo==="rimandata" && p.promemoria_recupero))
    .sort((a,b)=>new Date(a.promemoria_recupero)-new Date(b.promemoria_recupero));
  // Solo i propri preventivi saltati (esclusi quelli da recuperare, già sopra),
  // in fondo a tutto il resto — quelli di tutto il team si vedono nell'area
  // dedicata "Saltati" (responsabile/admin)
  const mieiSaltati = filtra(preventivi.filter(p=>p.stato==="Saltato" && p.creato_da_nome===sessione?.nome && p.motivo_saltato_tipo!=="rimandata"));

  const totaleVisibile = daCompletare.length+daGestire.length+inOrdine.length+sospesi.length+daRecuperare.length+mieiSaltati.length;

  function rigaPreventivo(p){
    return (
      <div key={p.id} onClick={()=>onApri(p.id)} style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
        <div style={{minWidth:0}}>
          <div className="tnum" style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO}}>{codicePreventivo(p)}</div>
          <div style={{fontWeight:600,fontSize:13.5,marginTop:2}}>{p.cliente || "Cliente non specificato"}</div>
          <div style={{fontSize:11.5,color:"#8A929A",marginTop:1}}>{p.righe.length} articol{p.righe.length===1?"o":"i"}</div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div className="tnum" style={{fontWeight:700,fontSize:14,fontFamily:F_MONO}}>€{p.val.toLocaleString("it-IT")}</div>
          <Tag tone={STATO_COLORE[p.stato]||"steel"} style={{marginTop:5}}>{p.stato}</Tag>
        </div>
      </div>
    );
  }
  function rigaRecupero(p){
    const data = new Date(p.promemoria_recupero);
    const oggi = new Date(); oggi.setHours(0,0,0,0);
    const scaduto = data < oggi;
    return (
      <div key={p.id} onClick={()=>onApri(p.id)} style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,borderLeft:`3px solid ${scaduto?C.danger:C.warn}`}}>
        <div style={{minWidth:0}}>
          <div className="tnum" style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO}}>{codicePreventivo(p)}</div>
          <div style={{fontWeight:600,fontSize:13.5,marginTop:2}}>{p.cliente || "Cliente non specificato"}</div>
          <div style={{fontSize:11.5,color:scaduto?C.danger:"#8A929A",marginTop:1,fontWeight:scaduto?600:400}}>
            {scaduto?"⚠ Richiamo scaduto il ":"Richiamare il "}{data.toLocaleDateString("it-IT")}
          </div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div className="tnum" style={{fontWeight:700,fontSize:14,fontFamily:F_MONO}}>€{p.val.toLocaleString("it-IT")}</div>
          <Tag tone={scaduto?"danger":"warn"} style={{marginTop:5}}>Da recuperare</Tag>
        </div>
      </div>
    );
  }
  function sezione(titolo, elenco){
    if(elenco.length===0) return null;
    return (
      <div style={{marginBottom:24}}>
        <div style={{...S.eyebrow,marginBottom:8}}>{titolo} ({elenco.length})</div>
        {elenco.map(rigaPreventivo)}
      </div>
    );
  }

  return (
    <div>
      <div style={S.eyebrow}>Preventivi</div>

      <div style={{display:"flex",alignItems:"flex-start",gap:20,marginTop:10,marginBottom:22,flexWrap:"wrap"}}>
        <button onClick={onNuovo} style={{...S.btnAccent,padding:"14px 24px",fontSize:14.5,fontWeight:700,flexShrink:0}}>+ Nuovo preventivo</button>

        {preventivi.length>0 && (
          <div style={{position:"relative",flex:"1 1 260px",minWidth:220}}>
            <input
              value={filtro}
              onChange={e=>setFiltro(e.target.value)}
              placeholder="🔍 Cerca preventivo per cliente…"
              style={{...S.inp,padding:"13px 16px",fontSize:14,paddingRight:filtro?38:16}}
            />
            {filtro && (
              <button
                onClick={()=>setFiltro("")}
                style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",border:"none",background:"none",cursor:"pointer",color:"#9AA3AB",fontSize:18,lineHeight:1}}
                title="Pulisci filtro"
              >×</button>
            )}
          </div>
        )}
      </div>

      {preventivi.length===0 && (
        <div style={{textAlign:"center",padding:"2.5rem 1rem",color:"#9AA3AB"}}>
          <div style={{fontSize:28,marginBottom:8}}>▤</div>
          <div style={{fontSize:13}}>Nessun preventivo creato</div>
        </div>
      )}
      {preventivi.length>0 && totaleVisibile===0 && (
        <div style={{textAlign:"center",padding:"2rem 1rem",color:"#9AA3AB",fontSize:13}}>
          {q ? `Nessun preventivo per «${filtro}»` : "Nessun preventivo in queste categorie."}
        </div>
      )}

      {sezione("Da completare", daCompletare)}
      {sezione("Da gestire", daGestire)}
      {sezione("In ordine", inOrdine)}
      {sezione("Sospesi", sospesi)}
      {daRecuperare.length>0 && (
        <div style={{marginBottom:24}}>
          <div style={{...S.eyebrow,marginBottom:8}}>Trattativa da recuperare ({daRecuperare.length})</div>
          {daRecuperare.map(rigaRecupero)}
        </div>
      )}
      {sezione("I tuoi preventivi saltati", mieiSaltati)}
    </div>
  );
}

// ─── PREVENTIVI SALTATI (responsabile/admin) ──────────────────────────────────
// Vista dedicata con tutte le trattative saltate di tutto il team, motivazione
// inclusa — pensata per essere confrontata (anche dall'assistente AI, quando
// collegato) per individuare pattern ricorrenti e correggere prezzi/approccio.
function PreventiviSaltati({preventivi}){
  const saltati = preventivi.filter(p=>p.stato==="Saltato")
    .sort((a,b)=>new Date(b.aggiornato_il||0)-new Date(a.aggiornato_il||0));
  const totalePerso = saltati.reduce((s,p)=>s+(p.val||0),0);

  // Riepilogo per categoria — il punto di partenza per individuare pattern
  // ricorrenti (troppi "prezzo alto"? sempre lo stesso concorrente?)
  const perCategoria = {};
  saltati.forEach(p=>{
    const k = p.motivo_saltato_tipo || "non_specificato";
    perCategoria[k] = (perCategoria[k]||0)+1;
  });

  return (
    <div>
      <div style={S.eyebrow}>Preventivi saltati — tutto il team</div>
      <div style={{fontSize:12.5,color:"#5B6770",marginBottom:18,lineHeight:1.6}}>
        Trattative chiuse senza esito, con la motivazione indicata da chi le ha gestite. Utile per individuare pattern ricorrenti (prezzo, concorrenza, tempistiche) e correggere l'approccio commerciale.
      </div>

      {saltati.length===0 ? (
        <div style={{textAlign:"center",padding:"2.5rem 1rem",color:"#9AA3AB"}}>
          <div style={{fontSize:28,marginBottom:8}}>⊘</div>
          <div style={{fontSize:13}}>Nessuna trattativa saltata al momento.</div>
        </div>
      ) : (
        <>
          <div style={{...S.card,cursor:"default",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12.5,color:C.steel}}>Totale trattative saltate</div>
            <div className="tnum" style={{fontFamily:F_MONO,fontWeight:700,fontSize:16,color:C.danger}}>{saltati.length} · €{totalePerso.toLocaleString("it-IT")}</div>
          </div>

          <div style={{...S.card,cursor:"default",marginBottom:18}}>
            <div style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:10}}>Per categoria</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {Object.entries(perCategoria).sort((a,b)=>b[1]-a[1]).map(([k,n])=>(
                <div key={k} style={{display:"flex",alignItems:"center",gap:7,background:C.paper,border:`1px solid ${C.paperLine}`,borderRadius:7,padding:"7px 12px"}}>
                  <span style={{fontSize:12.5,fontWeight:600}}>{MOTIVI_SALTO[k] || "Non specificato"}</span>
                  <span className="tnum" style={{fontFamily:F_MONO,fontSize:12,color:C.steel}}>{n}</span>
                </div>
              ))}
            </div>
          </div>

          {saltati.map(p=>(
            <div key={p.id} style={{...S.card,cursor:"default"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:8}}>
                <div style={{minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                    <div className="tnum" style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO}}>{codicePreventivo(p)}</div>
                    {p.motivo_saltato_tipo && <Tag tone="danger">{MOTIVI_SALTO[p.motivo_saltato_tipo]}</Tag>}
                  </div>
                  <div style={{fontWeight:600,fontSize:14,marginTop:3}}>{p.cliente || "Cliente non specificato"}</div>
                  <div style={{fontSize:11.5,color:"#8A929A",marginTop:1}}>
                    {p.creato_da_nome ? `Gestito da ${p.creato_da_nome}` : "Operatore non indicato"}
                    {p.righe?.length ? ` · ${p.righe.length} articol${p.righe.length===1?"o":"i"}` : ""}
                  </div>
                </div>
                <div className="tnum" style={{fontWeight:700,fontSize:14,fontFamily:F_MONO,flexShrink:0}}>€{(p.val||0).toLocaleString("it-IT")}</div>
              </div>
              {p.motivo_saltato && (
                <div style={{fontSize:12.5,color:C.charcoal,background:"rgba(200,75,58,0.06)",borderRadius:7,padding:"9px 11px",lineHeight:1.5}}>
                  {p.motivo_saltato}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── ORDINI ───────────────────────────────────────────────────────────────────
function Ordini({ordini,setOrdini,preventivi,setPreventivi,setInterventi,catalog,sessione,ruolo}){
  const [selId,setSelId]=useState(null);
  const [erroreSync,setErroreSync]=useState("");
  const [confermaSospendi,setConfermaSospendi]=useState(false);
  const [confermaRiattiva,setConfermaRiattiva]=useState(false);
  const [confermaEliminaOrdine,setConfermaEliminaOrdine]=useState(false);
  const selezionato = ordini.find(o=>o.id===selId);
  const accessToken = trovaAccessToken(sessione);
  useEffect(()=>{ setConfermaSospendi(false); setConfermaRiattiva(false); setConfermaEliminaOrdine(false); },[selId]);

  // ── Nuovo ordine senza preventivo ───────────────────────────────────────
  const [creandoNuovo,setCreandoNuovo] = useState(false);
  const [nuovoCliente,setNuovoCliente] = useState(null);
  const [nuovoClienteLibero,setNuovoClienteLibero] = useState(false);
  const [nuovoNomeClienteLibero,setNuovoNomeClienteLibero] = useState("");
  const [nuoveRighe,setNuoveRighe] = useState([]);
  const [salvandoNuovo,setSalvandoNuovo] = useState(false);
  const [erroreNuovo,setErroreNuovo] = useState("");

  function annullaNuovoOrdine(){
    setCreandoNuovo(false); setNuovoCliente(null); setNuovoClienteLibero(false);
    setNuovoNomeClienteLibero(""); setNuoveRighe([]); setErroreNuovo("");
  }
  function aggiungiRigaNuovoOrdine(rigaNuova){
    setNuoveRighe(prev=>{
      const esiste = prev.some(r=>r.cod===rigaNuova.cod);
      return esiste ? prev.map(r=>r.cod===rigaNuova.cod?rigaNuova:r) : [...prev, rigaNuova];
    });
  }
  function rimuoviRigaNuovoOrdine(cod){
    setNuoveRighe(prev=>prev.filter(r=>r.cod!==cod));
  }
  const nomeClienteNuovoOrdine = nuovoClienteLibero ? nuovoNomeClienteLibero.trim() : (nuovoCliente?.ragione_sociale||"");
  async function salvaNuovoOrdine(){
    if(!nomeClienteNuovoOrdine || nuoveRighe.length===0) return;
    setSalvandoNuovo(true); setErroreNuovo("");
    const payload = {
      preventivo_id: null,
      cliente: nomeClienteNuovoOrdine,
      cliente_codice: nuovoClienteLibero ? null : (nuovoCliente?.codice || null),
      righe: nuoveRighe,
      val: ricalcolaVal(nuoveRighe),
      stato: "Inserito",
      creato_da_nome: sessione?.nome || null,
    };
    try{
      const [salvato] = await sbAuth("POST","ordini","",payload,accessToken);
      setOrdini(prev=>[salvato,...prev]);
      annullaNuovoOrdine();
      setSelId(salvato.id);
    }catch(err){
      setErroreNuovo("Salvataggio non riuscito: "+err.message);
    }
    setSalvandoNuovo(false);
  }

  // ── "In gestione": presa in carico da responsabile/admin ────────────────
  async function prendiInCarico(id){
    if(!RUOLI_APPROVATORI.includes(ruolo)) return;
    setErroreSync("");
    const o = ordini.find(x=>x.id===id);
    if(!o) return;
    const nome = sessione?.nome || null;
    setOrdini(prev=>prev.map(x=>x.id===id?{...x,stato:"In gestione",gestito_da_nome:nome}:x));
    try{
      await sbAuth("PATCH","ordini",`id=eq.${id}`,{stato:"In gestione",gestito_da_nome:nome},accessToken);
    }catch(err){
      setOrdini(prev=>prev.map(x=>x.id===id?{...x,stato:o.stato,gestito_da_nome:o.gestito_da_nome}:x)); // rollback
      setErroreSync("Non sono riuscito a mettere in carico l'ordine: "+err.message);
    }
  }

  // Date previste, nota per il commerciale, assegnazione tecnico per
  // l'installazione — tutto compilabile da responsabile/admin mentre
  // l'ordine è "In gestione". Stato locale reinizializzato a ogni
  // selezione (vedi useEffect più sotto).
  const [dataFornitoreForm,setDataFornitoreForm] = useState("");
  const [dataClienteForm,setDataClienteForm] = useState("");
  const [notaResponsabileForm,setNotaResponsabileForm] = useState("");
  const [salvandoGestione,setSalvandoGestione] = useState(false);
  const [msgGestione,setMsgGestione] = useState("");
  const [utentiTelos,setUtentiTelos] = useState(null);
  const [tecnicoScelto,setTecnicoScelto] = useState("");
  const [interventoCreato,setInterventoCreato] = useState(false);
  useEffect(()=>{
    if(!selezionato){
      setDataFornitoreForm(""); setDataClienteForm(""); setNotaResponsabileForm("");
      setTecnicoScelto(""); setInterventoCreato(false); setMsgGestione("");
      return;
    }
    setDataFornitoreForm(selezionato.data_consegna_fornitore_prevista || "");
    setDataClienteForm(selezionato.data_consegna_cliente_prevista || "");
    setNotaResponsabileForm("");
    setTecnicoScelto("");
    setInterventoCreato(false);
    setMsgGestione("");
  },[selId]);
  useEffect(()=>{
    if(!RUOLI_APPROVATORI.includes(ruolo) || utentiTelos!==null) return;
    chiamaUtentiInfo(accessToken).then(d=>setUtentiTelos(d?.utenti ?? [])).catch(()=>setUtentiTelos([]));
  },[ruolo]);

  async function salvaDateGestione(){
    if(!selezionato) return;
    setSalvandoGestione(true); setMsgGestione("");
    const payload = {
      data_consegna_fornitore_prevista: dataFornitoreForm || null,
      data_consegna_cliente_prevista: dataClienteForm || null,
    };
    try{
      await sbAuth("PATCH","ordini",`id=eq.${selezionato.id}`,payload,accessToken);
      setOrdini(prev=>prev.map(o=>o.id===selezionato.id?{...o,...payload}:o));
      setMsgGestione("Date salvate.");
    }catch(err){
      setMsgGestione("Errore: "+err.message);
    }
    setSalvandoGestione(false);
  }
  // Segnala una modifica al commerciale che ha inviato l'ordine (banner al
  // prossimo accesso, vedi "avviso_commerciale" nel dettaglio ordine).
  async function segnalaAlCommerciale(){
    if(!selezionato || !notaResponsabileForm.trim()) return;
    setSalvandoGestione(true); setMsgGestione("");
    const payload = { nota_responsabile: notaResponsabileForm.trim(), avviso_commerciale: true };
    try{
      await sbAuth("PATCH","ordini",`id=eq.${selezionato.id}`,payload,accessToken);
      setOrdini(prev=>prev.map(o=>o.id===selezionato.id?{...o,...payload}:o));
      setNotaResponsabileForm("");
      setMsgGestione("Segnalazione inviata.");
    }catch(err){
      setMsgGestione("Errore: "+err.message);
    }
    setSalvandoGestione(false);
  }
  function chiudiAvvisoCommerciale(){
    if(!selezionato) return;
    const payload = { avviso_commerciale: false };
    setOrdini(prev=>prev.map(o=>o.id===selezionato.id?{...o,...payload}:o));
    sbAuth("PATCH","ordini",`id=eq.${selezionato.id}`,payload,accessToken).catch(()=>{});
  }
  // Crea l'intervento pianificato di installazione, assegnato al tecnico
  // scelto — compare da subito nel menu Interventi.
  async function creaInterventoInstallazione(){
    if(!selezionato || !tecnicoScelto) return;
    setSalvandoGestione(true); setMsgGestione("");
    const payload = {
      tipo: "installazione",
      cliente_codice: selezionato.cliente_codice || null,
      cliente_nome: selezionato.cliente,
      stato: "Pianificato",
      priorita: "media",
      data_pianificata: dataClienteForm || null,
      note: `Installazione da ordine ${codiceOrdine(selezionato)}`,
      tecnico_assegnato_nome: tecnicoScelto,
      ordine_id: selezionato.id,
      creato_da_nome: sessione?.nome || null,
    };
    try{
      const [salvato] = await sbAuth("POST","interventi","",payload,accessToken);
      if(setInterventi) setInterventi(prev=>[salvato,...prev]);
      setInterventoCreato(true);
      setMsgGestione(`Intervento creato e assegnato a ${tecnicoScelto}.`);
    }catch(err){
      setMsgGestione("Errore: "+err.message);
    }
    setSalvandoGestione(false);
  }

  // ── Modulo logistico pre-invio (vedi CAMPI_LOGISTICA_ORDINE) ───────────
  const [categorieLogistica,setCategorieLogistica] = useState({}); // {categoria: {rottamazione,...}}
  useEffect(()=>{
    if(!accessToken) return;
    sbGetAuth("categorie_logistica_obbligatoria","select=*",accessToken)
      .then(righe=>{
        const mappa={};
        (righe||[]).forEach(r=>{ mappa[r.categoria]=r; });
        setCategorieLogistica(mappa);
      })
      .catch(()=>setCategorieLogistica({}));
  },[accessToken]);

  const vuotoLogistica = {
    rottamazione_attiva:null, rottamazione_modello:"", rottamazione_seriale:"", rottamazione_foto_url:"", rottamazione_valore:"", rottamazione_gestione:"",
    destinazione_diversa_attiva:null, destinazione_diversa_testo:"",
    mezzi_movimentazione_attiva:null, mezzi_movimentazione_disponibili:null,
    installazione_attiva:null, installazione_tecnico:"",
    formazione_attiva:null, formazione_tecnico:"",
  };
  const [formLogistica,setFormLogistica] = useState(vuotoLogistica);
  const [salvandoInvio,setSalvandoInvio] = useState(false);
  const [erroreInvio,setErroreInvio] = useState("");
  const [caricandoFoto,setCaricandoFoto] = useState(false);
  useEffect(()=>{
    if(!selezionato){ setFormLogistica(vuotoLogistica); return; }
    setFormLogistica({
      rottamazione_attiva: selezionato.rottamazione_attiva ?? null,
      rottamazione_modello: selezionato.rottamazione_modello || "",
      rottamazione_seriale: selezionato.rottamazione_seriale || "",
      rottamazione_foto_url: selezionato.rottamazione_foto_url || "",
      rottamazione_valore: selezionato.rottamazione_valore ?? "",
      rottamazione_gestione: selezionato.rottamazione_gestione || "",
      destinazione_diversa_attiva: selezionato.destinazione_diversa_attiva ?? null,
      destinazione_diversa_testo: selezionato.destinazione_diversa_testo || "",
      mezzi_movimentazione_attiva: selezionato.mezzi_movimentazione_attiva ?? null,
      mezzi_movimentazione_disponibili: selezionato.mezzi_movimentazione_disponibili ?? null,
      installazione_attiva: selezionato.installazione_attiva ?? null,
      installazione_tecnico: selezionato.installazione_tecnico || "",
      formazione_attiva: selezionato.formazione_attiva ?? null,
      formazione_tecnico: selezionato.formazione_tecnico || "",
    });
    setErroreInvio("");
  },[selId]);

  // Categorie dei prodotti dell'ordine, risolte dal catalogo via codice
  // (le righe salvate sul preventivo/ordine non portano la categoria).
  const categorieOrdineCorrente = useMemo(()=>{
    if(!selezionato) return [];
    const cats = new Set();
    (selezionato.righe||[]).forEach(r=>{
      const p = (catalog||[]).find(x=>x.cod===r.cod);
      if(p?.cat) cats.add(p.cat);
    });
    return [...cats];
  },[selezionato,catalog]);
  function campoObbligatorio(obbligKey){
    return categorieOrdineCorrente.some(cat=>categorieLogistica[cat]?.[obbligKey]);
  }

  async function caricaFotoRottamazione(file){
    if(!file || !selezionato) return;
    setCaricandoFoto(true); setErroreInvio("");
    try{
      const estensione = (file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
      const path = `${selezionato.id}-${Date.now()}.${estensione}`;
      const url = await sbUploadStorage("ordini-allegati", path, file, accessToken);
      setFormLogistica(f=>({...f, rottamazione_foto_url:url}));
    }catch(err){
      setErroreInvio("Caricamento foto non riuscito: "+err.message);
    }
    setCaricandoFoto(false);
  }

  // Validazione: per ogni campo obbligatorio per categoria, la domanda
  // sì/no deve essere stata risposta (non null); se la risposta è "sì", i
  // sotto-campi propri di quel caso sono sempre richiesti (a prescindere
  // dall'obbligatorietà per categoria — è la logica intrinseca del caso).
  function erroriValidazioneInvio(){
    const errori = [];
    for(const campo of CAMPI_LOGISTICA_ORDINE){
      const valoreAttiva = formLogistica[`${campo.chiave}_attiva`];
      if(campoObbligatorio(campo.obbligKey) && valoreAttiva===null){
        errori.push(`"${campo.label}" è obbligatorio per almeno un prodotto di questo ordine: rispondi sì o no.`);
      }
    }
    if(formLogistica.rottamazione_attiva===true){
      const haFoto = !!formLogistica.rottamazione_foto_url;
      const haManuale = formLogistica.rottamazione_modello.trim() && formLogistica.rottamazione_seriale.trim();
      if(!haFoto && !haManuale) errori.push("Rottamazione: carica una foto oppure inserisci modello e numero di serie a mano.");
      if(!formLogistica.rottamazione_valore) errori.push("Rottamazione: indica il valore di rottamazione.");
      if(!formLogistica.rottamazione_gestione) errori.push("Rottamazione: specifica se va gestita a nota credito o sconto merce.");
    }
    if(formLogistica.destinazione_diversa_attiva===true && !formLogistica.destinazione_diversa_testo.trim()){
      errori.push("Destinazione diversa: indica dove va consegnato.");
    }
    if(formLogistica.mezzi_movimentazione_attiva===true && formLogistica.mezzi_movimentazione_disponibili===null){
      errori.push("Mezzi movimentazione: specifica se sono disponibili o no.");
    }
    return errori;
  }

  async function confermaInvio(){
    const errori = erroriValidazioneInvio();
    if(errori.length>0){ setErroreInvio(errori[0]); return; }
    setSalvandoInvio(true); setErroreInvio("");
    const payload = {
      ...formLogistica,
      rottamazione_valore: formLogistica.rottamazione_valore===""?null:Number(formLogistica.rottamazione_valore),
      dettagli_invio_completati: true,
      stato: "Inviato",
    };
    try{
      await sbAuth("PATCH","ordini",`id=eq.${selezionato.id}`,payload,accessToken);
      setOrdini(prev=>prev.map(o=>o.id===selezionato.id?{...o,...payload}:o));
    }catch(err){
      setErroreInvio("Salvataggio non riuscito: "+err.message);
    }
    setSalvandoInvio(false);
  }

  async function setStato(id, stato){
    setErroreSync("");
    setOrdini(prev=>prev.map(o=>o.id===id?{...o,stato}:o));
    try{
      await sbAuth("PATCH","ordini",`id=eq.${id}`,{stato},accessToken);
    }catch(err){
      setErroreSync("Modifica non salvata sul server: "+err.message);
    }
  }
  // "Sospendi" (ex "Annulla"): non più uno stato terminale — l'ordine resta
  // modificabile e può essere riattivato (vedi riattivaOrdine). Il
  // preventivo collegato segue lo stesso stato "Sospeso", non più "Bozza"
  // (che resta riservata alle bozze vere, mai state inviate/convertite).
  async function sospendiOrdine(id){
    if(!RUOLI_APPROVATORI.includes(ruolo)) return;
    setConfermaSospendi(false);
    setErroreSync("");
    const o = ordini.find(x=>x.id===id);
    if(!o) return;
    const statoPrecedente = o.stato;
    setOrdini(prev=>prev.map(x=>x.id===id?{...x,stato:"Sospeso",stato_prima_sospensione:statoPrecedente}:x));
    const preventivoCollegato = o.preventivo_id ? (preventivi||[]).find(p=>p.id===o.preventivo_id) : null;
    if(preventivoCollegato && setPreventivi){
      setPreventivi(prev=>prev.map(p=>p.id===o.preventivo_id?{...p,stato:"Sospeso"}:p));
    }
    try{
      await sbAuth("PATCH","ordini",`id=eq.${id}`,{stato:"Sospeso",stato_prima_sospensione:statoPrecedente},accessToken);
      if(preventivoCollegato){
        try{
          await sbAuth("PATCH","preventivi",`id=eq.${o.preventivo_id}`,{stato:"Sospeso"},accessToken);
        }catch(err){
          setErroreSync("Ordine sospeso, ma non sono riuscito a sospendere anche il preventivo: "+err.message);
        }
      }
    }catch(err){
      setOrdini(prev=>prev.map(x=>x.id===id?{...x,stato:statoPrecedente,stato_prima_sospensione:o.stato_prima_sospensione}:x)); // rollback ordine
      if(preventivoCollegato && setPreventivi){
        setPreventivi(prev=>prev.map(p=>p.id===o.preventivo_id?{...p,stato:preventivoCollegato.stato}:p)); // rollback preventivo
      }
      setErroreSync("Sospensione non riuscita: "+err.message);
    }
  }
  // Riattiva un ordine sospeso: torna esattamente allo stato in cui era
  // prima della sospensione (memorizzato in stato_prima_sospensione), e il
  // preventivo collegato torna "Convertito in ordine" — come richiesto,
  // indipendentemente da cos'altro fosse successo nel frattempo.
  async function riattivaOrdine(id){
    if(!RUOLI_APPROVATORI.includes(ruolo)) return;
    setConfermaSospendi(false);
    setErroreSync("");
    const o = ordini.find(x=>x.id===id);
    if(!o) return;
    const statoRipristinato = o.stato_prima_sospensione || "Inserito";
    setOrdini(prev=>prev.map(x=>x.id===id?{...x,stato:statoRipristinato,stato_prima_sospensione:null}:x));
    const preventivoCollegato = o.preventivo_id ? (preventivi||[]).find(p=>p.id===o.preventivo_id) : null;
    if(preventivoCollegato && setPreventivi){
      setPreventivi(prev=>prev.map(p=>p.id===o.preventivo_id?{...p,stato:"Convertito in ordine"}:p));
    }
    try{
      await sbAuth("PATCH","ordini",`id=eq.${id}`,{stato:statoRipristinato,stato_prima_sospensione:null},accessToken);
      if(preventivoCollegato){
        try{
          await sbAuth("PATCH","preventivi",`id=eq.${o.preventivo_id}`,{stato:"Convertito in ordine"},accessToken);
        }catch(err){
          setErroreSync("Ordine riattivato, ma non sono riuscito ad aggiornare il preventivo: "+err.message);
        }
      }
    }catch(err){
      setOrdini(prev=>prev.map(x=>x.id===id?{...x,stato:"Sospeso",stato_prima_sospensione:o.stato_prima_sospensione}:x)); // rollback ordine
      if(preventivoCollegato && setPreventivi){
        setPreventivi(prev=>prev.map(p=>p.id===o.preventivo_id?{...p,stato:preventivoCollegato.stato}:p)); // rollback preventivo
      }
      setErroreSync("Riattivazione non riuscita: "+err.message);
    }
  }
  async function eliminaOrdine(id){
    setConfermaEliminaOrdine(false);
    if(!RUOLI_APPROVATORI.includes(ruolo)) return; // solo responsabile/admin — bloccato anche a livello di RLS
    const o = ordini.find(x=>x.id===id);
    if(!o) return;
    setErroreSync("");
    setOrdini(prev=>prev.filter(x=>x.id!==id));
    setSelId(null);
    // Se l'ordine viene da un preventivo confermato, quel preventivo torna
    // in Bozza — altrimenti resterebbe bloccato su "Convertito in ordine"
    // senza più un ordine reale dietro, non più modificabile né eliminabile
    // (da "Inviato" in poi la modifica/eliminazione è riservata a
    // responsabile/admin, "Bozza" invece è aperta a chiunque).
    const preventivoCollegato = o.preventivo_id ? (preventivi||[]).find(p=>p.id===o.preventivo_id) : null;
    if(preventivoCollegato && setPreventivi){
      setPreventivi(prev=>prev.map(p=>p.id===o.preventivo_id?{...p,stato:"Bozza"}:p));
    }
    try{
      await sbAuth("DELETE","ordini",`id=eq.${id}`,null,accessToken);
      if(preventivoCollegato){
        try{
          await sbAuth("PATCH","preventivi",`id=eq.${o.preventivo_id}`,{stato:"Bozza"},accessToken);
        }catch(err){
          setErroreSync("Ordine eliminato, ma non sono riuscito a riportare il preventivo in Bozza: "+err.message);
        }
      }
    }catch(err){
      setOrdini(prev=>[o,...prev]); // rollback ordine
      if(preventivoCollegato && setPreventivi){
        setPreventivi(prev=>prev.map(p=>p.id===o.preventivo_id?{...p,stato:preventivoCollegato.stato}:p)); // rollback preventivo
      }
      setErroreSync("Eliminazione non riuscita: "+err.message);
    }
  }
  function BottoniSiNo(valore, onSi, onNo){
    return (
      <div style={{display:"flex",gap:8}}>
        <button onClick={onSi} style={{...S.btnS,padding:"7px 14px",flex:1,...(valore===true?{background:C.ink,color:"#fff",borderColor:C.ink}:{})}}>Sì</button>
        <button onClick={onNo} style={{...S.btnS,padding:"7px 14px",flex:1,...(valore===false?{background:C.ink,color:"#fff",borderColor:C.ink}:{})}}>No</button>
      </div>
    );
  }
  // Modifica righe (solo mentre l'ordine è "Sospeso" — vedi rendering più
  // sotto): stessa idea della modifica righe inline dei preventivi, ma
  // scritta subito con PATCH diretto invece di passare da un "aggiorna"
  // locale condiviso, dato che qui non esiste un concetto di bozza.
  function ricalcolaVal(righe){ return righe.reduce((s,r)=>s+r.netto*(r.qty||1),0); }
  async function modificaRigaOrdine(cod, campo, valore){
    if(!selezionato) return;
    const righe = selezionato.righe.map(r=>r.cod===cod?{...r,[campo]:valore}:r);
    const val = ricalcolaVal(righe);
    setOrdini(prev=>prev.map(o=>o.id===selezionato.id?{...o,righe,val}:o));
    try{ await sbAuth("PATCH","ordini",`id=eq.${selezionato.id}`,{righe,val},accessToken); }
    catch(err){ setErroreSync("Modifica non salvata: "+err.message); }
  }
  async function rimuoviRigaOrdine(cod){
    if(!selezionato) return;
    const righe = selezionato.righe.filter(r=>r.cod!==cod);
    const val = ricalcolaVal(righe);
    setOrdini(prev=>prev.map(o=>o.id===selezionato.id?{...o,righe,val}:o));
    try{ await sbAuth("PATCH","ordini",`id=eq.${selezionato.id}`,{righe,val},accessToken); }
    catch(err){ setErroreSync("Modifica non salvata: "+err.message); }
  }
  async function aggiungiRigaOrdine(rigaNuova){
    if(!selezionato) return;
    const esiste = selezionato.righe.some(r=>r.cod===rigaNuova.cod);
    const righe = esiste ? selezionato.righe.map(r=>r.cod===rigaNuova.cod?rigaNuova:r) : [...selezionato.righe, rigaNuova];
    const val = ricalcolaVal(righe);
    setOrdini(prev=>prev.map(o=>o.id===selezionato.id?{...o,righe,val}:o));
    try{ await sbAuth("PATCH","ordini",`id=eq.${selezionato.id}`,{righe,val},accessToken); }
    catch(err){ setErroreSync("Modifica non salvata: "+err.message); }
  }
  function generaOrdinePDF(o){
    const righe = o.righe.map(r => `
      <tr><td style="padding:8px 6px;border-bottom:1px solid #E3E5EA;font-size:12px">${r.mar} ${r.nome}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #E3E5EA;font-size:12px;font-family:monospace">${r.cod}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #E3E5EA;font-size:12px;text-align:center">${r.qty||1}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #E3E5EA;font-size:12px;text-align:right">€${(r.netto*(r.qty||1)).toFixed(2)}</td></tr>`).join("");
    const w = window.open("", "_blank");
    const html = `<!DOCTYPE html><html><head><title>Ordine ${codiceOrdine(o)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;padding:36px 40px;color:#232323;font-size:13px}
  .hd{display:flex;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #162758}
  .brand{font-size:22px;font-weight:700;color:#162758}
  .meta{text-align:right;font-size:11px;color:#7C879E;line-height:1.6}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th{background:#162758;color:#fff;padding:8px 6px;font-size:11px;text-align:left}
  .tot{text-align:right;margin-top:18px;font-size:18px;font-weight:700;color:#162758}
  .firma{margin-top:24px;border:1px solid #E3E5EA;border-radius:6px;padding:14px}
  .firma img{max-width:200px;max-height:80px;display:block}
  .firma-nota{font-size:10px;color:#7C879E;margin-top:6px;font-style:italic}
  .footer{margin-top:32px;font-size:10px;color:#9AA3AB;border-top:1px solid #E3E5EA;padding-top:10px}
</style></head><body>
<div class="hd"><div><div class="brand">Telos Tech</div><div style="font-size:11px;color:#7C879E">Conferma d'ordine</div></div>
<div class="meta"><div>N° ${codiceOrdine(o)}</div><div>Rif. preventivo ${codicePreventivoRif(o)}</div><div>Data: ${o.creato_il ? new Date(o.creato_il).toLocaleDateString("it-IT") : ""}</div></div></div>
<div style="font-size:15px;font-weight:600;margin-bottom:6px">${o.cliente}</div>
<table><thead><tr><th>Articolo</th><th>Codice</th><th style="text-align:center">Qtà</th><th style="text-align:right">Totale</th></tr></thead><tbody>${righe}</tbody></table>
<div class="tot">Totale: €${o.val.toFixed(2)}</div>
${o.firma_cliente ? `
<div class="firma">
  <div style="font-size:11px;font-weight:600;color:#3A4248;margin-bottom:6px">Accettato con firma del cliente</div>
  <img src="${o.firma_cliente}" alt="Firma cliente"/>
  <div class="firma-nota">Firmato da ${o.firma_nome||"Cliente"}${o.firma_data ? ` il ${new Date(o.firma_data).toLocaleString("it-IT",{dateStyle:"short",timeStyle:"short"})}` : ""}</div>
</div>
` : ""}
<div class="footer">Telos Tech S.r.l. · Documento generato il ${new Date().toLocaleDateString("it-IT")}</div>
<script>
(function(){
  var stampato = false;
  function stampaUnaVolta(){ if(stampato) return; stampato = true; window.print(); }
  var imgs = Array.prototype.slice.call(document.images);
  var rimanenti = imgs.filter(function(im){ return !im.complete; }).length;
  if(rimanenti===0){ setTimeout(stampaUnaVolta, 150); }
  else {
    imgs.forEach(function(im){
      if(im.complete) return;
      im.addEventListener('load', function(){ rimanenti--; if(rimanenti<=0) stampaUnaVolta(); });
      im.addEventListener('error', function(){ rimanenti--; if(rimanenti<=0) stampaUnaVolta(); });
    });
  }
  setTimeout(stampaUnaVolta, 4000);
})();
</script>
</body></html>`;
    w.document.write(html); w.document.close();
  }

  if(selezionato){
    // Righe modificabili: sempre mentre "Sospeso", oppure mentre "In
    // gestione" ma solo per chi la sta gestendo (responsabile/admin) — un
    // commerciale che riapre un ordine in gestione lo vede in sola lettura.
    const righeEditabili = selezionato.stato==="Sospeso" || (selezionato.stato==="In gestione" && RUOLI_APPROVATORI.includes(ruolo));
    return (
      <div>
        <button onClick={()=>setSelId(null)} style={{...S.btnS,marginBottom:14}}>← Tutti gli ordini</button>
        {erroreSync && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>⚠ {erroreSync}</div>}
        {selezionato.avviso_commerciale && (
          <div style={{background:"rgba(217,164,65,0.14)",border:`1px solid ${C.warn}`,borderRadius:9,padding:14,marginBottom:16}}>
            <div style={{fontSize:12.5,fontWeight:700,color:"#8a6418",marginBottom:6}}>⚠ Il responsabile ha segnalato una modifica</div>
            <div style={{fontSize:12.5,color:"#3A4248",marginBottom:10,lineHeight:1.5}}>{selezionato.nota_responsabile}</div>
            <button onClick={chiudiAvvisoCommerciale} style={{...S.btnS,padding:"7px 12px",fontSize:12}}>Ho visto</button>
          </div>
        )}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <div className="tnum" style={{fontFamily:F_MONO,fontSize:12,color:"#9AA3AB"}}>{codiceOrdine(selezionato)}</div>
          <Tag tone={toneOrdine(selezionato.stato)}>{selezionato.stato}</Tag>
        </div>
        <div style={{fontFamily:F_DISPLAY,fontSize:19,fontWeight:600,marginBottom:4}}>{selezionato.cliente}</div>
        <div style={{fontSize:11.5,color:"#8A929A",marginBottom:4}}>
          {selezionato.preventivo_id ? `Da preventivo ${codicePreventivoRif(selezionato)}` : "Creato manualmente"} · creato il {selezionato.creato_il ? new Date(selezionato.creato_il).toLocaleDateString("it-IT") : ""}{selezionato.creato_da_nome?` da ${selezionato.creato_da_nome}`:""}
        </div>
        {selezionato.gestito_da_nome && (
          <div style={{fontSize:11.5,color:"#8A929A",marginBottom:14}}>In gestione da <strong>{selezionato.gestito_da_nome}</strong></div>
        )}

        {selezionato.firma_cliente && (
          <div style={{...S.card,cursor:"default",marginBottom:16}}>
            <div style={{fontSize:12.5,fontWeight:600,color:C.ok,marginBottom:8}}>
              ✓ Accettato con firma da {selezionato.firma_nome}{selezionato.firma_data ? ` — ${new Date(selezionato.firma_data).toLocaleString("it-IT",{dateStyle:"short",timeStyle:"short"})}` : ""}
            </div>
            <img src={selezionato.firma_cliente} alt="Firma cliente" style={{maxWidth:220,border:`1px solid ${C.paperLine}`,borderRadius:6,background:"#fff",display:"block"}}/>
          </div>
        )}
        <div style={S.eyebrow}>Articoli ({selezionato.righe.length})</div>
        {righeEditabili && selezionato.stato==="Sospeso" && (
          <div style={{fontSize:11.5,color:"#8a6418",background:"rgba(217,164,65,0.14)",borderRadius:6,padding:"9px 11px",marginBottom:10}}>
            ⓘ Ordine sospeso: articoli, quantità e prezzi sono modificabili finché non lo riattivi.
          </div>
        )}
        {righeEditabili && selezionato.stato==="In gestione" && (
          <div style={{fontSize:11.5,color:"#8a6418",background:"rgba(217,164,65,0.14)",borderRadius:6,padding:"9px 11px",marginBottom:10}}>
            ⓘ Puoi correggere articoli, quantità e prezzi mentre gestisci l'ordine.
          </div>
        )}
        {righeEditabili && (
          <RicercaProdottiInline onSeleziona={aggiungiRigaOrdine} righeEsistenti={selezionato.righe} ruolo={ruolo} catalog={catalog} sessione={sessione}/>
        )}
        {selezionato.righe.map(r=>(
          <div key={r.cod} style={{...S.card,cursor:"default"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <Tag tone="steel">{r.mar}</Tag>
                <div style={{fontWeight:600,fontSize:13,marginTop:4}}>{r.nome}</div>
                {!righeEditabili && <div className="tnum" style={{fontSize:11,color:"#9AA3AB",marginTop:2}}>€{r.netto.toFixed(2)} × {r.qty||1}</div>}
              </div>
              <span className="tnum" style={{fontWeight:700,fontFamily:F_MONO,fontSize:14}}>€{(r.netto*(r.qty||1)).toFixed(2)}</span>
            </div>
            {righeEditabili && (
              <div style={{display:"flex",gap:8,alignItems:"center",marginTop:10,paddingTop:10,borderTop:`1px solid ${C.paperLine}`}}>
                <div style={{flex:"0 0 70px"}}>
                  <label style={{fontSize:10,fontFamily:F_MONO,color:"#9AA3AB"}}>Qtà</label>
                  <input type="number" min="1" value={r.qty||1} onChange={e=>modificaRigaOrdine(r.cod,"qty",Math.max(1,parseInt(e.target.value)||1))} className="tnum" style={{...S.inp,fontFamily:F_MONO,padding:"7px 9px"}}/>
                </div>
                <div style={{flex:"1 1 120px"}}>
                  <label style={{fontSize:10,fontFamily:F_MONO,color:"#9AA3AB"}}>Netto unitario €</label>
                  <input type="number" step="0.01" value={r.netto} onChange={e=>modificaRigaOrdine(r.cod,"netto",parseFloat(e.target.value)||0)} className="tnum" style={{...S.inp,fontFamily:F_MONO,padding:"7px 9px"}}/>
                </div>
                <button onClick={()=>rimuoviRigaOrdine(r.cod)} style={{...S.btnS,padding:"7px 10px",fontSize:11.5,color:C.danger,flexShrink:0,alignSelf:"flex-end"}}>🗑 Rimuovi</button>
              </div>
            )}
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",padding:"14px 0",borderTop:`1px solid ${C.paperLine}`,marginTop:8,marginBottom:16}}>
          <span style={{fontWeight:600,fontSize:14}}>Totale</span>
          <span className="tnum" style={{fontWeight:700,fontSize:18,fontFamily:F_MONO,color:C.ink}}>€{selezionato.val.toFixed(2)}</span>
        </div>

        {selezionato.stato==="Inserito" && (
          <div style={{...S.card,cursor:"default",border:`1px solid ${C.ink}`,marginBottom:16}}>
            <div style={S.eyebrow}>Prima dell'invio</div>
            <div style={{fontSize:12.5,color:C.steel,marginTop:4,marginBottom:16,lineHeight:1.6}}>
              Indica se questo ordine comporta uno di questi casi. I campi segnati "obbligatorio" dipendono dalla
              categoria dei prodotti in ordine (configurabile da Admin → Logistica).
            </div>

            {/* Rottamazione */}
            <div style={{marginBottom:18,paddingBottom:18,borderBottom:`1px solid ${C.paperLine}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                <div style={{fontWeight:600,fontSize:13}}>Ritiro per rottamazione</div>
                {campoObbligatorio("rottamazione") && <Tag tone="warn">obbligatorio</Tag>}
              </div>
              <div style={{fontSize:12,color:C.steel,marginBottom:8}}>Comporta il ritiro di un prodotto da rottamare?</div>
              {BottoniSiNo(formLogistica.rottamazione_attiva,
                ()=>setFormLogistica(f=>({...f,rottamazione_attiva:true})),
                ()=>setFormLogistica(f=>({...f,rottamazione_attiva:false})))}
              {formLogistica.rottamazione_attiva===true && (
                <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:12}}>
                  <div style={{fontSize:11,color:"#9AA3AB"}}>Carica una foto del prodotto (con modello e matricola visibili) oppure inseriscili a mano:</div>
                  <input type="file" accept="image/*" onChange={e=>caricaFotoRottamazione(e.target.files[0])} disabled={caricandoFoto}/>
                  {caricandoFoto && <div style={{fontSize:11.5,color:C.steel}}>Caricamento…</div>}
                  {formLogistica.rottamazione_foto_url && (
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <img src={formLogistica.rottamazione_foto_url} alt="" style={{width:56,height:56,objectFit:"cover",borderRadius:6,border:`1px solid ${C.paperLine}`}}/>
                      <button onClick={()=>setFormLogistica(f=>({...f,rottamazione_foto_url:""}))} style={{...S.btnS,padding:"5px 10px",fontSize:11}}>Rimuovi foto</button>
                    </div>
                  )}
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <input value={formLogistica.rottamazione_modello} onChange={e=>setFormLogistica(f=>({...f,rottamazione_modello:e.target.value}))} placeholder="Modello" style={{...S.inp,flex:"1 1 140px"}}/>
                    <input value={formLogistica.rottamazione_seriale} onChange={e=>setFormLogistica(f=>({...f,rottamazione_seriale:e.target.value}))} placeholder="Matricola" style={{...S.inp,flex:"1 1 140px"}}/>
                  </div>
                  <input type="number" step="0.01" value={formLogistica.rottamazione_valore} onChange={e=>setFormLogistica(f=>({...f,rottamazione_valore:e.target.value}))} placeholder="Valore di rottamazione (€)" className="tnum" style={{...S.inp,fontFamily:F_MONO}}/>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>setFormLogistica(f=>({...f,rottamazione_gestione:"nota_credito"}))} style={{...S.btnS,padding:"7px 14px",flex:1,...(formLogistica.rottamazione_gestione==="nota_credito"?{background:C.ink,color:"#fff",borderColor:C.ink}:{})}}>Nota credito</button>
                    <button onClick={()=>setFormLogistica(f=>({...f,rottamazione_gestione:"sconto_merce"}))} style={{...S.btnS,padding:"7px 14px",flex:1,...(formLogistica.rottamazione_gestione==="sconto_merce"?{background:C.ink,color:"#fff",borderColor:C.ink}:{})}}>Sconto merce</button>
                  </div>
                </div>
              )}
            </div>

            {/* Destinazione diversa */}
            <div style={{marginBottom:18,paddingBottom:18,borderBottom:`1px solid ${C.paperLine}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                <div style={{fontWeight:600,fontSize:13}}>Destinazione trasporto diversa dal cliente</div>
                {campoObbligatorio("destinazione_diversa") && <Tag tone="warn">obbligatorio</Tag>}
              </div>
              <div style={{fontSize:12,color:C.steel,marginBottom:8}}>Va consegnato a un indirizzo diverso da quello del cliente (altra sede, tecnico installatore)?</div>
              {BottoniSiNo(formLogistica.destinazione_diversa_attiva,
                ()=>setFormLogistica(f=>({...f,destinazione_diversa_attiva:true})),
                ()=>setFormLogistica(f=>({...f,destinazione_diversa_attiva:false})))}
              {formLogistica.destinazione_diversa_attiva===true && (
                <textarea value={formLogistica.destinazione_diversa_testo} onChange={e=>setFormLogistica(f=>({...f,destinazione_diversa_testo:e.target.value}))} placeholder="Indirizzo o riferimento della destinazione (es. tecnico installatore XY, via...)" rows={2} style={{...S.inp,resize:"vertical",marginTop:10}}/>
              )}
            </div>

            {/* Mezzi movimentazione */}
            <div style={{marginBottom:18,paddingBottom:18,borderBottom:`1px solid ${C.paperLine}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                <div style={{fontWeight:600,fontSize:13}}>Mezzi movimentazione carichi</div>
                {campoObbligatorio("mezzi_movimentazione") && <Tag tone="warn">obbligatorio</Tag>}
              </div>
              <div style={{fontSize:12,color:C.steel,marginBottom:8}}>Serve verificare la disponibilità di mezzi allo scarico (es. muletti per scarico ponti)?</div>
              {BottoniSiNo(formLogistica.mezzi_movimentazione_attiva,
                ()=>setFormLogistica(f=>({...f,mezzi_movimentazione_attiva:true})),
                ()=>setFormLogistica(f=>({...f,mezzi_movimentazione_attiva:false})))}
              {formLogistica.mezzi_movimentazione_attiva===true && (
                <div style={{marginTop:10}}>
                  <div style={{fontSize:11.5,color:"#9AA3AB",marginBottom:6}}>Mezzi disponibili presso il cliente?</div>
                  {BottoniSiNo(formLogistica.mezzi_movimentazione_disponibili,
                    ()=>setFormLogistica(f=>({...f,mezzi_movimentazione_disponibili:true})),
                    ()=>setFormLogistica(f=>({...f,mezzi_movimentazione_disponibili:false})))}
                </div>
              )}
            </div>

            {/* Installazione */}
            <div style={{marginBottom:18,paddingBottom:18,borderBottom:`1px solid ${C.paperLine}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                <div style={{fontWeight:600,fontSize:13}}>Installazione tecnica richiesta</div>
                {campoObbligatorio("installazione") && <Tag tone="warn">obbligatorio</Tag>}
              </div>
              <div style={{fontSize:12,color:C.steel,marginBottom:8}}>È richiesta l'installazione da parte di un tecnico?</div>
              {BottoniSiNo(formLogistica.installazione_attiva,
                ()=>setFormLogistica(f=>({...f,installazione_attiva:true})),
                ()=>setFormLogistica(f=>({...f,installazione_attiva:false})))}
              {formLogistica.installazione_attiva===true && (
                <input value={formLogistica.installazione_tecnico} onChange={e=>setFormLogistica(f=>({...f,installazione_tecnico:e.target.value}))} placeholder="Tecnico richiesto in particolare (opzionale)" style={{...S.inp,marginTop:10}}/>
              )}
            </div>

            {/* Formazione */}
            <div style={{marginBottom:4}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:6}}>
                <div style={{fontWeight:600,fontSize:13}}>Formazione all'uso</div>
                {campoObbligatorio("formazione") && <Tag tone="warn">obbligatorio</Tag>}
              </div>
              <div style={{fontSize:12,color:C.steel,marginBottom:8}}>È richiesta la formazione all'uso per il cliente?</div>
              {BottoniSiNo(formLogistica.formazione_attiva,
                ()=>setFormLogistica(f=>({...f,formazione_attiva:true})),
                ()=>setFormLogistica(f=>({...f,formazione_attiva:false})))}
              {formLogistica.formazione_attiva===true && (
                <input value={formLogistica.formazione_tecnico} onChange={e=>setFormLogistica(f=>({...f,formazione_tecnico:e.target.value}))} placeholder="Tecnico richiesto in particolare (opzionale)" style={{...S.inp,marginTop:10}}/>
              )}
            </div>

            {erroreInvio && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginTop:14,marginBottom:4}}>⚠ {erroreInvio}</div>}
            <button onClick={confermaInvio} disabled={salvandoInvio||caricandoFoto} style={{...S.btnAccent,width:"100%",padding:"13px",marginTop:14,opacity:(salvandoInvio||caricandoFoto)?0.6:1}}>
              {salvandoInvio?"Salvo…":"✓ Segna come inviato"}
            </button>
          </div>
        )}

        {selezionato.dettagli_invio_completati && selezionato.stato!=="Inserito" && (
          <div style={{...S.card,cursor:"default",marginBottom:16}}>
            <div style={S.eyebrow}>Dettagli invio</div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:6,fontSize:12.5,color:C.charcoal}}>
              {selezionato.rottamazione_attiva && <div>♻ Rottamazione — {selezionato.rottamazione_gestione==="nota_credito"?"nota credito":"sconto merce"}, valore €{Number(selezionato.rottamazione_valore||0).toFixed(2)}{selezionato.rottamazione_foto_url?" · foto allegata":""}</div>}
              {selezionato.destinazione_diversa_attiva && <div>📍 Destinazione diversa — {selezionato.destinazione_diversa_testo}</div>}
              {selezionato.mezzi_movimentazione_attiva && <div>🚚 Mezzi movimentazione — {selezionato.mezzi_movimentazione_disponibili?"disponibili":"non disponibili"}</div>}
              {selezionato.installazione_attiva && <div>🔧 Installazione richiesta{selezionato.installazione_tecnico?` — ${selezionato.installazione_tecnico}`:""}</div>}
              {selezionato.formazione_attiva && <div>🎓 Formazione richiesta{selezionato.formazione_tecnico?` — ${selezionato.formazione_tecnico}`:""}</div>}
              {!selezionato.rottamazione_attiva && !selezionato.destinazione_diversa_attiva && !selezionato.mezzi_movimentazione_attiva && !selezionato.installazione_attiva && !selezionato.formazione_attiva && (
                <div style={{color:"#9AA3AB"}}>Nessun caso particolare segnalato.</div>
              )}
            </div>
          </div>
        )}
        {RUOLI_APPROVATORI.includes(ruolo) && selezionato.stato==="In gestione" && (
          <div style={{...S.card,cursor:"default",border:`1px solid ${C.ink}`,marginBottom:16}}>
            <div style={S.eyebrow}>Gestione ordine</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:8,marginBottom:14}}>
              <div style={{flex:"1 1 160px"}}>
                <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Consegna prevista dal fornitore</label>
                <input type="date" value={dataFornitoreForm} onChange={e=>setDataFornitoreForm(e.target.value)} style={S.inp}/>
                <div style={{fontSize:10.5,color:"#9AA3AB",marginTop:3}}>Solo per tuo promemoria</div>
              </div>
              <div style={{flex:"1 1 160px"}}>
                <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Consegna prevista al cliente</label>
                <input type="date" value={dataClienteForm} onChange={e=>setDataClienteForm(e.target.value)} style={S.inp}/>
              </div>
            </div>
            <button onClick={salvaDateGestione} disabled={salvandoGestione} style={{...S.btnS,padding:"8px 14px",fontSize:12,marginBottom:18}}>Salva date</button>

            <div style={{paddingTop:14,borderTop:`1px solid ${C.paperLine}`,marginBottom:18}}>
              <div style={{fontSize:12.5,fontWeight:600,marginBottom:8}}>Segnala qualcosa al commerciale</div>
              <textarea value={notaResponsabileForm} onChange={e=>setNotaResponsabileForm(e.target.value)} placeholder="Es. manca l'indirizzo di consegna, verificare disponibilità…" rows={2} style={{...S.inp,resize:"vertical",marginBottom:8}}/>
              <button onClick={segnalaAlCommerciale} disabled={!notaResponsabileForm.trim()||salvandoGestione} style={{...S.btnS,padding:"8px 14px",fontSize:12,opacity:notaResponsabileForm.trim()?1:0.5}}>Invia segnalazione</button>
            </div>

            {selezionato.installazione_attiva && (
              <div style={{paddingTop:14,borderTop:`1px solid ${C.paperLine}`}}>
                <div style={{fontSize:12.5,fontWeight:600,marginBottom:8}}>Assegna installazione a un tecnico</div>
                {interventoCreato ? (
                  <div style={{fontSize:12,color:C.ok}}>✓ Intervento creato — visibile nel menu Interventi.</div>
                ) : (
                  <>
                    <select value={tecnicoScelto} onChange={e=>setTecnicoScelto(e.target.value)} style={{...S.inp,marginBottom:8}}>
                      <option value="">— scegli un tecnico —</option>
                      {(utentiTelos||[]).map(u=>(<option key={u.id} value={`${u.nome} ${u.cognome||""}`.trim()}>{u.nome} {u.cognome} {u.ruolo?`(${u.ruolo})`:""}</option>))}
                    </select>
                    <button onClick={creaInterventoInstallazione} disabled={!tecnicoScelto||salvandoGestione} style={{...S.btnAccent,padding:"9px 15px",fontSize:12.5,opacity:tecnicoScelto?1:0.5}}>Crea intervento pianificato</button>
                  </>
                )}
              </div>
            )}

            {msgGestione && <div style={{fontSize:12,color:C.steel,marginTop:12}}>{msgGestione}</div>}
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {RUOLI_APPROVATORI.includes(ruolo) && selezionato.stato==="Inviato" && (
            <button onClick={()=>prendiInCarico(selezionato.id)} style={{...S.btnAccent,padding:"13px"}}>📋 Prendi in carico</button>
          )}
          {selezionato.stato==="In gestione" && (
            <button onClick={()=>setStato(selezionato.id,"Evaso")} style={{...S.btnAccent,padding:"12px",background:C.ok,color:"#fff"}}>✓ Segna come evaso</button>
          )}
          <button onClick={()=>generaOrdinePDF(selezionato)} style={{...S.btnAccent,padding:"12px"}}>📄 Invia ordine in PDF</button>
        </div>

        {RUOLI_APPROVATORI.includes(ruolo) && selezionato.stato==="Sospeso" && (
          <div style={{marginTop:20}}>
            {!confermaRiattiva ? (
              <button onClick={()=>setConfermaRiattiva(true)} style={{width:"100%",padding:"12px",background:C.ink,color:"#fff",border:"none",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                ▶ Riattiva ordine
              </button>
            ) : (
              <div style={{background:"rgba(22,39,88,0.06)",border:`1px solid ${C.ink}`,borderRadius:9,padding:16}}>
                <div style={{fontSize:13.5,fontWeight:700,color:C.ink,marginBottom:6}}>Confermi la riattivazione dell'ordine?</div>
                <div style={{fontSize:12.5,color:C.steel,marginBottom:12}}>
                  L'ordine torna allo stato precedente la sospensione{selezionato.preventivo_id?" e il preventivo collegato torna \"Convertito in ordine\"":""}.
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>{riattivaOrdine(selezionato.id); setConfermaRiattiva(false);}} style={{flex:1,padding:"12px",background:C.ink,color:"#fff",border:"none",borderRadius:8,fontSize:13.5,fontWeight:700,cursor:"pointer"}}>Sì, riattiva</button>
                  <button onClick={()=>setConfermaRiattiva(false)} style={{flex:1,padding:"12px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:8,fontSize:13.5,fontWeight:600,cursor:"pointer"}}>Torna indietro</button>
                </div>
              </div>
            )}
          </div>
        )}

        {RUOLI_APPROVATORI.includes(ruolo) && selezionato.stato!=="Annullato" && selezionato.stato!=="Sospeso" && (
          <div style={{marginTop:20}}>
            {!confermaSospendi ? (
              <button onClick={()=>setConfermaSospendi(true)} style={{width:"100%",padding:"12px",background:"#fff",color:C.danger,border:`1px solid ${C.danger}`,borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                ⏸ Sospendi ordine
              </button>
            ) : (
              <div style={{background:"rgba(200,75,58,0.08)",border:`1px solid ${C.danger}`,borderRadius:9,padding:16}}>
                <div style={{fontSize:13.5,fontWeight:700,color:C.danger,marginBottom:6}}>Confermi la sospensione dell'ordine?</div>
                <div style={{fontSize:12.5,color:C.steel,marginBottom:12}}>
                  L'ordine resta modificabile e riattivabile in seguito{selezionato.preventivo_id?" — anche il preventivo collegato passa a \"Sospeso\"":""}.
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>sospendiOrdine(selezionato.id)} style={{flex:1,padding:"12px",background:C.danger,color:"#fff",border:"none",borderRadius:8,fontSize:13.5,fontWeight:700,cursor:"pointer"}}>Sì, sospendi</button>
                  <button onClick={()=>setConfermaSospendi(false)} style={{flex:1,padding:"12px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:8,fontSize:13.5,fontWeight:600,cursor:"pointer"}}>Torna indietro</button>
                </div>
              </div>
            )}
          </div>
        )}

        {RUOLI_APPROVATORI.includes(ruolo) && (
          <div style={{marginTop:12,paddingTop:16,borderTop:`1px solid ${C.paperLine}`}}>
            {!confermaEliminaOrdine ? (
              <button onClick={()=>setConfermaEliminaOrdine(true)} style={{width:"100%",padding:"14px",background:C.danger,color:"#fff",border:"none",borderRadius:9,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                🗑 Elimina ordine
              </button>
            ) : (
              <div style={{background:"rgba(200,75,58,0.08)",border:`1px solid ${C.danger}`,borderRadius:9,padding:16}}>
                <div style={{fontSize:13.5,fontWeight:700,color:C.danger,marginBottom:6}}>Confermi l'eliminazione definitiva?</div>
                <div style={{fontSize:12.5,color:C.steel,marginBottom:14}}>
                  L'ordine {codiceOrdine(selezionato)}{selezionato.cliente?` (${selezionato.cliente})`:""} verrà cancellato per sempre. L'operazione non è reversibile.
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>eliminaOrdine(selezionato.id)} style={{flex:1,padding:"12px",background:C.danger,color:"#fff",border:"none",borderRadius:8,fontSize:13.5,fontWeight:700,cursor:"pointer"}}>Sì, elimina definitivamente</button>
                  <button onClick={()=>setConfermaEliminaOrdine(false)} style={{flex:1,padding:"12px",background:"#fff",color:C.steel,border:`1px solid ${C.paperLine}`,borderRadius:8,fontSize:13.5,fontWeight:600,cursor:"pointer"}}>Annulla</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div style={S.eyebrow}>Ordini</div>
        {!creandoNuovo && <button onClick={()=>setCreandoNuovo(true)} style={{...S.btnAccent,padding:"9px 15px",fontSize:12.5}}>+ Nuovo ordine</button>}
      </div>
      {erroreSync && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginTop:14}}>⚠ {erroreSync}</div>}

      {creandoNuovo && (
        <div style={{...S.card,cursor:"default",border:`1px solid ${C.ink}`,marginTop:14,marginBottom:18}}>
          <div style={S.eyebrow}>Nuovo ordine (senza preventivo)</div>
          <div style={{fontSize:11.5,color:"#9AA3AB",marginTop:4,marginBottom:12,lineHeight:1.5}}>
            Per ordini nati fuori dal normale ciclo preventivo → conferma. Entrerà comunque in
            "Inserito", con lo stesso modulo logistico degli altri.
          </div>

          {nuovoClienteLibero ? (
            <div style={{marginBottom:12}}>
              <input value={nuovoNomeClienteLibero} onChange={e=>setNuovoNomeClienteLibero(e.target.value)} placeholder="Ragione sociale / nome cliente" style={{...S.inp,marginBottom:8}} autoFocus/>
              <button onClick={()=>{ setNuovoClienteLibero(false); setNuovoNomeClienteLibero(""); }} style={{...S.btnS,padding:"6px 11px",fontSize:11.5}}>← Cerca in anagrafica</button>
            </div>
          ) : (
            <div style={{marginBottom:12}}>
              <SelezioneCliente clienteSelezionato={nuovoCliente} onSeleziona={setNuovoCliente} sessione={sessione}/>
              {!nuovoCliente && (
                <button onClick={()=>setNuovoClienteLibero(true)} style={{...S.btnS,marginTop:8,padding:"7px 12px",fontSize:12}}>+ Cliente non in anagrafica</button>
              )}
            </div>
          )}

          <RicercaProdottiInline onSeleziona={aggiungiRigaNuovoOrdine} righeEsistenti={nuoveRighe} ruolo={ruolo} catalog={catalog} sessione={sessione}/>

          {nuoveRighe.length>0 && (
            <div style={{marginBottom:12}}>
              {nuoveRighe.map(r=>(
                <div key={r.cod} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.paperLine}`}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:12.5}}>{r.nome}</div>
                    <div className="tnum" style={{fontSize:11,color:"#9AA3AB"}}>€{r.netto.toFixed(2)} × {r.qty||1}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    <span className="tnum" style={{fontWeight:700,fontFamily:F_MONO,fontSize:13}}>€{(r.netto*(r.qty||1)).toFixed(2)}</span>
                    <button onClick={()=>rimuoviRigaNuovoOrdine(r.cod)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:15}}>✕</button>
                  </div>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",fontWeight:700,fontSize:13.5}}>
                <span>Totale</span>
                <span className="tnum" style={{fontFamily:F_MONO,color:C.ink}}>€{ricalcolaVal(nuoveRighe).toFixed(2)}</span>
              </div>
            </div>
          )}

          {erroreNuovo && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:10}}>⚠ {erroreNuovo}</div>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={salvaNuovoOrdine} disabled={!nomeClienteNuovoOrdine||nuoveRighe.length===0||salvandoNuovo} style={{...S.btnAccent,padding:"10px 16px",opacity:(!nomeClienteNuovoOrdine||nuoveRighe.length===0)?0.4:1}}>
              {salvandoNuovo?"Salvo…":"Crea ordine"}
            </button>
            <button onClick={annullaNuovoOrdine} style={{...S.btnS,padding:"10px 16px"}}>Annulla</button>
          </div>
        </div>
      )}

      {ordini.length===0 && !creandoNuovo && (
        <div style={{textAlign:"center",padding:"2.5rem 1rem",color:"#9AA3AB"}}>
          <div style={{fontSize:28,marginBottom:8}}>⬡</div>
          <div style={{fontSize:13}}>Nessun ordine ancora</div>
          <div style={{fontSize:11.5,marginTop:4}}>Gli ordini nascono dai preventivi confermati, o si creano da qui</div>
        </div>
      )}
      {ordini.map(o=>(
        <div key={o.id} onClick={()=>setSelId(o.id)} style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
          <div style={{minWidth:0}}>
            <div className="tnum" style={{fontSize:10.5,color:"#9AA3AB",fontFamily:F_MONO}}>{codiceOrdine(o)}</div>
            <div style={{fontWeight:600,fontSize:13.5,marginTop:2}}>{o.cliente}</div>
            <div style={{fontSize:11.5,color:"#8A929A",marginTop:1}}>{o.righe.length} articol{o.righe.length===1?"o":"i"} · {o.creato_il ? new Date(o.creato_il).toLocaleDateString("it-IT") : ""}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div className="tnum" style={{fontWeight:700,fontSize:14,fontFamily:F_MONO}}>€{o.val.toLocaleString("it-IT")}</div>
            <Tag tone={toneOrdine(o.stato)} style={{marginTop:5}}>{o.stato}</Tag>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── INTERVENTI ───────────────────────────────────────────────────────────────
function Interventi({interventi, setInterventi, attrezzature, sessione, setArea, setInterventoDaCompletare}){
  const accessToken = trovaAccessToken(sessione);
  const [modificaBloccoId,setModificaBloccoId] = useState(null);
  const [notaBlocco,setNotaBlocco] = useState("");
  const pianificati = (interventi||[]).filter(i=>i.stato==="Pianificato")
    .sort((a,b)=>new Date(a.data_pianificata||"9999-12-31")-new Date(b.data_pianificata||"9999-12-31"));
  const completati = (interventi||[]).filter(i=>i.stato==="Completato")
    .sort((a,b)=>new Date(b.completato_il||0)-new Date(a.completato_il||0)).slice(0,15);

  // Segnala/rimuove il flag "manca qualcosa per chiudere" (vedi Promemoria):
  // scrittura diretta come le altre su interventi, nessuna Edge Function.
  async function salvaManca(i, mancaInfo, nota){
    const payload = { manca_info: mancaInfo, nota_manca_info: mancaInfo ? (nota.trim()||null) : null };
    try{
      await sbAuth("PATCH","interventi",`id=eq.${i.id}`,payload,accessToken);
      setInterventi(prev=>prev.map(x=>x.id===i.id?{...x,...payload}:x));
    }catch{ /* riprova al prossimo tocco, non blocchiamo l'interfaccia per questo */ }
    setModificaBloccoId(null); setNotaBlocco("");
  }

  // Promemoria scadenze attrezzature (aggiornamenti/verifiche): entro 30
  // giorni o già scadute, visibili qui a responsabili e tecnici.
  const scadenzePromemoria = useMemo(()=>{
    const elenco = [];
    (attrezzature||[]).filter(a=>a.stato!=="Dismessa").forEach(a=>{
      [["scadenza_aggiornamenti","Aggiornamento"],["scadenza_verifiche","Verifica di controllo"]].forEach(([campo,etichetta])=>{
        const stato = statoScadenza(a[campo]);
        if(stato && stato.vicina) elenco.push({ attrezzatura:a, etichetta, data:a[campo], ...stato });
      });
    });
    return elenco.sort((x,y)=>x.giorni-y.giorni);
  },[attrezzature]);

  function riga(i){
    const oggi = new Date(); oggi.setHours(0,0,0,0);
    const scaduto = i.stato==="Pianificato" && i.data_pianificata && new Date(i.data_pianificata) < oggi;
    return (
      <div key={i.id} style={{...S.card,...(scaduto?{borderColor:C.danger}:i.manca_info?{borderColor:C.warn}:{})}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div style={{minWidth:0}}>
            <div style={{display:"flex",gap:6,marginBottom:5,alignItems:"center",flexWrap:"wrap"}}>
              <Tag tone="primary">{TIPO_LABELS[i.tipo]||i.tipo}</Tag>
              {i.data_pianificata && <span className="tnum" style={{fontSize:10.5,color:scaduto?C.danger:"#9AA3AB",fontFamily:F_MONO,fontWeight:scaduto?700:400}}>{new Date(i.data_pianificata).toLocaleDateString("it-IT")}</span>}
              {i.manca_info && <Tag tone="warn">⚠ manca info</Tag>}
            </div>
            <div style={{fontWeight:600,fontSize:13.5}}>{i.cliente_nome || "Cliente non specificato"}</div>
            {i.note && <div style={{fontSize:11.5,color:"#8A929A",marginTop:2}}>{i.note}</div>}
            {i.manca_info && i.nota_manca_info && <div style={{fontSize:11.5,color:"#8a6418",marginTop:4}}>ⓘ {i.nota_manca_info}</div>}
          </div>
          <Tag tone={i.stato==="Completato"?"ok":i.priorita==="alta"?"danger":i.priorita==="media"?"warn":"steel"}>{i.stato==="Completato"?"✓ completato":i.priorita}</Tag>
        </div>
        {i.stato==="Pianificato" && (<>
          <div style={{marginTop:10,display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>{setInterventoDaCompletare(i); setArea("rapporti");}} style={{...S.btnS,padding:"7px 12px",fontSize:12}}>
              Compila rapporto e completa →
            </button>
            {i.manca_info ? (
              <button onClick={()=>salvaManca(i,false,"")} style={{...S.btnS,padding:"7px 12px",fontSize:12,color:"#8a6418",borderColor:C.warn,background:"rgba(217,164,65,0.08)"}}>
                ⚠ Rimuovi segnalazione
              </button>
            ) : (
              <button onClick={()=>{setModificaBloccoId(i.id); setNotaBlocco("");}} style={{...S.btnS,padding:"7px 12px",fontSize:12}}>
                ⚠ Segnala: manca qualcosa
              </button>
            )}
          </div>
          {modificaBloccoId===i.id && (
            <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.paperLine}`}}>
              <textarea value={notaBlocco} onChange={e=>setNotaBlocco(e.target.value)} placeholder="Cosa manca per chiudere? (opzionale)" rows={2} style={{...S.inp,resize:"vertical",marginBottom:8}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>salvaManca(i,true,notaBlocco)} style={{...S.btnAccent,padding:"7px 12px",fontSize:12}}>Conferma</button>
                <button onClick={()=>{setModificaBloccoId(null); setNotaBlocco("");}} style={{...S.btnS,padding:"7px 12px",fontSize:12}}>Annulla</button>
              </div>
            </div>
          )}
        </>)}
      </div>
    );
  }

  return (
    <div>
      {scadenzePromemoria.length>0 && (
        <div style={{marginBottom:24}}>
          <div style={S.eyebrow}>Scadenze attrezzature ({scadenzePromemoria.length})</div>
          {scadenzePromemoria.map((s,i)=>(
            <div key={i} style={{...S.card,cursor:"default",borderColor:s.scaduta?C.danger:C.warn}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13.5}}>{s.attrezzatura.nome_prodotto}</div>
                  <div style={{fontSize:11.5,color:"#8A929A",marginTop:2}}>S/N {s.attrezzatura.numero_serie} · {s.etichetta}</div>
                </div>
                <Tag tone={s.scaduta?"danger":"warn"}>{s.scaduta?`scaduta da ${Math.abs(s.giorni)}gg`:`tra ${s.giorni}gg`}</Tag>
              </div>
              <div className="tnum" style={{fontSize:11,color:"#9AA3AB",marginTop:6,fontFamily:F_MONO}}>{new Date(s.data).toLocaleDateString("it-IT")}</div>
            </div>
          ))}
        </div>
      )}

      <div style={S.eyebrow}>Pianificati ({pianificati.length})</div>
      {pianificati.length===0 ? (
        <div style={{fontSize:12.5,color:"#9AA3AB",padding:"8px 0",marginBottom:18}}>Nessun intervento pianificato — puoi crearne uno dalla scheda di un cliente.</div>
      ) : pianificati.map(riga)}


      {completati.length>0 && (
        <>
          <div style={{...S.eyebrow,marginTop:22}}>Completati di recente</div>
          {completati.map(riga)}
        </>
      )}
    </div>
  );
}

// ─── RAPPORTO TECNICO ─────────────────────────────────────────────────────────
function RapportoDemo({sessione, interventi, setInterventi, interventoDaCompletare, setInterventoDaCompletare}){
  const accessToken = trovaAccessToken(sessione);
  // Se si arriva da "Compila rapporto" su un intervento già pianificato, si
  // salta la scelta cliente/tipo (già noti) e si va dritti alla checklist.
  const daCompletare = interventoDaCompletare;
  const [step,setStep]=useState(daCompletare ? "checklist" : "dettagli");
  const [tipo,setTipo]=useState(daCompletare?.tipo || "");
  const [clienteSel,setClienteSel]=useState(daCompletare ? {codice:daCompletare.cliente_codice, ragione_sociale:daCompletare.cliente_nome} : null);
  const [checklist,setChecklist]=useState(daCompletare ? (CHECKLIST_TEMPLATES[daCompletare.tipo]||[]).map(v=>({voce:v,fatto:false})) : []);
  const [note,setNote]=useState("");
  const [salvando,setSalvando]=useState(false);
  const [errore,setErrore]=useState("");

  function setTipoIntervento(t){ setTipo(t); setChecklist((CHECKLIST_TEMPLATES[t]||[]).map(v=>({voce:v,fatto:false}))); }
  function toggle(i){setChecklist(prev=>prev.map((c,idx)=>idx===i?{...c,fatto:!c.fatto}:c));}

  function resetTutto(){
    setStep("dettagli"); setTipo(""); setClienteSel(null); setChecklist([]); setNote(""); setErrore("");
    setInterventoDaCompletare(null);
  }

  async function salvaRapporto(){
    setSalvando(true); setErrore("");
    const payloadComune = {
      tipo, checklist, note: note.trim() || null,
      stato: "Completato", completato_il: new Date().toISOString(),
    };
    try{
      if(daCompletare){
        // completa un intervento già pianificato: aggiorna lo stesso record
        await sbAuth("PATCH","interventi",`id=eq.${daCompletare.id}`,payloadComune,accessToken);
        setInterventi(prev=>prev.map(i=>i.id===daCompletare.id?{...i,...payloadComune}:i));
      } else {
        // rapporto nuovo, non legato a un intervento pianificato in precedenza
        const payload = {
          ...payloadComune,
          cliente_codice: clienteSel?.codice || null,
          cliente_nome: clienteSel?.ragione_sociale || "",
          priorita: "media",
          creato_da_nome: sessione?.nome || null,
        };
        const [salvato] = await sbAuth("POST","interventi","",payload,accessToken);
        setInterventi(prev=>[salvato,...prev]);
      }
      setStep("fatto");
    }catch(err){
      setErrore("Salvataggio non riuscito: "+err.message);
    }
    setSalvando(false);
  }

  if(step==="dettagli") return (
    <div>
      <div style={{fontFamily:F_DISPLAY,fontSize:18,fontWeight:600,marginBottom:16}}>NUOVO RAPPORTO</div>
      <div style={{marginBottom:14}}>
        <SelezioneCliente clienteSelezionato={clienteSel} onSeleziona={setClienteSel} sessione={sessione}/>
      </div>
      <div style={S.eyebrow}>Tipo intervento</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18}}>
        {Object.keys(TIPO_LABELS).map(t=>(
          <button key={t} onClick={()=>setTipoIntervento(t)} style={{
            border:`1px solid ${tipo===t?C.ink:C.paperLine}`,borderRadius:8,padding:"12px 8px",fontSize:12.5,cursor:"pointer",
            background:tipo===t?C.ink:"#fff",color:tipo===t?"#fff":"#5B6770",fontWeight:tipo===t?600:500
          }}>{TIPO_LABELS[t]}</button>
        ))}
      </div>
      <button onClick={()=>setStep("checklist")} disabled={!clienteSel||!tipo} style={{...S.btnAccent,opacity:(!clienteSel||!tipo)?0.4:1,width:"100%",padding:"13px"}}>Continua</button>
    </div>
  );

  if(step==="checklist") return (
    <div>
      <div style={{fontFamily:F_DISPLAY,fontSize:18,fontWeight:600,marginBottom:4}}>CHECKLIST · {TIPO_LABELS[tipo]?.toUpperCase()}</div>
      <div style={{fontSize:12.5,color:C.steel,marginBottom:16}}>{clienteSel?.ragione_sociale}</div>
      {errore && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>⚠ {errore}</div>}
      {checklist.map((c,i)=>(
        <label key={i} style={{display:"flex",gap:10,padding:"11px 0",borderBottom:`1px solid ${C.paperLine}`,cursor:"pointer",fontSize:13.5,alignItems:"center"}}>
          <input type="checkbox" checked={c.fatto} onChange={()=>toggle(i)} style={{width:17,height:17,accentColor:C.ink}}/>
          <span style={{color:c.fatto?C.charcoal:"#5B6770"}}>{c.voce}</span>
        </label>
      ))}
      <textarea value={note} onChange={e=>setNote(e.target.value)} rows={3} placeholder="Note sull'intervento (opzionale)" style={{...S.inp,resize:"vertical",fontFamily:F_BODY,marginTop:14}}/>
      <div style={{display:"flex",gap:8,marginTop:18}}>
        {!daCompletare && <button onClick={()=>setStep("dettagli")} style={S.btnS}>← Indietro</button>}
        <button onClick={salvaRapporto} disabled={salvando} style={{...S.btnAccent,flex:1,opacity:salvando?0.6:1}}>{salvando?"Salvo…":"✓ Salva rapporto"}</button>
      </div>
    </div>
  );

  return (
    <div style={{textAlign:"center",padding:"3.5rem 1rem"}}>
      <div style={{width:54,height:54,borderRadius:10,background:C.ok,color:"#fff",fontSize:26,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>✓</div>
      <div style={{fontFamily:F_DISPLAY,fontSize:18,fontWeight:600,marginBottom:6}}>RAPPORTO SALVATO</div>
      <div style={{fontSize:13,color:"#8A929A",marginBottom:20}}>Registrato per {clienteSel?.ragione_sociale}</div>
      <button onClick={resetTutto} style={S.btnP}>+ Nuovo rapporto</button>
    </div>
  );
}

// ─── CONDIZIONI ACQUISTO — pannello responsabile/admin ────────────────────────
function CondizioniAcquisto(){
  const [condizioni,setCondizioni]=useState(
    Object.entries(CONDIZIONI_ACQUISTO_MARCHIO).map(([mar,cond])=>({
      mar,
      sconto: cond.sconto,
      extra: cond.extra||0,
      edit: false,
      valSconto: cond.sconto,
      valExtra: cond.extra||0,
    }))
  );
  const [saved,setSaved]=useState(null);

  function setField(mar, field, v){
    setCondizioni(c=>c.map(r=>r.mar===mar?{...r,[field]:parseFloat(v)||0}:r));
  }
  function setEdit(mar, v){
    setCondizioni(c=>c.map(r=>r.mar===mar?{...r,edit:v,valSconto:r.sconto,valExtra:r.extra}:r));
  }
  function salva(mar){
    const riga = condizioni.find(r=>r.mar===mar);
    CONDIZIONI_ACQUISTO_MARCHIO[mar] = { sconto: riga.valSconto, extra: riga.valExtra };
    setCondizioni(c=>c.map(r=>r.mar===mar?{...r,sconto:riga.valSconto,extra:riga.valExtra,edit:false}:r));
    setSaved(mar);
    setTimeout(()=>setSaved(null),2000);
  }

  return (
    <div>
      <div style={{fontFamily:F_DISPLAY,fontSize:18,fontWeight:600,marginBottom:4}}>CONDIZIONI DI ACQUISTO</div>
      <div style={{fontSize:12.5,color:"#8A929A",marginBottom:8,lineHeight:1.6}}>
        Condizioni standard per marchio. Per costi esclusivi su singoli articoli, apri la scheda prodotto nel preventivo.
      </div>
      <div style={{fontSize:12,color:"#9AA3AB",background:C.paper,borderRadius:6,padding:"8px 10px",marginBottom:18}}>
        💡 L'extra sconto si applica a cascata: 50% + 5% extra = costo al 47,5% del listino, non 45%.
      </div>

      {condizioni.map(r=>{
        const eff = scontoEffettivo(r.sconto, r.extra);
        return (
          <div key={r.mar} style={{...S.card,cursor:"default"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:r.edit?12:0}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:13}}>{r.mar}</div>
                {!r.edit && (
                  <div style={{display:"flex",gap:8,alignItems:"center",marginTop:3,flexWrap:"wrap"}}>
                    <span className="tnum" style={{fontSize:12,color:"#9AA3AB",fontFamily:F_MONO}}>
                      {r.sconto.toFixed(1)}%
                      {r.extra>0 && <> + <span style={{color:C.ink,fontWeight:700}}>{r.extra.toFixed(1)}% extra</span></>}
                    </span>
                    <span style={{fontSize:10.5,color:C.steel,fontFamily:F_MONO}}>→ eff. {eff.toFixed(2)}%</span>
                    {saved===r.mar && <span style={{color:C.ok,fontSize:11}}>✓ Salvato</span>}
                  </div>
                )}
              </div>
              {!r.edit && (
                <button onClick={()=>setEdit(r.mar,true)} style={S.btnS}>Modifica</button>
              )}
            </div>

            {r.edit && (
              <div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:10}}>
                  <div>
                    <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>Sconto base % (sul listino)</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <input type="number" step="0.5" min="0" max="80"
                        value={r.valSconto}
                        onChange={e=>setField(r.mar,"valSconto",e.target.value)}
                        className="tnum"
                        style={{...S.inp,fontFamily:F_MONO,fontWeight:700,padding:"8px 10px"}}
                      />
                      <span style={{fontSize:13,color:"#9AA3AB",flexShrink:0}}>%</span>
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>Extra sconto % (a cascata)</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <input type="number" step="0.5" min="0" max="30"
                        value={r.valExtra}
                        onChange={e=>setField(r.mar,"valExtra",e.target.value)}
                        className="tnum"
                        style={{...S.inp,fontFamily:F_MONO,fontWeight:700,padding:"8px 10px"}}
                      />
                      <span style={{fontSize:13,color:"#9AA3AB",flexShrink:0}}>%</span>
                    </div>
                  </div>
                </div>

                {/* Anteprima dell'effetto combinato */}
                <div style={{background:"rgba(22,39,88,0.06)",borderRadius:8,padding:"10px 12px",marginBottom:12}}>
                  <div style={{fontSize:11,color:"#6B7280",marginBottom:6}}>Anteprima su listino €1.000,00</div>
                  <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                    <div>
                      <div style={{fontSize:10,color:"#9AA3AB"}}>Dopo sconto base</div>
                      <div className="tnum" style={{fontFamily:F_MONO,fontWeight:600,fontSize:13}}>
                        €{(1000*(1-r.valSconto/100)).toFixed(2)}
                      </div>
                    </div>
                    {r.valExtra>0 && (
                      <div>
                        <div style={{fontSize:10,color:"#9AA3AB"}}>Dopo extra {r.valExtra}%</div>
                        <div className="tnum" style={{fontFamily:F_MONO,fontWeight:700,fontSize:13,color:C.ink}}>
                          €{(1000*(1-r.valSconto/100)*(1-r.valExtra/100)).toFixed(2)}
                        </div>
                      </div>
                    )}
                    <div>
                      <div style={{fontSize:10,color:"#9AA3AB"}}>Sconto effettivo</div>
                      <div className="tnum" style={{fontFamily:F_MONO,fontWeight:700,fontSize:13,color:C.ink}}>
                        {scontoEffettivo(r.valSconto,r.valExtra).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>salva(r.mar)} style={{...S.btnAccent,flex:1,padding:"10px"}}>✓ Salva</button>
                  <button onClick={()=>setEdit(r.mar,false)} style={{...S.btnS,padding:"10px"}}>Annulla</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── PANNELLO ADMIN ───────────────────────────────────────────────────────────
// Nota: né qui né altrove in App.jsx compare più la service_role key — import,
// export e svuotamento catalogo passano dalla Edge Function `catalog-admin`,
// che verifica lato server autenticazione e ruolo admin (stesso schema di
// `admin-users`, vedi GestioneUtenti più sopra).
async function chiamaCatalogAdmin(action, payload, accessToken) {
  if (!accessToken) throw new Error("Sessione non trovata: ricarica la pagina e rieffettua il login.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/catalog-admin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Edge Function ${res.status}`);
  return data;
}

// ─── GESTIONE UTENTI ──────────────────────────────────────────────────────────
// Crea/modifica/sospende/elimina utenti veri (Supabase Auth) e il relativo
// profilo (nome, cognome, ruolo) nella tabella `profili`. Solo per admin.
// Nessuna service_role key nel browser: tutte le operazioni passano dalla
// Edge Function `admin-users`, che verifica lato server che chi chiama sia
// autenticato e abbia ruolo admin (stesso schema usato da `catalog-admin`
// per import/export catalogo, vedi PannelloAdmin più sotto).
function generaPassword() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 12; i++) pw += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return pw;
}

// La sessione custom (Auth.jsx) conserva il token in un campo il cui nome può
// variare; questa funzione prova i nomi più comuni e, come ultima spiaggia,
// va a leggerlo dal localStorage. Se non trova nulla, meglio saperlo subito
// con un messaggio chiaro piuttosto che fallire in modo silenzioso.
function trovaAccessToken(sessione) {
  const diretto = sessione?.access_token || sessione?.accessToken || sessione?.token
    || sessione?.session?.access_token;
  if (diretto) return diretto;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.toLowerCase().includes("auth")) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const tok = parsed?.access_token || parsed?.session?.access_token || parsed?.currentSession?.access_token;
      if (tok) return tok;
    }
  } catch { /* ignora, gestito dal chiamante */ }
  return null;
}

// Chiama la Edge Function admin-users con l'azione richiesta, passando il
// token di sessione dell'utente loggato (verificato lato server).
async function chiamaAdminUsers(action, payload, accessToken) {
  if (!accessToken) throw new Error("Sessione non trovata: ricarica la pagina e rieffettua il login.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Edge Function ${res.status}`);
  return data;
}

function GestioneUtenti({ ruolo, sessione }) {
  const accessToken = trovaAccessToken(sessione);
  const vuoto = { email: "", password: generaPassword(), nome: "", cognome: "", ruolo: "commerciale" };
  const [utenti, setUtenti] = useState([]);
  const [caricando, setCaricando] = useState(true);
  const [msgGlobale, setMsgGlobale] = useState("");
  const [nuovoAperto, setNuovoAperto] = useState(false);
  const [f, setF] = useState(vuoto);
  const [statoCreazione, setStatoCreazione] = useState("idle"); // idle | salvo | fatto | errore
  const [msgCreazione, setMsgCreazione] = useState("");
  const [editId, setEditId] = useState(null);
  const [editBuf, setEditBuf] = useState({});
  const [pwResetId, setPwResetId] = useState(null);
  const [pwResetVal, setPwResetVal] = useState("");

  async function caricaUtenti() {
    setCaricando(true);
    setMsgGlobale("");
    try {
      const { utenti: lista } = await chiamaAdminUsers("list", {}, accessToken);
      setUtenti(lista || []);
    } catch (err) {
      setMsgGlobale("Errore nel caricamento utenti: " + err.message);
    }
    setCaricando(false);
  }

  useEffect(() => { if (ruolo === "admin") caricaUtenti(); }, [ruolo]);

  if (ruolo !== "admin") {
    return (
      <div style={{ ...S.card, cursor: "default" }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 16, fontWeight: 600 }}>Utenti</div>
        <div style={{ fontSize: 12.5, color: C.steel, marginTop: 6 }}>Funzione riservata al ruolo <b>Admin</b>.</div>
      </div>
    );
  }

  async function creaUtente() {
    setMsgCreazione("");
    if (!f.email.trim() || !f.email.includes("@")) { setStatoCreazione("errore"); setMsgCreazione("Inserisci un'email valida."); return; }
    if (!f.password || f.password.length < 8) { setStatoCreazione("errore"); setMsgCreazione("La password deve avere almeno 8 caratteri."); return; }
    if (!f.nome.trim() || !f.cognome.trim()) { setStatoCreazione("errore"); setMsgCreazione("Nome e cognome sono obbligatori."); return; }

    setStatoCreazione("salvo"); setMsgCreazione("Creazione in corso…");
    try {
      await chiamaAdminUsers("create", {
        email: f.email.trim(), password: f.password,
        nome: f.nome.trim(), cognome: f.cognome.trim(), ruolo: f.ruolo,
      }, accessToken);

      setStatoCreazione("fatto");
      setMsgCreazione(`Utente creato — comunica a ${f.nome} queste credenziali (non verranno mostrate di nuovo): ${f.email.trim()} / ${f.password}`);
      setF({ ...vuoto, password: generaPassword() });
      caricaUtenti();
    } catch (err) {
      setStatoCreazione("errore");
      setMsgCreazione("Errore nella creazione: " + err.message);
    }
  }

  function apriModifica(u) {
    setEditId(u.id);
    setEditBuf({ nome: u.nome, cognome: u.cognome, ruolo: u.ruolo || "commerciale" });
  }

  async function salvaModifica(id) {
    try {
      await chiamaAdminUsers("update", {
        id, nome: editBuf.nome.trim(), cognome: editBuf.cognome.trim(), ruolo: editBuf.ruolo,
      }, accessToken);
      setEditId(null);
      caricaUtenti();
    } catch (err) {
      setMsgGlobale("Errore nel salvataggio: " + err.message);
    }
  }

  async function toggleSospensione(u) {
    try {
      await chiamaAdminUsers("toggleBan", { id: u.id, sospendi: !u.sospeso }, accessToken);
      caricaUtenti();
    } catch (err) {
      setMsgGlobale("Errore: " + err.message);
    }
  }

  async function confermaResetPassword(id) {
    if (!pwResetVal || pwResetVal.length < 8) { setMsgGlobale("La nuova password deve avere almeno 8 caratteri."); return; }
    try {
      await chiamaAdminUsers("resetPassword", { id, password: pwResetVal }, accessToken);
      setMsgGlobale(`Password aggiornata. Comunicala all'utente: ${pwResetVal}`);
      setPwResetId(null); setPwResetVal("");
    } catch (err) {
      setMsgGlobale("Errore nel reset password: " + err.message);
    }
  }

  async function eliminaUtente(u) {
    if (!window.confirm(`Eliminare definitivamente l'utente ${u.email}? L'operazione non è reversibile.`)) return;
    try {
      await chiamaAdminUsers("delete", { id: u.id }, accessToken);
      caricaUtenti();
    } catch (err) {
      setMsgGlobale("Errore nell'eliminazione: " + err.message);
    }
  }

  const lbl = { fontSize: 11, fontFamily: F_MONO, color: "#9AA3AB", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, display: "block" };
  const campo = (etichetta, node) => (
    <div style={{ marginBottom: 11 }}>
      <label style={lbl}>{etichetta}</label>
      {node}
    </div>
  );
  const ruoliBtn = (valore, onChange) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {Object.keys(RUOLI).map(k => {
        const on = valore === k;
        return (
          <button key={k} onClick={() => onChange(k)} style={{
            border: `1px solid ${on ? C.ink : C.paperLine}`, borderRadius: 7, padding: "7px 12px",
            fontSize: 12, cursor: "pointer", fontWeight: on ? 600 : 400,
            background: on ? C.ink : "#fff", color: on ? "#fff" : "#5B6770",
          }}>{RUOLI[k].label}</button>
        );
      })}
    </div>
  );

  return (
    <div>
      {!accessToken && (
        <div style={{ ...S.card, cursor: "default", marginBottom: 14, borderColor: C.warn }}>
          <div style={{ fontSize: 12.5, color: C.warn }}>
            ⚠ Non trovo il token di sessione (il nome del campo in Auth.jsx potrebbe essere diverso da quello atteso).
            Le azioni su questa pagina falliranno finché non viene allineato — vedi <code>trovaAccessToken()</code> in App.jsx.
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 16, fontWeight: 600 }}>Utenti</div>
          <div style={{ fontSize: 12.5, color: C.steel }}>{utenti.length} account{caricando ? " · caricamento…" : ""}</div>
        </div>
        <button onClick={() => setNuovoAperto(v => !v)} style={S.btnP}>
          {nuovoAperto ? "✕ Chiudi" : "+ Nuovo utente"}
        </button>
      </div>

      {msgGlobale && (
        <div style={{ fontSize: 12, fontFamily: F_MONO, color: C.danger, marginBottom: 12 }}>{msgGlobale}</div>
      )}

      {nuovoAperto && (
        <div style={{ ...S.card, cursor: "default", marginBottom: 16 }}>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 15, fontWeight: 600, marginBottom: 2 }}>Nuovo utente</div>
          <div style={{ fontSize: 12.5, color: C.steel, marginBottom: 14 }}>
            L'utente potrà accedere subito con queste credenziali (nessuna email viene inviata automaticamente).
          </div>
          {campo("Email *", <input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="nome.cognome@telos.it" style={S.inp} />)}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>{campo("Nome *", <input value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} style={S.inp} />)}</div>
            <div style={{ flex: 1 }}>{campo("Cognome *", <input value={f.cognome} onChange={e => setF({ ...f, cognome: e.target.value })} style={S.inp} />)}</div>
          </div>
          {campo("Password iniziale *", (
            <div style={{ display: "flex", gap: 8 }}>
              <input value={f.password} onChange={e => setF({ ...f, password: e.target.value })} style={{ ...S.inp, fontFamily: F_MONO }} />
              <button onClick={() => setF({ ...f, password: generaPassword() })} style={S.btnS}>⟳ Rigenera</button>
            </div>
          ))}
          {campo("Ruolo", ruoliBtn(f.ruolo, v => setF({ ...f, ruolo: v })))}

          <button onClick={creaUtente} disabled={statoCreazione === "salvo"} style={{ ...S.btnP, width: "100%", padding: "12px", marginTop: 4, opacity: statoCreazione === "salvo" ? 0.6 : 1 }}>
            {statoCreazione === "salvo" ? "Creazione…" : "Crea utente"}
          </button>
          {msgCreazione && (
            <div style={{ marginTop: 12, fontSize: 12, fontFamily: F_MONO, color: statoCreazione === "errore" ? C.danger : statoCreazione === "fatto" ? C.ok : C.steel, wordBreak: "break-word" }}>
              {statoCreazione === "errore" ? "● " : statoCreazione === "fatto" ? "✓ " : "… "}{msgCreazione}
            </div>
          )}
        </div>
      )}

      {utenti.map(u => (
        <div key={u.id} style={{ ...S.card, cursor: "default" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.charcoal }}>
                {u.nome || u.cognome ? `${u.nome} ${u.cognome}`.trim() : "(profilo incompleto)"}
                {u.sospeso && <span style={{ marginLeft: 8, fontSize: 10.5, fontFamily: F_MONO, color: C.danger, border: `1px solid ${C.danger}`, borderRadius: 5, padding: "1px 6px" }}>SOSPESO</span>}
              </div>
              <div style={{ fontSize: 12, color: C.steel, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
              <div style={{ fontSize: 11, fontFamily: F_MONO, color: "#9AA3AB", marginTop: 3 }}>
                {u.ruolo ? RUOLI[u.ruolo]?.label || u.ruolo : "— nessun ruolo —"}
                {u.ultimoAccesso ? ` · ultimo accesso ${new Date(u.ultimoAccesso).toLocaleDateString("it-IT")}` : " · mai acceduto"}
              </div>
            </div>
            {editId !== u.id && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => apriModifica(u)} style={S.btnS}>Modifica</button>
              </div>
            )}
          </div>

          {editId === u.id && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.paperLine}` }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>{campo("Nome", <input value={editBuf.nome} onChange={e => setEditBuf({ ...editBuf, nome: e.target.value })} style={S.inp} />)}</div>
                <div style={{ flex: 1 }}>{campo("Cognome", <input value={editBuf.cognome} onChange={e => setEditBuf({ ...editBuf, cognome: e.target.value })} style={S.inp} />)}</div>
              </div>
              {campo("Ruolo", ruoliBtn(editBuf.ruolo, v => setEditBuf({ ...editBuf, ruolo: v })))}

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button onClick={() => salvaModifica(u.id)} style={{ ...S.btnAccent, flex: 1, padding: "10px" }}>✓ Salva</button>
                <button onClick={() => setEditId(null)} style={{ ...S.btnS, padding: "10px" }}>Annulla</button>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: pwResetId === u.id ? 8 : 0 }}>
                <button onClick={() => toggleSospensione(u)} style={{ ...S.btnS, color: u.sospeso ? C.ok : C.warn }}>
                  {u.sospeso ? "Riattiva accesso" : "Sospendi accesso"}
                </button>
                <button onClick={() => { setPwResetId(pwResetId === u.id ? null : u.id); setPwResetVal(generaPassword()); }} style={S.btnS}>
                  Reimposta password
                </button>
                <button onClick={() => eliminaUtente(u)} style={{ ...S.btnS, color: C.danger }}>Elimina utente</button>
              </div>

              {pwResetId === u.id && (
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <input value={pwResetVal} onChange={e => setPwResetVal(e.target.value)} style={{ ...S.inp, fontFamily: F_MONO }} />
                  <button onClick={() => setPwResetVal(generaPassword())} style={S.btnS}>⟳</button>
                  <button onClick={() => confermaResetPassword(u.id)} style={S.btnAccent}>Conferma</button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {!caricando && utenti.length === 0 && (
        <div style={{ fontSize: 12.5, color: C.steel, textAlign: "center", padding: "20px 0" }}>Nessun utente trovato.</div>
      )}
    </div>
  );
}

// ─── GESTIONE CATEGORIE ────────────────────────────────────────────────────
// Elenco delle categorie derivate dai prodotti reali, con la possibilità di
// rinominare/unire una categoria in un'altra (risolve doppioni come
// "Battery"/"BATTERY" nati da un refuso nel campo libero di CreaProdotto).
function GestioneCategorie({ sessione, categorie, ricarica }) {
  const accessToken = trovaAccessToken(sessione);
  const [origine, setOrigine] = useState("");
  const [destinazione, setDestinazione] = useState("");
  const [stato, setStato] = useState("idle"); // idle | salvo | fatto | errore
  const [msg, setMsg] = useState("");
  const [confermaAperta, setConfermaAperta] = useState(false);
  const [normalizzando, setNormalizzando] = useState(false);
  const [msgNorm, setMsgNorm] = useState("");

  async function normalizzaTutte() {
    setNormalizzando(true);
    setMsgNorm("Controllo in corso…");
    try {
      const { aggiornati, cambi } = await chiamaCatalogAdmin("normalizzaCategorie", {}, accessToken);
      if (!cambi || cambi.length === 0) {
        setMsgNorm("Tutte le categorie erano già normalizzate — nessuna modifica necessaria.");
      } else {
        const dettaglio = cambi.map(c => `"${c.da}" → "${c.a}" (${c.righe})`).join(", ");
        setMsgNorm(`Fatto: ${aggiornati} prodotti aggiornati. ${dettaglio}`);
      }
      ricarica();
    } catch (err) {
      setMsgNorm("Errore: " + err.message);
    }
    setNormalizzando(false);
  }

  async function esegui() {
    setStato("salvo"); setMsg("Aggiornamento in corso…");
    try {
      const { aggiornati } = await chiamaCatalogAdmin(
        "rinominaCategoria", { vecchia: origine, nuova: destinazione.trim() }, accessToken
      );
      setStato("fatto");
      setMsg(`Fatto: ${aggiornati ?? 0} prodotti spostati da "${origine}" a "${destinazione.trim()}".`);
      setOrigine(""); setDestinazione("");
      setConfermaAperta(false);
      ricarica();
    } catch (err) {
      setStato("errore");
      setMsg("Errore: " + err.message);
      setConfermaAperta(false);
    }
  }

  const contaOrigine = categorie.find(c => c.categoria === origine)?.n ?? 0;
  const pronto = origine && destinazione.trim() && origine !== destinazione.trim();

  return (
    <div>
      <div style={{fontSize:13,color:"#5B6770",marginBottom:16,lineHeight:1.6}}>
        Le categorie qui sotto sono quelle attualmente presenti nel catalogo (derivate direttamente
        dai prodotti). Se ne vedi due che dovrebbero essere una sola — es. per una differenza di
        maiuscole/minuscole o uno spazio — usa "Rinomina/unisci" per spostare tutti i prodotti dall'una
        all'altra in un colpo solo.
      </div>

      <div style={{...S.card,cursor:"default",marginBottom:16}}>
        <div style={S.eyebrow}>Normalizzazione automatica</div>
        <div style={{fontSize:12.5,color:C.steel,marginTop:6,marginBottom:10,lineHeight:1.6}}>
          Da ora ogni nuova categoria (dal form o da import CSV) viene salvata automaticamente in
          MAIUSCOLO senza spazi ai bordi, quindi non nasceranno più doppioni come "Battery"/"BATTERY".
          Questo pulsante sistema in un colpo solo eventuali doppioni di questo tipo già presenti nel catalogo.
        </div>
        <button onClick={normalizzaTutte} disabled={normalizzando} style={{...S.btnS,padding:"9px 15px",opacity:normalizzando?0.5:1}}>
          {normalizzando?"Normalizzo…":"Normalizza tutte le categorie"}
        </button>
        {msgNorm && <div style={{fontSize:12,color:C.steel,marginTop:10}}>{msgNorm}</div>}
      </div>

      <div style={{...S.card,cursor:"default",marginBottom:16}}>
        <div style={S.eyebrow}>Rinomina / unisci categorie</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginTop:8}}>
          <div style={{flex:"1 1 200px"}}>
            <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>Da</label>
            <select value={origine} onChange={e=>{setOrigine(e.target.value); setMsg("");}} style={S.inp}>
              <option value="">— seleziona —</option>
              {categorie.map(c=>(<option key={c.categoria} value={c.categoria}>{c.categoria} ({c.n})</option>))}
            </select>
          </div>
          <div style={{flex:"1 1 220px"}}>
            <label style={{fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",display:"block",marginBottom:4}}>A (nome nuovo o categoria esistente)</label>
            <input value={destinazione} onChange={e=>{setDestinazione(e.target.value); setMsg("");}} placeholder="es. BATTERY" style={S.inp} list="categorie-destinazione"/>
            <datalist id="categorie-destinazione">
              {categorie.map(c=>(<option key={c.categoria} value={c.categoria}/>))}
            </datalist>
          </div>
          <button onClick={()=>setConfermaAperta(true)} disabled={!pronto||stato==="salvo"} style={{...S.btnAccent,padding:"10px 16px",opacity:!pronto?0.4:1}}>
            Applica
          </button>
        </div>
        {msg && <div style={{fontSize:12,color:stato==="errore"?C.warn:C.steel,marginTop:10}}>{msg}</div>}
      </div>

      {confermaAperta && (
        <div style={{...S.card,cursor:"default",border:`1px solid ${C.warn}`,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>Confermi lo spostamento?</div>
          <div style={{fontSize:12.5,color:C.steel,marginBottom:12}}>
            Sposti <strong>{contaOrigine} prodotti</strong> dalla categoria "<strong>{origine}</strong>" a
            "<strong>{destinazione.trim()}</strong>". L'operazione va poi corretta manualmente se sbagliata.
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={esegui} disabled={stato==="salvo"} style={{...S.btnAccent,padding:"8px 14px"}}>
              {stato==="salvo"?"Applico…":"Sì, conferma"}
            </button>
            <button onClick={()=>setConfermaAperta(false)} style={{...S.btnS,padding:"8px 14px"}}>Annulla</button>
          </div>
        </div>
      )}

      <div style={S.eyebrow}>Categorie attuali ({categorie.length})</div>
      <div style={{display:"flex",flexDirection:"column",marginTop:8}}>
        {categorie.length===0 && <div style={{fontSize:12,color:C.steel,padding:"8px 4px"}}>Nessuna categoria trovata.</div>}
        {categorie.map(c=>(
          <div key={c.categoria} style={{display:"flex",justifyContent:"space-between",padding:"8px 4px",borderBottom:`1px solid ${C.paperLine}`,fontSize:13}}>
            <span>{c.categoria}</span>
            <span className="tnum" style={{color:C.steel}}>{c.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── GESTIONE LOGISTICA ORDINI ─────────────────────────────────────────────
// Matrice categoria × campo: per ogni categoria di prodotto, quali dei 5
// casi logistici (vedi CAMPI_LOGISTICA_ORDINE) diventano obbligatori da
// compilare quando un ordine contiene almeno un prodotto di quella
// categoria. Letto da Ordini al momento dell'invio; scritto solo qui.
// Scrittura riservata all'admin via RLS-role-check (nessuna Edge Function,
// stesso schema già usato per le eliminazioni per ruolo).
function GestioneLogisticaOrdini({ sessione, categorie }){
  const accessToken = trovaAccessToken(sessione);
  const [config,setConfig] = useState({}); // {categoria: {rottamazione,...}}
  const [caricando,setCaricando] = useState(true);
  const [salvando,setSalvando] = useState(false);
  const [msg,setMsg] = useState("");

  useEffect(()=>{
    sbGetAuth("categorie_logistica_obbligatoria","select=*",accessToken)
      .then(righe=>{
        const mappa={};
        (righe||[]).forEach(r=>{ mappa[r.categoria]=r; });
        setConfig(mappa);
        setCaricando(false);
      })
      .catch(()=>setCaricando(false));
  },[]);

  function valore(categoria, campo){ return !!config[categoria]?.[campo]; }

  async function toggle(categoria, campo){
    const base = config[categoria] || {categoria, rottamazione:false, destinazione_diversa:false, mezzi_movimentazione:false, installazione:false, formazione:false};
    const esisteRiga = !!config[categoria];
    const nuovo = {...base, [campo]: !base[campo]};
    setConfig(prev=>({...prev,[categoria]:nuovo}));
    setSalvando(true); setMsg("");
    try{
      if(esisteRiga){
        await sbAuth("PATCH","categorie_logistica_obbligatoria",`categoria=eq.${encodeURIComponent(categoria)}`,{[campo]:nuovo[campo]},accessToken);
      } else {
        await sbAuth("POST","categorie_logistica_obbligatoria","",nuovo,accessToken);
      }
    }catch(err){
      setMsg("Errore: "+err.message);
      setConfig(prev=>({...prev,[categoria]:base})); // rollback
    }
    setSalvando(false);
  }

  return (
    <div>
      <div style={{fontSize:13,color:"#5B6770",marginBottom:16,lineHeight:1.6}}>
        Per ogni categoria di prodotto, scegli quali campi del modulo "Prima dell'invio" (in Ordini)
        diventano <strong>obbligatori</strong> quando l'ordine contiene almeno un prodotto di quella
        categoria. Chi prepara l'invio dovrà rispondere sì/no a quei campi prima di poter procedere —
        gli altri restano facoltativi.
      </div>
      {msg && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>⚠ {msg}</div>}
      {caricando && <div style={{fontSize:12.5,color:C.steel}}>Caricamento…</div>}
      {!caricando && categorie.length===0 && (
        <div style={{fontSize:12.5,color:C.steel,padding:"8px 0"}}>Nessuna categoria trovata nel catalogo.</div>
      )}
      {!caricando && categorie.length>0 && (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
            <thead>
              <tr>
                <th style={{textAlign:"left",padding:"8px 10px 8px 6px",borderBottom:`2px solid ${C.paperLine}`,fontFamily:F_MONO,fontSize:10.5,color:"#9AA3AB",textTransform:"uppercase",whiteSpace:"nowrap"}}>Categoria</th>
                {CAMPI_LOGISTICA_ORDINE.map(c=>(
                  <th key={c.chiave} style={{textAlign:"center",padding:"8px 6px",borderBottom:`2px solid ${C.paperLine}`,fontFamily:F_MONO,fontSize:10,color:"#9AA3AB",whiteSpace:"nowrap"}}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categorie.map(c=>(
                <tr key={c.categoria}>
                  <td style={{padding:"9px 6px",borderBottom:`1px solid ${C.paperLine}`,fontWeight:600,whiteSpace:"nowrap"}}>{c.categoria}</td>
                  {CAMPI_LOGISTICA_ORDINE.map(campo=>(
                    <td key={campo.chiave} style={{textAlign:"center",padding:"9px 6px",borderBottom:`1px solid ${C.paperLine}`}}>
                      <input type="checkbox" checked={valore(c.categoria,campo.chiave)} onChange={()=>toggle(c.categoria,campo.chiave)} disabled={salvando} style={{width:16,height:16,cursor:"pointer"}}/>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── GESTIONE PREZZI DA FORNITORE ──────────────────────────────────────────
// Incolla un elenco "codice,prezzo" (es. estratto da un listino PDF di un
// fornitore) e aggiorna in blocco SOLO il listino (e opzionalmente anche
// netto/sconto/tipo_prezzo) dei prodotti già presenti in catalogo — nessun
// inserimento di articoli nuovi, nessun'altra colonna toccata. Scrittura
// via Edge Function catalog-admin (azione "aggiornaPrezzi", admin-only).
const GEATEK_MAGGIO_2026 = `GEA10030,3850.00
GEA10805,745.00
GEA10809,2845.00
GEA10901,2500.00
GEA10903,1700.00
GEA11000,225.00
GEA12005-001,13.50
GEA12005-005,59.50
GEA12005-020,233.50
GEA12005-206,2018.00
GEA12006-001,13.50
GEA12006-005,59.50
GEA12006-020,233.50
GEA12006-206,2018.00
GEA12007-001,14.50
GEA12007-005,60.00
GEA12007-020,228.50
GEA12007-206,1981.00
GEA12008-001,15.00
GEA12008-005,69.50
GEA12008-020,267.50
GEA12008-206,2376.00
GEA12109,14.50
GEA12010,9.00
GEA12011,14.00
GEA12012,14.00
GEA12501-020,92.50
GEA12502,16.00
GEA12801,25.00
GEA12802,25.00
GEA12805,19.00
GEA12806,19.00
GEA12808,25.00
GEA12901-010,105.00
GEA13001,17.00
GEA13003,92.50
GEA13004,61.50
GEA13005,12.50
GEA13006,17.00
GEA13007,12.50
GEA13008,20.00
GEA13009,18.50
GEA13010,29.50
GEA13016,14.00
GEA13020,12.50
GEA13021,17.00
GEA13028,37.00
GEA13029,20.00
GEA13031,14.00
GEA13032,20.00
GEA13033,20.00
GEA13043,14.00
GEA13044,8.00
GEA13045,15.50
GEA13046,15.50
GEA13047,57.00
GEA13048,55.50
GEA13049,57.00
GEA13050,57.00
GEA13053,34.00
GEA13054,20.00
GEA13056,26.50
GEA13057,17.00
GEA13058,46.50
GEA13062,46.50
GEA13063,18.50
GEA13064,45.00
GEA13065,28.00
GEA13066,17.00
GEA13068,38.50
GEA13069,40.00
GEA13070,40.00
GEA13071,43.50
GEA13072,40.00
GEA13073,40.00
GEA13074,54.00
GEA13075,37.00
GEA13076,49.50
GEA13077,20.00
GEA13078,11.00
GEA13079,20.00
GEA13080,11.00
GEA13081,49.50
GEA13082,52.50
GEA13083,26.50
GEA13084,12.50
GEA13085,17.00
GEA13086,21.50
GEA13087,23.50
GEA13088,55.50
GEA13089,11.00
GEA13090,57.00
GEA13091,52.50
GEA13092,28.00
GEA13093,14.00
GEA13094,43.50
GEA13095,43.50
GEA13096,12.50
GEA13097,17.00
GEA13098,23.50
GEA13099,52.50
GEA13100,46.50
GEA13101,34.00
GEA13102,29.50
GEA13103,46.50
GEA13104,22.00
GEA13105,15.50
GEA13106,8.00
GEA13107,46.50
GEA13108,55.50
GEA13109,22.00
GEA13110,52.50
GEA13111,20.00
GEA13112,22.00
GEA13113,17.00
GEA13114,17.00
GEA13115,12.50
GEA13116,20.00
GEA13117,46.50
GEA13118,43.50
GEA13119,17.00
GEA13120,20.00
GEA13121,46.50
GEA13122,46.50
GEA13123,52.50
GEA13124,8.00
GEA13125,37.00
GEA13126,46.50
GEA13127,29.50
GEA13128,57.00
GEA13129,46.50
GEA13130,55.50
GEA13131,57.00
GEA13132,21.50
GEA13801,15.00
GEA13802,15.00
GEA13803,15.00
GEA13804,15.00
GEA13805,15.00
GEA13806,15.00
GEA13807,15.00
GEA13808,15.00
GEA13809,15.00
GEA13810,15.00
GEA13811,15.00
GEA13812,15.00
GEA13813,15.00
GEA13814,15.00
GEA13815,15.00
GEA13816,15.00
GEA13817,15.00
GEA13823,14.00
GEA13824,14.00
GEA13825,12.00
GEA13826,14.00
GEA13827,30.00
GEA13851,110.00
GEA13852,100.00
GEA13870,150.00
GEA13875,12.50
GEA13876,12.50
GEA13877,12.50
GEA13878,8.00
GEA13879,9.00
GEA13880,14.00
GEA13881,14.00
GEA13882,10.00
GEA14001,525.00
GEA14002,925.00
GEA14051,35.00
GEA14052,37.00
GEA14801,370.00
GEA14901,300.00
GEA14902,300.00
GEA15501,21.30
GEA15502,105.00
GEA15503,33.20
GEA15504,23.70
GEA15505,70.50
GEA15506,23.70
GEA15507,57.90
GEA15508,74.30
GEA15509,23.60
GEA15510,45.00
GEA15511,99.30
GEA15512,99.30
GEA15513,48.00
GEA15514,34.50
GEA15515,32.50
GEA15516,38.00
GEA15517,139.40
GEA15518,37.50
GEA15519,51.00
GEA15520,38.50
GEA15521,41.50
GEA15522,51.50
GEA15523,54.00
GEA15524,45.50
GEA15525,46.00
GEA15526,45.50
GEA15527,68.00
GEA15528,117.50
GEA15529,65.00
GEA15530,46.00
GEA15531,55.50
GEA15532,58.90
GEA15533,42.50
GEA15535,39.00
GEA15536,115.00
GEA15537,37.50
GEA15538,85.00
GEA15539,52.00
GEA15540,60.00
GEA15541,104.40
GEA15542,39.50
GEA15543,46.50
GEA15545,48.50
GEA15546,33.50
GEA15547,141.30
GEA15548,185.00
GEA15549,41.50
GEA15550,45.00
GEA15551,47.50
GEA15552,47.50
GEA15553,53.90
GEA15556,32.50
GEA15558,39.50
GEA15559,35.50
GEA15562,97.00
GEA15563,90.50
GEA15564,50.50
GEA15566,52.50
GEA15568,65.40
GEA15570,78.50
GEA15571,79.00
GEA15572,59.60
GEA15573,71.50
GEA15575,179.00
GEA15576,205.50
GEA15578,45.90
GEA15579,54.30
GEA15581,43.50
GEA15584,39.50
GEA15586,78.90
GEA15587,73.50
GEA15589,42.00
GEA15590,66.50
GEA15592,54.00
GEA15593,45.00
GEA15594,45.50
GEA15596,73.50
GEA15597,58.90
GEA15599,48.50
GEA15606,105.00
GEA15608,56.50
GEA15613,48.50
GEA15617,90.00
GEA15619,67.90
GEA15638,79.50
GEA15639,67.60
GEA15640,63.50
GEA15641,155.00
GEA15642,58.90
GEA15643,129.50
GEA15645,173.50
GEA15648,57.80
GEA15655,57.80
GEA15659,265.00
GEA15661,61.20
GEA15662,142.00
GEA15667,79.50
GEA15677,50.50
GEA15678,89.00
GEA15679,96.71
GEA15680,90.50
GEA15681,68.70
GEA15682,51.50
GEA15683,103.90
GEA15684,145.00
GEA15685,89.20
GEA15686,119.00
GEA15687,119.00
GEA15688,66.43
GEA15689,255.00
GEA15690,28.50
GEA15692,58.50
GEA15693,67.90
GEA15695,168.00
GEA15696,168.00
GEA16001,25.00
GEA16002,120.00
GEA16003,25.00
GEA16004,60.00
GEA16005,25.00
GEA16013,125.00
GEA17001,30.00
GEA17003,23.00
GEA17005,9.50`;

function parsePrezzo(raw){
  let s = (raw||"").replace(/[€\s]/g,"");
  if(s.includes(",") && s.includes(".")){
    if(s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g,"").replace(",",".");
    else s = s.replace(/,/g,"");
  } else if(s.includes(",")){
    s = s.replace(",",".");
  }
  return parseFloat(s);
}

function GestionePrezziFornitore({ sessione }){
  const accessToken = trovaAccessToken(sessione);
  const [testo,setTesto] = useState(GEATEK_MAGGIO_2026);
  const [nettoUguale,setNettoUguale] = useState(true);
  const [confermaAperta,setConfermaAperta] = useState(false);
  const [stato,setStato] = useState("idle"); // idle | salvo | fatto | errore
  const [msg,setMsg] = useState("");
  const [risultato,setRisultato] = useState(null); // {aggiornati, nonTrovati}

  const righeTotali = useMemo(()=>testo.split("\n").filter(r=>r.trim()).length,[testo]);
  const righeParsate = useMemo(()=>{
    return testo.split("\n").map(riga=>{
      const parti = riga.split(/[,;\t]/).map(p=>p.trim()).filter(Boolean);
      if(parti.length<2) return null;
      const cod = parti[0].replace(/\s+/g,"");
      const prezzo = parsePrezzo(parti[parti.length-1]);
      if(!cod || !isFinite(prezzo) || prezzo<=0) return null;
      return {cod, prezzo};
    }).filter(Boolean);
  },[testo]);

  async function applica(){
    setStato("salvo"); setMsg(""); setConfermaAperta(false);
    try{
      const payload = { righe: righeParsate };
      if(nettoUguale) payload.impostaCome = "netto_uguale";
      const { aggiornati, nonTrovati } = await chiamaCatalogAdmin("aggiornaPrezzi", payload, accessToken);
      setRisultato({ aggiornati, nonTrovati: nonTrovati||[] });
      setStato("fatto");
    }catch(err){
      setStato("errore");
      setMsg("Errore: "+err.message);
    }
  }

  return (
    <div>
      <div style={{fontSize:13,color:"#5B6770",marginBottom:16,lineHeight:1.6}}>
        Incolla un elenco <strong>codice,prezzo</strong> (una riga per articolo — virgola, punto e virgola o
        tab vanno bene, formato prezzo italiano o con il punto) da un listino fornitore. Aggiorna{" "}
        <strong>solo</strong> i prodotti già presenti nel catalogo (nessun inserimento di articoli nuovi) e{" "}
        <strong>solo</strong> le colonne prezzo — nome, categoria, immagine e tutto il resto restano invariati.
      </div>

      <textarea value={testo} onChange={e=>{setTesto(e.target.value); setRisultato(null); setStato("idle"); setConfermaAperta(false);}} rows={10} className="tnum" style={{...S.inp,fontFamily:F_MONO,fontSize:11.5,resize:"vertical",marginBottom:10}}/>

      <label style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:12.5,marginBottom:14,cursor:"pointer",lineHeight:1.4}}>
        <input type="checkbox" checked={nettoUguale} onChange={e=>setNettoUguale(e.target.checked)} style={{width:16,height:16,marginTop:1,flexShrink:0}}/>
        <span>Questo prezzo è già il Netto Telos (nessuno sconto ulteriore) — aggiorna anche il Netto, azzera lo sconto e imposta "Listino" come tipo prezzo. Se lasci deselezionato, viene toccato solo il Listino.</span>
      </label>

      <div style={{fontSize:12,color:C.steel,marginBottom:14}}>
        {righeParsate.length} righe valide riconosciute su {righeTotali} totali
        {righeParsate.length<righeTotali && <span style={{color:C.warn}}> — {righeTotali-righeParsate.length} righe ignorate (formato non riconosciuto)</span>}.
      </div>

      {msg && <div style={{fontSize:12,color:C.danger,background:"rgba(200,75,58,0.08)",borderRadius:6,padding:"9px 11px",marginBottom:14}}>⚠ {msg}</div>}

      {!confermaAperta ? (
        <button onClick={()=>setConfermaAperta(true)} disabled={righeParsate.length===0||stato==="salvo"} style={{...S.btnAccent,padding:"11px 18px",opacity:righeParsate.length===0?0.4:1}}>
          Applica a {righeParsate.length} prodotti
        </button>
      ) : (
        <div style={{...S.card,cursor:"default",border:`1px solid ${C.warn}`,background:"rgba(217,164,65,0.06)"}}>
          <div style={{fontSize:13.5,fontWeight:600,marginBottom:8}}>Confermi l'aggiornamento prezzi?</div>
          <div style={{fontSize:12.5,color:C.steel,marginBottom:12}}>
            Aggiorna il Listino{nettoUguale?" e il Netto Telos":""} di {righeParsate.length} prodotti (solo quelli
            già presenti in catalogo — i codici non trovati vengono segnalati, non creati). L'operazione va
            corretta manualmente se sbagliata.
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={applica} disabled={stato==="salvo"} style={{...S.btnAccent,padding:"9px 15px"}}>{stato==="salvo"?"Applico…":"Sì, applica"}</button>
            <button onClick={()=>setConfermaAperta(false)} style={{...S.btnS,padding:"9px 15px"}}>Annulla</button>
          </div>
        </div>
      )}

      {risultato && (
        <div style={{...S.card,cursor:"default",marginTop:16,border:`1px solid ${C.ok}`}}>
          <div style={{fontSize:13,fontWeight:600,color:C.ok,marginBottom:6}}>✓ Fatto: {risultato.aggiornati} prodotti aggiornati.</div>
          {risultato.nonTrovati.length>0 && (
            <div style={{fontSize:12,color:"#8a6418",lineHeight:1.5}}>
              {risultato.nonTrovati.length} codici non trovati nel catalogo (non toccati): {risultato.nonTrovati.slice(0,40).join(", ")}{risultato.nonTrovati.length>40?"…":""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PannelloAdmin({ setCatalog, ruolo, sessione }) {
  const accessToken = trovaAccessToken(sessione);
  const [tab, setTab] = useState("utenti");
  const [file, setFile] = useState(null);
  const [anteprima, setAnteprima] = useState(null);
  const [importando, setImportando] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, errori: 0 });
  const [log, setLog] = useState([]);
  const [esportando, setEsportando] = useState(false);
  const [conteggio, setConteggio] = useState(null);
  const [categorie, setCategorie] = useState([]);
  const [tipologie, setTipologie] = useState([]);
  const [marchi, setMarchi] = useState([]);
  const fileRef = useRef(null);

  function ricaricaCategorie() {
    chiamaCatalogAdmin("categorie", {}, accessToken)
      .then(d => setCategorie(d?.categorie ?? []))
      .catch(() => setCategorie([]));
  }
  function ricaricaTipologieMarchi() {
    chiamaCatalogAdmin("tipologie", {}, accessToken)
      .then(d => setTipologie(d?.tipologie ?? []))
      .catch(() => setTipologie([]));
    chiamaCatalogAdmin("marchi", {}, accessToken)
      .then(d => setMarchi(d?.marchi ?? []))
      .catch(() => setMarchi([]));
  }

  // Carica conteggio prodotti attuali
  useEffect(() => {
    chiamaCatalogAdmin("count", {}, accessToken)
      .then(d => setConteggio(d?.count ?? "—"))
      .catch(() => setConteggio("—"));
    ricaricaCategorie();
    ricaricaTipologieMarchi();
  }, [importando]);

  function addLog(msg, tipo = "info") {
    setLog(l => [...l, { msg, tipo, ts: new Date().toLocaleTimeString("it-IT") }]);
  }

  // Legge il file Excel/CSV caricato e mostra anteprima
  async function onFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setAnteprima(null);
    setLog([]);

    // Legge le prime righe per anteprima — usa lo stesso parser "vero"
    // dell'import, così l'anteprima non mostra dati spezzati per via di
    // descrizioni multi-riga (coerenza con avviaImport).
    const text = await f.text().catch(() => null);
    if (text) {
      const { headers, righe } = parseCSV(text);
      const campione = righe.slice(0, 5).map(r => headers.map(h => r[h] ?? ""));
      setAnteprima({ headers, campione, totale: righe.length, tipo: "csv" });
    }
  }

  // Parsing CSV con gestione campi quotati
  // Parser CSV "vero" — un semplice text.split("\n") romperebbe a metà i
  // campi tra virgolette che contengono un a-capo al loro interno (es. le
  // descrizioni per preventivo, scritte una caratteristica per riga), e
  // romperebbe anche i campi che contengono il separatore stesso tra
  // virgolette. Questo parser scorre il testo carattere per carattere e
  // rispetta le virgolette, come previsto dal formato CSV standard.
  function parseCSV(text) {
    const primaLinea = text.slice(0, (text.indexOf("\n") + 1 || text.length + 1) - 1);
    const sep = primaLinea.includes(";") ? ";" : primaLinea.includes("\t") ? "\t" : ",";

    const righeGrezze = [];
    let campo = "", riga = [], inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i+1] === '"') { campo += '"'; i++; }
          else { inQuotes = false; }
        } else {
          campo += c;
        }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === sep) { riga.push(campo); campo = ""; }
        else if (c === "\r") { /* ignorato, gestito da \n */ }
        else if (c === "\n") { riga.push(campo); campo = ""; righeGrezze.push(riga); riga = []; }
        else campo += c;
      }
    }
    if (campo !== "" || riga.length > 0) { riga.push(campo); righeGrezze.push(riga); } // ultima riga senza newline finale

    const righeValide = righeGrezze.filter(r => r.some(v => v !== ""));
    if (righeValide.length === 0) return { headers: [], righe: [] };

    const headers = righeValide[0].map(h => h.trim().toLowerCase());
    const righe = [];
    for (let i = 1; i < righeValide.length; i++) {
      const vals = righeValide[i];
      if (vals.length < 3) continue;
      const row = {};
      headers.forEach((h, idx) => row[h] = (vals[idx] ?? "").trim() || null);
      righe.push(row);
    }
    return { headers, righe };
  }

  // Il tipo di prezzo (e il relativo netto) sono derivati da QUALE colonna
  // di prezzo è valorizzata nella riga, non da un'etichetta testuale scritta
  // a mano — molto più veloce da compilare in Excel e senza rischio di
  // refusi ("Promo Telos" vs "promo_telos" vs "PROMO TELOS" ecc.).
  // Ordine di priorità se per errore più colonne fossero valorizzate insieme:
  // netto_telos > netto_fornitore > sconto (sconto base) > listino (default).
  // Per compatibilità resta anche il vecchio riconoscimento su una colonna
  // "tipo_prezzo" testuale, usato solo se nessuna delle colonne sopra è
  // valorizzata (file più vecchi che usano ancora quel formato).
  function normalizzaTipoPrezzo(v) {
    if (!v) return null;
    const s = String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (s.includes("promo") && s.includes("telos")) return "promo_telos";
    if (s.includes("promo") && (s.includes("fornitore") || s.includes("fornit"))) return "promo_fornitore";
    if (s.includes("sconto") && s.includes("base")) return "sconto_base";
    if (s.includes("listino")) return "listino";
    return null; // valore presente ma non riconosciuto — verrà segnalato nel log import
  }

  // Normalizza una riga CSV/Excel nel formato Supabase
  function normalizzaRiga(row) {
    const get = (...keys) => {
      for (const k of keys) {
        const v = row[k] || row[k?.toLowerCase()] || row[k?.toUpperCase()];
        if (v && v !== "null" && v !== "") return v;
      }
      return null;
    };
    const num = v => {
      if (!v) return null;
      const n = parseFloat(String(v).replace(",", "."));
      return isNaN(n) ? null : n;
    };
    const tronca = (v, max=500) => v ? String(v).slice(0, max) : null;

    const cod = get("cod", "codice", "code", "sku");
    if (!cod) return null;

    const listinoVal = num(get("listino", "prezzo_listino", "prezzo listino", "list_price"));
    const scontoVal = num(get("sconto", "discount", "sconto%"));
    const nettoTelos = num(get("netto_telos", "netto telos", "nettotelos"));
    const nettoFornitore = num(get("netto_fornitore", "netto fornitore", "nettofornitore"));
    const nettoGenerico = num(get("netto", "net_price", "prezzo_netto"));

    let tipoPrezzo, netto, prezzoAmbiguo = false;
    if (nettoTelos != null) {
      tipoPrezzo = "promo_telos"; netto = nettoTelos;
    } else if (nettoFornitore != null) {
      tipoPrezzo = "promo_fornitore"; netto = nettoFornitore;
    } else if (scontoVal) {
      tipoPrezzo = "sconto_base";
      netto = nettoGenerico ?? (listinoVal != null ? +(listinoVal * (1 - scontoVal / 100)).toFixed(2) : null);
    } else {
      const tipoPrezzoGrezzo = get("tipo_prezzo", "tipo prezzo", "prezzo_tipo", "tipo_listino",
        "tipologia_prezzo", "condizione", "condizione_prezzo", "tipo_promo", "promo");
      const tipoPrezzoNorm = normalizzaTipoPrezzo(tipoPrezzoGrezzo);
      tipoPrezzo = tipoPrezzoNorm || "listino";
      netto = nettoGenerico ?? listinoVal;
      prezzoAmbiguo = !!tipoPrezzoGrezzo && !tipoPrezzoNorm;
    }

    return {
      cod: String(cod).trim(),
      nome: tronca(get("nome", "name", "descrizione_breve") || get("descrizione", "description"), 500),
      descrizione: tronca(get("descrizione", "description", "desc"), 1000),
      desc_prev: tronca(get("desc_prev", "descrizione_preventivo", "descrizione preventivo"), 500),
      categoria: tronca(get("categoria", "category", "cat"), 100),
      marchio: tronca(get("marchio", "brand", "mar"), 100),
      tipologia: tronca(get("tipologia", "tipo", "tip"), 100),
      um: get("um", "unita", "unit") || "pz",
      listino: listinoVal,
      sconto: scontoVal ?? 0,
      netto: netto,
      tipo_prezzo: tipoPrezzo,
      _tipoPrezzoDaVerificare: prezzoAmbiguo,
      note: tronca(get("note", "notes"), 500),
      attivo: true,
    };
  }

  async function avviaImport() {
    if (!file) return;
    setImportando(true);
    setLog([]);
    setProgress({ done: 0, total: 0, errori: 0 });

    try {
      addLog("Lettura file in corso…");
      const text = await file.text();
      const { righe } = parseCSV(text);
      const prodottiGrezzi = righe.map(normalizzaRiga).filter(Boolean);

      if (prodottiGrezzi.length === 0) {
        addLog("Nessun prodotto valido trovato nel file. Verifica il formato.", "errore");
        setImportando(false);
        return;
      }

      // Segnala quante righe avevano un valore di tipo_prezzo presente ma
      // non riconosciuto (finito su "Listino" di default) — utile per
      // controllare la sorgente dati invece di scoprirlo solo dopo,
      // spulciando il catalogo prodotto per prodotto.
      const nonRiconosciuti = prodottiGrezzi.filter(p => p._tipoPrezzoDaVerificare).length;
      if (nonRiconosciuti > 0) {
        addLog(`⚠ ${nonRiconosciuti} prodotti avevano un valore di "tipo prezzo" non riconosciuto — impostati su Listino di default. Controlla la colonna nel file di origine.`, "warn");
      }
      const prodotti = prodottiGrezzi.map(({ _tipoPrezzoDaVerificare, ...p }) => p);

      addLog(`${prodotti.length} prodotti validi trovati. Avvio import…`);
      setProgress({ done: 0, total: prodotti.length, errori: 0 });

      const BATCH = 50;
      const chunks = [];
      for (let i = 0; i < prodotti.length; i += BATCH)
        chunks.push(prodotti.slice(i, i + BATCH));

      let done = 0, errori = 0;
      for (let i = 0; i < chunks.length; i++) {
        let ok = false;
        // Tenta fino a 3 volte ogni batch
        for (let tentativo = 0; tentativo < 3; tentativo++) {
          try {
            await chiamaCatalogAdmin("upsertChunk", { rows: chunks[i] }, accessToken);
            done += chunks[i].length;
            ok = true;
            break;
          } catch { /* ritenta */ }
          // Attesa crescente tra tentativi
          await new Promise(res => setTimeout(res, 300 * (tentativo + 1)));
        }
        if (!ok) {
          // Se fallisce 3 volte, prova prodotto per prodotto
          for (const prod of chunks[i]) {
            try {
              await chiamaCatalogAdmin("upsertChunk", { rows: [prod] }, accessToken);
              done++;
            } catch { errori++; }
            await new Promise(res => setTimeout(res, 50));
          }
          addLog(`Batch ${i+1}/${chunks.length}: recupero singolo prodotti`, "warn");
        } else {
          if ((i+1) % 10 === 0 || i === chunks.length-1)
            addLog(`Batch ${i+1}/${chunks.length}: ${done}/${prodotti.length} prodotti ✓`);
        }
        setProgress({ done, total: prodotti.length, errori });
        await new Promise(res => setTimeout(res, 80));
      }

      addLog(`Import completato: ${done} prodotti, ${errori} errori.`, errori > 0 ? "warn" : "ok");

      // Ricarica il catalogo nell'app
      const nuovoCatalogo = await caricaCatalogo(CATALOG);
      setCatalog(nuovoCatalogo);
      addLog(`Catalogo aggiornato nell'app: ${nuovoCatalogo.length} prodotti.`, "ok");

    } catch (err) {
      addLog(`Errore imprevisto: ${err.message}`, "errore");
    }
    setImportando(false);
  }

  async function svuotaEThenImport() {
    setImportando(true);
    setLog([]);
    addLog("Svuotamento catalogo esistente…");
    try {
      await chiamaCatalogAdmin("deleteActive", {}, accessToken);
      addLog("Catalogo svuotato. Avvio import…", "ok");
      await avviaImport();
    } catch (err) {
      addLog(`Errore svuotamento: ${err.message}`, "errore");
      setImportando(false);
    }
  }

  async function esportaCatalogo() {
    setEsportando(true);
    addLog("Download catalogo in corso…");
    try {
      const PAGE = 1000;
      let tutti = [], offset = 0;
      while (true) {
        const { righe, fine } = await chiamaCatalogAdmin("exportPage", { offset, limit: PAGE }, accessToken);
        tutti = tutti.concat(righe || []);
        if (fine) break;
        offset += PAGE;
      }

      // Colonne separate per tipo di prezzo (invece di un'unica colonna
      // "tipo_prezzo" testuale): più veloce da modificare in Excel — basta
      // scrivere il numero nella colonna giusta, senza rischio di refusi
      // nell'etichetta. Stesso formato riconosciuto da normalizzaRiga in
      // fase di reimport, per un ciclo modifica→reimport senza sorprese.
      const cols = ["cod","nome","descrizione","desc_prev","categoria","marchio","tipologia","um","listino","sconto","netto_telos","netto_fornitore","note"];
      const esc = v => v == null ? "" : `"${String(v).replace(/"/g,'""')}"`;
      const csv = [cols.join(";"), ...tutti.map(r => {
        const riga = {
          ...r,
          netto_telos: r.tipo_prezzo === "promo_telos" ? r.netto : "",
          netto_fornitore: r.tipo_prezzo === "promo_fornitore" ? r.netto : "",
        };
        return cols.map(c => esc(riga[c])).join(";");
      })].join("\n");

      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `catalogo_telos_${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
      addLog(`Esportati ${tutti.length} prodotti ✓`, "ok");
    } catch (err) {
      addLog(`Errore esportazione: ${err.message}`, "errore");
    }
    setEsportando(false);
  }

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0;
  const logColors = { info: "#5B6770", ok: C.ok, errore: C.danger, warn: C.warn };

  return (
    <div>
      <div style={{fontFamily:F_DISPLAY,fontSize:18,fontWeight:600,marginBottom:4}}>AMMINISTRAZIONE</div>
      <div style={{fontSize:12,color:C.steel,marginBottom:18}}>
        Prodotti in catalogo: <strong>{conteggio ?? "…"}</strong>
      </div>

      <ImportClienti ruolo={ruolo}/>

      <div style={{height:8}}/>
      <CreaProdotto ruolo={ruolo} onCreato={()=>{ caricaCatalogo(CATALOG).then(d=>setCatalog(d)); ricaricaCategorie(); ricaricaTipologieMarchi(); }} categorieEsistenti={categorie.map(c=>c.categoria)} tipologieEsistenti={tipologie} marchiEsistenti={marchi} sessione={sessione}/>

      {/* Tab */}
      <div style={{display:"flex",borderBottom:`1px solid ${C.paperLine}`,marginBottom:18}}>
        {[["utenti","👤 Utenti"],["import","⬆ Importa"],["export","⬇ Esporta"],["categorie","▤ Categorie"],["prezzi","💶 Prezzi"],["logistica","⚑ Logistica"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{
            background:"none",border:"none",borderBottom:`2px solid ${tab===id?C.ink:"transparent"}`,
            padding:"8px 16px",fontSize:13,cursor:"pointer",
            color:tab===id?C.ink:C.steel,fontWeight:tab===id?600:400
          }}>{lbl}</button>
        ))}
      </div>

      {tab==="utenti" && <GestioneUtenti ruolo={ruolo} sessione={sessione}/>}

      {tab==="categorie" && <GestioneCategorie sessione={sessione} categorie={categorie} ricarica={()=>{ ricaricaCategorie(); caricaCatalogo(CATALOG).then(d=>setCatalog(d)); }}/>}

      {tab==="logistica" && <GestioneLogisticaOrdini sessione={sessione} categorie={categorie}/>}

      {tab==="prezzi" && <GestionePrezziFornitore sessione={sessione}/>}

      {tab==="import" && (
        <div>
          <div style={{fontSize:13,color:"#5B6770",marginBottom:14,lineHeight:1.6}}>
            Carica un file <strong>CSV</strong> con i prodotti del catalogo. Le colonne riconosciute sono:
            <code style={{fontSize:11,background:C.paper,padding:"2px 6px",borderRadius:4,marginLeft:6}}>
              cod, nome, descrizione, desc_prev, categoria, marchio, um, listino, sconto, netto_telos, netto_fornitore, note
            </code>
          </div>

          <div
            onClick={()=>fileRef.current?.click()}
            style={{border:`2px dashed ${file?C.ink:C.paperLine}`,borderRadius:10,padding:"24px",textAlign:"center",cursor:"pointer",marginBottom:14,background:file?"rgba(22,39,88,0.03)":"#fff"}}>
            <div style={{fontSize:28,marginBottom:6}}>{file?"📄":"📂"}</div>
            <div style={{fontSize:13,fontWeight:600,color:file?C.ink:C.steel}}>
              {file ? file.name : "Clicca per scegliere un file CSV"}
            </div>
            {file && <div style={{fontSize:11,color:C.steel,marginTop:2}}>{(file.size/1024).toFixed(0)} KB</div>}
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFileChange} style={{display:"none"}}/>
          </div>

          {anteprima && (
            <div style={{...S.card,cursor:"default",marginBottom:14}}>
              <div style={S.eyebrow}>Anteprima — {anteprima.totale} righe rilevate</div>
              <div style={{overflowX:"auto"}}>
                <table style={{fontSize:11,borderCollapse:"collapse",width:"100%"}}>
                  <thead>
                    <tr>{anteprima.headers.slice(0,8).map((h,i)=>(
                      <th key={i} style={{padding:"4px 8px",textAlign:"left",color:C.steel,borderBottom:`1px solid ${C.paperLine}`,whiteSpace:"nowrap"}}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {anteprima.campione.map((r,i)=>(
                      <tr key={i}>{r.slice(0,8).map((v,j)=>(
                        <td key={j} style={{padding:"4px 8px",borderBottom:`1px solid ${C.paperLine}`,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {importando && progress.total > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.steel,marginBottom:4}}>
                <span>{progress.done}/{progress.total} prodotti</span>
                <span>{pct}%</span>
              </div>
              <div style={{height:6,background:C.paperLine,borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",background:C.ink,width:`${pct}%`,transition:"width 0.3s"}}/>
              </div>
            </div>
          )}

          <div style={{display:"flex",gap:8,marginBottom:14}}>
            <button onClick={avviaImport} disabled={!file||importando} style={{...S.btnAccent,flex:1,padding:"12px",opacity:(!file||importando)?0.4:1}}>
              {importando?"Importazione in corso…":"⬆ Aggiungi al catalogo"}
            </button>
            <button onClick={svuotaEThenImport} disabled={!file||importando} style={{...S.btnS,padding:"12px",opacity:(!file||importando)?0.4:1}}>
              🗑 Sostituisci tutto
            </button>
          </div>

          <div style={{fontSize:11,color:C.warn,marginBottom:14}}>
            ⚠ "Sostituisci tutto" elimina il catalogo esistente prima di importare.
          </div>
        </div>
      )}

      {tab==="export" && (
        <div>
          <div style={{fontSize:13,color:"#5B6770",marginBottom:18,lineHeight:1.6}}>
            Scarica il catalogo completo in formato CSV, pronto per essere modificato e reimportato.
          </div>
          <button onClick={esportaCatalogo} disabled={esportando} style={{...S.btnAccent,padding:"14px 20px",fontSize:14,opacity:esportando?0.5:1}}>
            {esportando?"Download in corso…":"⬇ Scarica catalogo CSV"}
          </button>
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div style={{marginTop:16,background:C.paper,borderRadius:8,padding:"10px 12px",maxHeight:180,overflowY:"auto"}}>
          <div style={S.eyebrow}>Log operazioni</div>
          {log.map((l,i)=>(
            <div key={i} style={{fontSize:11,color:logColors[l.tipo]||C.steel,padding:"2px 0",fontFamily:F_MONO}}>
              <span style={{color:C.steelLight,marginRight:8}}>{l.ts}</span>{l.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Placeholder({area,setArea}){
  return (
    <div style={{textAlign:"center",padding:"3.5rem 1rem"}}>
      <div style={{fontSize:32,color:"#C7CCCF",marginBottom:14}}>{NAV_META[area].icon}</div>
      <div style={{fontSize:13,color:"#8A929A",marginBottom:18}}>Modulo completo disponibile separatamente.</div>
      <button style={S.btnP} onClick={()=>setArea("home")}>← Dashboard</button>
    </div>
  );
}
