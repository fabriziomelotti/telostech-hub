import { useState, useEffect, useRef } from "react";

// ─── SUPABASE REST (fetch diretto — nessuna libreria esterna) ────────────────
// Stessi valori inline usati in App.jsx. Tenuti qui per rendere il file
// autonomo. Se preferisci una sola fonte, esportali da App.jsx e importali.
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

// GET su una tabella con query string già formattata (stile sbGet di App.jsx)
async function sbGet(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// Come sbGet, ma con il token di sessione dell'utente loggato al posto della
// chiave pubblica generica nell'header Authorization. Necessario per tabelle
// con dati sensibili (es. "clienti") le cui policy RLS richiedono una
// sessione autenticata per la lettura — con la sola chiave pubblica la
// richiesta viene trattata come anonima e la RLS restituisce zero risultati,
// senza errore (da cui la ricerca che "non trova nulla").
async function sbGetAuth(table, params = "", accessToken) {
  if (!accessToken) throw new Error("Sessione non trovata: ricarica la pagina e rieffettua il login.");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: { ...sbHeaders, "Authorization": `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// POST/UPSERT con Prefer: resolution=merge-duplicates → inserisce o aggiorna
// sulla primary key (codice). Batch di righe già mappate alle colonne DB.
// NOTA: dopo la disattivazione delle chiavi legacy (8 luglio), le policy RLS
// bloccano correttamente le scritture dirette con la sola chiave pubblica —
// per questo la tabella "prodotti" NON usa più questo helper (vedi
// chiamaCatalogAdmin più sotto), rimasto qui solo per le tabelle che
// consentono scrittura diretta lato client (es. "clienti", se prevista).
async function sbUpsert(table, righe) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...sbHeaders,
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(righe),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status} ${txt}`);
  }
}

// La sessione custom (Auth.jsx) conserva il token in un campo il cui nome può
// variare; stesso helper di App.jsx, duplicato qui per rendere il file
// autonomo (vedi nota in cima al file).
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

// Chiama la Edge Function catalog-admin (verifica JWT + ruolo admin lato
// server, poi opera con la service_role key). Creazione/modifica prodotto e
// upload immagine passano da qui invece che da sbUpsert diretto, perché le
// policy RLS della tabella "prodotti" non permettono scritture con la sola
// chiave pubblica — stesso principio già applicato a admin-users.
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

// ─── STILE (deve combaciare con C / S / F_* di App.jsx) ───────────────────────
const C = {
  ink:"#162758", inkDeep:"#0E1A40", cyan:"#57CECA", charcoal:"#232323",
  steel:"#7C879E", ok:"#3F9D63", warn:"#D9A441", danger:"#C84B3A",
  paper:"#FAFAFA", paperLine:"#E3E5EA",
};
const F_DISPLAY = '"Oswald","Bebas Neue",system-ui,sans-serif';
const F_BODY = '"Inter","Helvetica Neue",system-ui,sans-serif';
const F_MONO = '"IBM Plex Mono","SF Mono",ui-monospace,monospace';
const S = {
  card:{background:"#fff",border:`1px solid ${C.paperLine}`,borderRadius:8,padding:"13px 15px",marginBottom:8,position:"relative"},
  inp:{border:`1px solid ${C.paperLine}`,borderRadius:7,padding:"10px 12px",fontSize:13.5,background:"#fff",color:C.charcoal,width:"100%",outline:"none"},
  btnP:{background:C.ink,color:"#fff",border:"none",borderRadius:7,padding:"10px 16px",fontSize:13,cursor:"pointer",fontWeight:600,letterSpacing:"0.01em"},
  btnS:{background:"none",border:`1px solid ${C.paperLine}`,borderRadius:7,padding:"9px 14px",fontSize:12.5,cursor:"pointer",color:"#5B6770",fontWeight:500},
  eyebrow:{fontFamily:F_MONO,fontSize:10.5,fontWeight:600,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:9},
};

// Mappatura colonne Excel → colonne tabella `clienti`
const COLONNE_DB = {
  "Codice": "codice",
  "Ragione sociale": "ragione_sociale",
  "Ragione sociale aggiuntiva": "rag_sociale_agg",
  "Indirizzo": "indirizzo",
  "Località": "localita",
  "Provincia": "provincia",
  "CAP": "cap",
  "Codice Fiscale": "codice_fiscale",
  "Partita IVA": "partita_iva",
  "Telefono": "telefono",
  "Mail": "mail",
  "Descrizione filiale": "filiale",
  "Descrizione categoria": "categoria",
  "Descrizione pagamento": "pagamento",
  "Descrizione Agente": "agente",
};

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT CLIENTI — solo admin. Carica l'Excel via SheetJS (window.XLSX),
// individua il foglio con la colonna "Codice", mappa, deduplica e fa upsert
// a batch da 500 righe con barra di avanzamento.
// ═══════════════════════════════════════════════════════════════════════════
export function ImportClienti({ ruolo }){
  const [stato, setStato] = useState("idle"); // idle | leggo | carico | fatto | errore
  const [msg, setMsg] = useState("");
  const [prog, setProg] = useState(0);       // 0..100
  const [totali, setTotali] = useState(0);
  const fileRef = useRef(null);

  if(ruolo !== "admin"){
    return (
      <div style={{...S.card,cursor:"default"}}>
        <div style={{fontFamily:F_DISPLAY,fontSize:16,fontWeight:600}}>Import clienti</div>
        <div style={{fontSize:12.5,color:C.steel,marginTop:6}}>
          Funzione riservata al ruolo <b>Admin</b>.
        </div>
      </div>
    );
  }

  function trovaFoglio(wb){
    // sceglie il primo foglio che contiene la colonna "Codice" con dati
    for(const nome of wb.SheetNames){
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[nome], {defval:""});
      if(rows.length > 1 && Object.prototype.hasOwnProperty.call(rows[0], "Codice")){
        return rows;
      }
    }
    const first = wb.SheetNames[0];
    return window.XLSX.utils.sheet_to_json(wb.Sheets[first], {defval:""});
  }

  function mappaRiga(r){
    const out = {};
    for(const [xls, db] of Object.entries(COLONNE_DB)){
      let v = r[xls];
      if(v === undefined || v === null) v = "";
      v = String(v).trim();
      out[db] = v === "" ? null : v;
    }
    return out;
  }

  async function onFile(e){
    const file = e.target.files?.[0];
    if(!file) return;
    if(typeof window.XLSX === "undefined"){
      setStato("errore");
      setMsg("SheetJS non caricato. Aggiungi lo script di xlsx in public/index.html.");
      return;
    }
    try{
      setStato("leggo"); setMsg("Lettura del file…"); setProg(0);
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, {type:"array"});
      const rows = trovaFoglio(wb);

      // mappa + dedup su codice (l'ultima occorrenza vince)
      const perCodice = new Map();
      for(const r of rows){
        const m = mappaRiga(r);
        if(!m.codice) continue; // salta righe senza PK
        perCodice.set(m.codice, m);
      }
      const clienti = Array.from(perCodice.values());
      setTotali(clienti.length);

      if(clienti.length === 0){
        setStato("errore");
        setMsg("Nessuna riga valida trovata (colonna 'Codice' assente o vuota).");
        return;
      }

      setStato("carico");
      const BATCH = 500;
      for(let i=0; i<clienti.length; i+=BATCH){
        const chunk = clienti.slice(i, i+BATCH);
        await sbUpsert("clienti", chunk);
        const done = Math.min(i+BATCH, clienti.length);
        setProg(Math.round(done/clienti.length*100));
        setMsg(`Caricati ${done} / ${clienti.length} clienti…`);
      }

      setStato("fatto");
      setMsg(`Import completato: ${clienti.length} clienti aggiornati.`);
    }catch(err){
      setStato("errore");
      setMsg("Errore durante l'import: " + err.message);
    }finally{
      if(fileRef.current) fileRef.current.value = "";
    }
  }

  const inCorso = stato === "leggo" || stato === "carico";

  return (
    <div style={{...S.card,cursor:"default"}}>
      <div style={{fontFamily:F_DISPLAY,fontSize:16,fontWeight:600}}>Import anagrafica clienti</div>
      <div style={{fontSize:12.5,color:C.steel,marginTop:6,marginBottom:12}}>
        Carica il file Excel esportato dal gestionale. I clienti vengono aggiornati
        in base al <b>Codice</b> (inserimento o aggiornamento).
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={onFile}
        disabled={inCorso}
        style={{display:"none"}}
        id="import-clienti-file"
      />
      <label htmlFor="import-clienti-file" style={{...S.btnP,display:"inline-block",opacity:inCorso?0.6:1,cursor:inCorso?"default":"pointer"}}>
        {inCorso ? "Import in corso…" : "⬆ Seleziona file Excel"}
      </label>

      {(inCorso || stato==="fatto") && totali>0 && (
        <div style={{marginTop:14}}>
          <div style={{height:8,background:C.paperLine,borderRadius:4,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${prog}%`,background:stato==="fatto"?C.ok:C.cyan,transition:"width .2s"}}/>
          </div>
        </div>
      )}

      {msg && (
        <div style={{
          marginTop:12,fontSize:12,fontFamily:F_MONO,
          color: stato==="errore"?C.danger : stato==="fatto"?C.ok : C.steel
        }}>
          {stato==="errore"?"● ":stato==="fatto"?"✓ ":"… "}{msg}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SELEZIONE CLIENTE — ricerca server-side su tutti i campi (debounce 300ms,
// min 2 caratteri, limite 25) via REST `or=(col.ilike.*term*,...)`.
// Mostra la card del cliente selezionato con pulsante "Cambia".
// onSeleziona(cliente|null) e clienteSelezionato passati dal padre.
// ═══════════════════════════════════════════════════════════════════════════
const CAMPI_RICERCA = [
  "codice","ragione_sociale","rag_sociale_agg","localita","provincia",
  "partita_iva","codice_fiscale","mail","telefono",
];

export function SelezioneCliente({ onSeleziona, clienteSelezionato, sessione }){
  const accessToken = trovaAccessToken(sessione);
  const [q, setQ] = useState("");
  const [risultati, setRisultati] = useState([]);
  const [caricando, setCaricando] = useState(false);
  const [errore, setErrore] = useState("");
  const timer = useRef(null);

  useEffect(()=>{
    if(clienteSelezionato) return; // non cercare mentre uno è selezionato
    const term = q.trim();
    if(term.length < 2){ setRisultati([]); setErrore(""); return; }

    if(timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async ()=>{
      setCaricando(true); setErrore("");
      try{
        // escape: rimuovi caratteri che romperebbero il filtro or=(...)
        const safe = term.replace(/[,*()]/g, " ").trim();
        // encoda il termine (spazi, accenti, ecc.) ma lascia gli asterischi
        // letterali: sono i wildcard che PostgREST usa per ilike.
        const pattern = "*" + encodeURIComponent(safe) + "*";
        const orExpr = CAMPI_RICERCA.map(c => `${c}.ilike.${pattern}`).join(",");
        const params =
          `select=codice,ragione_sociale,rag_sociale_agg,indirizzo,localita,provincia,cap,partita_iva,codice_fiscale,telefono,mail,filiale` +
          `&or=(${orExpr})&limit=25&order=ragione_sociale`;
        const dati = await sbGetAuth("clienti", params, accessToken);
        setRisultati(dati || []);
      }catch(err){
        setErrore("Ricerca non disponibile: " + err.message);
        setRisultati([]);
      }finally{
        setCaricando(false);
      }
    }, 300);

    return ()=>{ if(timer.current) clearTimeout(timer.current); };
  }, [q, clienteSelezionato]);

  // ── Cliente già selezionato: card + Cambia ──
  if(clienteSelezionato){
    const c = clienteSelezionato;
    return (
      <div style={{...S.card,cursor:"default",borderColor:C.ink}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div style={{minWidth:0}}>
            <div style={{...S.eyebrow,marginBottom:4}}>Cliente selezionato</div>
            <div style={{fontFamily:F_DISPLAY,fontSize:17,fontWeight:600}}>{c.ragione_sociale}</div>
            {c.rag_sociale_agg && <div style={{fontSize:12,color:C.steel,marginTop:1}}>{c.rag_sociale_agg}</div>}
            <div style={{fontSize:12,color:C.steel,marginTop:4}}>
              {[c.localita, c.provincia && `(${c.provincia})`].filter(Boolean).join(" ")}
              {c.partita_iva && <span className="tnum" style={{fontFamily:F_MONO,marginLeft:8}}>P.IVA {c.partita_iva}</span>}
            </div>
            <div className="tnum" style={{fontSize:11,color:"#9AA3AB",fontFamily:F_MONO,marginTop:4}}>COD {c.codice}</div>
          </div>
          <button onClick={()=>{ onSeleziona(null); setQ(""); setRisultati([]); }} style={{...S.btnS,flexShrink:0}}>
            Cambia
          </button>
        </div>
      </div>
    );
  }

  // ── Ricerca ──
  return (
    <div>
      <div style={{...S.eyebrow}}>Seleziona cliente</div>
      <input
        value={q}
        onChange={e=>setQ(e.target.value)}
        placeholder="Cerca per ragione sociale, P.IVA, località, codice…"
        style={S.inp}
        autoFocus
      />

      {caricando && (
        <div style={{fontSize:11.5,fontFamily:F_MONO,color:C.steel,marginTop:10}}>… ricerca in corso</div>
      )}
      {errore && (
        <div style={{fontSize:11.5,fontFamily:F_MONO,color:C.danger,marginTop:10}}>● {errore}</div>
      )}
      {!caricando && !errore && q.trim().length>=2 && risultati.length===0 && (
        <div style={{fontSize:12,color:"#9AA3AB",marginTop:12}}>Nessun cliente trovato.</div>
      )}

      <div style={{marginTop:12}}>
        {risultati.map(c=>(
          <div key={c.codice} onClick={()=>onSeleziona(c)} style={{...S.card,cursor:"pointer"}}>
            <div style={{fontWeight:600,fontSize:13.5}}>{c.ragione_sociale}</div>
            <div style={{fontSize:11.5,color:C.steel,marginTop:2}}>
              {[c.localita, c.provincia && `(${c.provincia})`].filter(Boolean).join(" ")}
              {c.filiale && <span style={{marginLeft:6}}>· {c.filiale}</span>}
            </div>
            <div className="tnum" style={{fontSize:11,color:"#9AA3AB",fontFamily:F_MONO,marginTop:3}}>
              COD {c.codice}{c.partita_iva && ` · P.IVA ${c.partita_iva}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CREA PRODOTTO — solo admin. Form per inserire un nuovo prodotto nel catalogo
// con settore multiplo (auto/truck/moto) e gli altri livelli (categoria,
// tipologia, marca). Scrive nella tabella `prodotti` via upsert su `cod`.
// Prop: onCreato() opzionale, chiamata dopo un inserimento riuscito.
// ═══════════════════════════════════════════════════════════════════════════
const SETTORI_DISPONIBILI = ["auto", "truck", "moto"];
const TIPI_PREZZO = [
  { v: "listino", label: "Listino" },
  { v: "sconto_base", label: "Sconto base" },
  { v: "promo_telos", label: "Promo Telos" },
  { v: "promo_fornitore", label: "Promo fornitore" },
];

// Menu a tendina con le opzioni già in uso nel catalogo (Tipologia, Marca) +
// possibilità di scriverne una nuova. Stesso pattern già usato per la
// Categoria: evita refusi/doppioni quando esiste già il valore giusto, ma
// non blocca la creazione di uno nuovo quando serve davvero.
function CampoSelezionabile({ valore, onChange, opzioni, placeholderNuovo, sentinellaLabel }){
  const lista = opzioni || [];
  const inElenco = lista.includes(valore);
  return (
    <>
      <select
        value={inElenco ? valore : "__nuovo__"}
        onChange={e=>onChange(e.target.value==="__nuovo__" ? "" : e.target.value)}
        style={S.inp}
      >
        <option value="__nuovo__">{sentinellaLabel}</option>
        {valore && !inElenco && <option value={valore}>{valore} (attuale)</option>}
        {lista.map(o=>(<option key={o} value={o}>{o}</option>))}
      </select>
      {!inElenco && (
        <input value={valore} onChange={e=>onChange(e.target.value)} placeholder={placeholderNuovo} style={{...S.inp,marginTop:8}}/>
      )}
    </>
  );
}

export function CreaProdotto({ ruolo, onCreato, categorieEsistenti, tipologieEsistenti, marchiEsistenti, sessione }){
  const accessToken = trovaAccessToken(sessione);
  const vuoto = {
    cod:"", nome:"", categoria:"", tipologia:"", marchio:"",
    descrizione:"", desc_prev:"", um:"pz",
    listino:"", sconto:"", netto:"", tipo_prezzo:"listino", note:"", img:"", video:"",
  };
  const [f, setF] = useState(vuoto);
  const [settori, setSettori] = useState([]); // array di stringhe
  const [stato, setStato] = useState("idle"); // idle | salvo | fatto | errore
  const [msg, setMsg] = useState("");
  const [caricandoImg, setCaricandoImg] = useState(false);
  const [erroreImg, setErroreImg] = useState("");
  const fileImgRef = useRef(null);
  const [schede, setSchede] = useState([]); // [{nome, url}]
  const [caricandoScheda, setCaricandoScheda] = useState(false);
  const [erroreScheda, setErroreScheda] = useState("");
  const fileSchedaRef = useRef(null);

  if(ruolo !== "admin"){
    return (
      <div style={{...S.card,cursor:"default"}}>
        <div style={{fontFamily:F_DISPLAY,fontSize:16,fontWeight:600}}>Nuovo prodotto</div>
        <div style={{fontSize:12.5,color:C.steel,marginTop:6}}>Funzione riservata al ruolo <b>Admin</b>.</div>
      </div>
    );
  }

  function set(campo, val){ setF(prev=>({...prev, [campo]:val})); }
  function toggleSettore(s){
    setSettori(prev => prev.includes(s) ? prev.filter(x=>x!==s) : [...prev, s]);
  }

  // Legge il file scelto, lo manda alla Edge Function (che lo carica sullo
  // storage bucket "prodotti-immagini" con la service_role key) e imposta
  // l'URL pubblico restituito nel campo immagine.
  async function caricaImmagineFile(file){
    if(!file) return;
    if(file.size > 5*1024*1024){ setErroreImg("Immagine troppo grande (max 5MB)."); return; }
    setErroreImg(""); setCaricandoImg(true);
    try{
      const base64 = await new Promise((res,rej)=>{
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Lettura file fallita"));
        r.readAsDataURL(file);
      });
      const { url } = await chiamaCatalogAdmin(
        "caricaImmagine",
        { nomeFile: file.name, contentType: file.type, base64, cod: f.cod || "prodotto" },
        accessToken
      );
      set("img", url);
    }catch(err){
      setErroreImg("Errore caricamento: " + err.message);
    }
    setCaricandoImg(false);
  }

  // Carica un PDF come nuova scheda tecnica. Il nome mostrato di default è
  // il nome del file (senza estensione); l'admin può poi rinominarlo
  // liberamente nell'elenco (es. "INFO PRODOTTO", "SCHEDA PER INSTALLAZIONE")
  // — più file, anche con lo stesso PDF sorgente, possono avere nomi diversi.
  async function caricaSchedaFile(file){
    if(!file) return;
    if(file.type !== "application/pdf"){ setErroreScheda("Sono ammessi solo file PDF."); return; }
    if(file.size > 15*1024*1024){ setErroreScheda("File troppo grande (max 15MB)."); return; }
    setErroreScheda(""); setCaricandoScheda(true);
    try{
      const base64 = await new Promise((res,rej)=>{
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Lettura file fallita"));
        r.readAsDataURL(file);
      });
      const { url } = await chiamaCatalogAdmin(
        "caricaSchedaTecnica",
        { nomeFile: file.name, contentType: file.type, base64, cod: f.cod || "prodotto" },
        accessToken
      );
      const nomeDefault = file.name.replace(/\.pdf$/i, "");
      setSchede(prev => [...prev, { nome: nomeDefault, url }]);
    }catch(err){
      setErroreScheda("Errore caricamento: " + err.message);
    }
    setCaricandoScheda(false);
  }
  function rinominaScheda(i, nuovoNome){
    setSchede(prev => prev.map((s,idx) => idx===i ? {...s, nome:nuovoNome} : s));
  }
  function rimuoviScheda(i){
    setSchede(prev => prev.filter((_,idx) => idx!==i));
  }

  // calcolo netto automatico da listino+sconto se netto non inserito a mano
  function nettoCalcolato(){
    const listino = parseFloat(f.listino);
    const sconto = parseFloat(f.sconto);
    if(!isNaN(listino) && !isNaN(sconto)) return +(listino*(1-sconto/100)).toFixed(2);
    return null;
  }

  async function salva(){
    setMsg("");
    if(!f.cod.trim()){ setStato("errore"); setMsg("Il codice prodotto è obbligatorio."); return; }
    if(!f.nome.trim()){ setStato("errore"); setMsg("Il nome è obbligatorio."); return; }
    if(!f.categoria.trim()){ setStato("errore"); setMsg("La categoria è obbligatoria."); return; }

    const nettoAuto = nettoCalcolato();
    const riga = {
      cod: f.cod.trim(),
      nome: f.nome.trim(),
      categoria: f.categoria.trim().toUpperCase(),
      tipologia: f.tipologia.trim() || null,
      marchio: f.marchio.trim() || null,
      settori: settori.join(","), // "auto,truck"  (stringa vuota se nessuno)
      descrizione: f.descrizione.trim() || null,
      desc_prev: f.desc_prev.trim() || null,
      um: f.um.trim() || "pz",
      listino: f.listino!=="" ? parseFloat(f.listino) : null,
      sconto: f.sconto!=="" ? parseFloat(f.sconto) : 0,
      netto: f.netto!=="" ? parseFloat(f.netto) : (nettoAuto ?? null),
      tipo_prezzo: f.tipo_prezzo,
      note: f.note.trim() || null,
      img: f.img.trim() || null,
      video_url: f.video.trim() || null,
      schede_tecniche: schede,
      attivo: true,
    };

    try{
      setStato("salvo"); setMsg("Salvataggio…");
      await chiamaCatalogAdmin("upsertChunk", { rows: [riga] }, accessToken);
      setStato("fatto");
      setMsg(`Prodotto "${riga.nome}" salvato. Ricarica il catalogo per vederlo.`);
      setF(vuoto); setSettori([]); setSchede([]);
      if(onCreato) onCreato();
    }catch(err){
      setStato("errore");
      setMsg("Errore nel salvataggio: " + err.message);
    }
  }

  const lbl = {fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4,display:"block"};
  const campo = (etichetta, node) => (
    <div style={{marginBottom:11}}>
      <label style={lbl}>{etichetta}</label>
      {node}
    </div>
  );

  const nettoAuto = nettoCalcolato();

  return (
    <div style={{...S.card,cursor:"default"}}>
      <div style={{fontFamily:F_DISPLAY,fontSize:16,fontWeight:600,marginBottom:2}}>Nuovo prodotto</div>
      <div style={{fontSize:12.5,color:C.steel,marginBottom:14}}>
        Inserisci un articolo nel catalogo. I campi con * sono obbligatori.
      </div>

      {campo("Codice *", <input value={f.cod} onChange={e=>set("cod",e.target.value)} placeholder="es. 199/GK" style={S.inp}/>)}
      {campo("Nome *", <input value={f.nome} onChange={e=>set("nome",e.target.value)} placeholder="Nome commerciale" style={S.inp}/>)}

      {campo("Categoria *", <>
        <select
          value={(categorieEsistenti||[]).includes(f.categoria) ? f.categoria : "__nuova__"}
          onChange={e=>set("categoria", e.target.value==="__nuova__" ? "" : e.target.value)}
          style={S.inp}
        >
          <option value="__nuova__">— nuova categoria —</option>
          {(categorieEsistenti||[]).map(c=>(<option key={c} value={c}>{c}</option>))}
        </select>
        {!(categorieEsistenti||[]).includes(f.categoria) && (
          <input value={f.categoria} onChange={e=>set("categoria",e.target.value)} placeholder="es. PONTI SOLLEVATORI" style={{...S.inp,marginTop:8}}/>
        )}
        <div style={{fontSize:11,color:"#9AA3AB",marginTop:3}}>
          Scegli una categoria esistente per evitare doppioni, oppure lascia "— nuova categoria —" e scrivine una. Viene salvata automaticamente in MAIUSCOLO.
        </div>
      </>)}

      {campo("Settore (uno o più)",
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {SETTORI_DISPONIBILI.map(s=>{
            const on = settori.includes(s);
            return (
              <button key={s} onClick={()=>toggleSettore(s)} style={{
                border:`1px solid ${on?C.ink:C.paperLine}`, borderRadius:7,
                padding:"8px 14px", fontSize:12.5, cursor:"pointer", fontWeight:on?600:400,
                background:on?C.ink:"#fff", color:on?"#fff":"#5B6770", textTransform:"capitalize",
              }}>{on?"✓ ":""}{s}</button>
            );
          })}
        </div>
      )}

      {campo("Tipologia", <CampoSelezionabile valore={f.tipologia} onChange={v=>set("tipologia",v)} opzioni={tipologieEsistenti} placeholderNuovo="es. PONTI 2 COLONNE" sentinellaLabel="— nuova tipologia —"/>)}
      {campo("Marca", <CampoSelezionabile valore={f.marchio} onChange={v=>set("marchio",v)} opzioni={marchiEsistenti} placeholderNuovo="es. OMCN" sentinellaLabel="— nuova marca —"/>)}

      {campo("Descrizione", <input value={f.descrizione} onChange={e=>set("descrizione",e.target.value)} placeholder="Descrizione estesa" style={S.inp}/>)}
      {campo("Descrizione per preventivo (una caratteristica per riga)",
        <textarea value={f.desc_prev} onChange={e=>set("desc_prev",e.target.value)} rows={3} placeholder={"Portata 32 q.li\nInterasse 2.500 mm"} style={{...S.inp,resize:"vertical",fontFamily:F_BODY}}/>
      )}

      <div style={{display:"flex",gap:10}}>
        <div style={{flex:1}}>{campo("Unità", <input value={f.um} onChange={e=>set("um",e.target.value)} style={S.inp}/>)}</div>
        <div style={{flex:1}}>{campo("Listino €", <input type="number" value={f.listino} onChange={e=>set("listino",e.target.value)} placeholder="0.00" style={S.inp}/>)}</div>
      </div>
      <div style={{display:"flex",gap:10}}>
        <div style={{flex:1}}>{campo("Sconto %", <input type="number" value={f.sconto} onChange={e=>set("sconto",e.target.value)} placeholder="0" style={S.inp}/>)}</div>
        <div style={{flex:1}}>{campo("Netto € (vuoto = calcolato)", <input type="number" value={f.netto} onChange={e=>set("netto",e.target.value)} placeholder={nettoAuto!==null?String(nettoAuto):"0.00"} style={S.inp}/>)}</div>
      </div>
      {f.netto==="" && nettoAuto!==null && (
        <div style={{fontSize:11,fontFamily:F_MONO,color:C.steel,marginTop:-4,marginBottom:11}}>Netto calcolato: € {nettoAuto}</div>
      )}

      {campo("Tipo prezzo",
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {TIPI_PREZZO.map(tp=>{
            const on=f.tipo_prezzo===tp.v;
            return (
              <button key={tp.v} onClick={()=>set("tipo_prezzo",tp.v)} style={{
                border:`1px solid ${on?C.ink:C.paperLine}`, borderRadius:7, padding:"7px 12px",
                fontSize:12, cursor:"pointer", fontWeight:on?600:400,
                background:on?C.ink:"#fff", color:on?"#fff":"#5B6770",
              }}>{tp.label}</button>
            );
          })}
        </div>
      )}

      {campo("Immagine prodotto", <>
        <div style={{display:"flex",gap:8}}>
          <input value={f.img} onChange={e=>set("img",e.target.value)} placeholder="https://… oppure carica un file" style={{...S.inp,flex:1}}/>
          <button type="button" onClick={()=>fileImgRef.current?.click()} disabled={caricandoImg} style={{...S.btnS,padding:"0 14px",whiteSpace:"nowrap",opacity:caricandoImg?0.6:1}}>
            {caricandoImg ? "Carico…" : "⬆ CARICA"}
          </button>
          <input ref={fileImgRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{caricaImmagineFile(e.target.files[0]); e.target.value="";}}/>
        </div>
        {erroreImg && <div style={{fontSize:11,color:C.danger,marginTop:4}}>{erroreImg}</div>}
        {f.img && (
          <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
            <img src={f.img} alt="anteprima" style={{width:48,height:48,objectFit:"contain",border:`1px solid ${C.paperLine}`,borderRadius:6,background:C.paper}} onError={e=>{e.target.style.display="none";}}/>
            <span style={{fontSize:11,color:"#9AA3AB"}}>Anteprima</span>
          </div>
        )}
      </>)}

      {campo("Schede tecniche (PDF)", <>
        {schede.length > 0 && (
          <div style={{marginBottom:10}}>
            {schede.map((s,i)=>(
              <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
                <input value={s.nome} onChange={e=>rinominaScheda(i,e.target.value)} placeholder="es. INFO PRODOTTO" style={{...S.inp,flex:1}}/>
                <a href={s.url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:C.ink,whiteSpace:"nowrap"}}>Apri</a>
                <button type="button" onClick={()=>rimuoviScheda(i)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:16,padding:"0 4px"}}>✕</button>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={()=>fileSchedaRef.current?.click()} disabled={caricandoScheda} style={{...S.btnS,padding:"9px 14px",opacity:caricandoScheda?0.6:1}}>
          {caricandoScheda ? "Carico…" : "⬆ Aggiungi scheda tecnica (PDF)"}
        </button>
        <input ref={fileSchedaRef} type="file" accept="application/pdf" style={{display:"none"}} onChange={e=>{caricaSchedaFile(e.target.files[0]); e.target.value="";}}/>
        {erroreScheda && <div style={{fontSize:11,color:C.danger,marginTop:4}}>{erroreScheda}</div>}
        <div style={{fontSize:11,color:"#9AA3AB",marginTop:6}}>
          Carica il PDF, poi scrivi il nome da mostrare (es. "INFO PRODOTTO", "SCHEDA PER INSTALLAZIONE"). Puoi caricarne più di uno.
        </div>
      </>)}

      {campo("Video prodotto (URL, opzionale)", <input value={f.video} onChange={e=>set("video",e.target.value)} placeholder="https://www.youtube.com/... oppure sito del produttore" style={S.inp}/>)}
      {campo("Note", <input value={f.note} onChange={e=>set("note",e.target.value)} placeholder="Note interne" style={S.inp}/>)}

      <button onClick={salva} disabled={stato==="salvo"} style={{...S.btnP,width:"100%",padding:"12px",marginTop:4,opacity:stato==="salvo"?0.6:1}}>
        {stato==="salvo" ? "Salvataggio…" : "Salva prodotto"}
      </button>

      {msg && (
        <div style={{marginTop:12,fontSize:12,fontFamily:F_MONO,color: stato==="errore"?C.danger : stato==="fatto"?C.ok : C.steel}}>
          {stato==="errore"?"● ":stato==="fatto"?"✓ ":"… "}{msg}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODIFICA PRODOTTO — solo admin. Modale a foglio inferiore aperta dal tasto
// "Modifica" nella scheda prodotto del Catalogo. Stessi campi di CreaProdotto,
// precompilati; il codice (cod) resta fisso perché è la chiave usata
// dall'upsert su Supabase — cambiarlo creerebbe un prodotto nuovo invece di
// aggiornare quello esistente.
// Prop: p = prodotto nel formato "corto" usato dal frontend (cat, mar, tip,
// desc, ecc. — vedi mappatura in caricaCatalogo() dentro App.jsx).
// ═══════════════════════════════════════════════════════════════════════════
export function EditaProdotto({ ruolo, p, categorieEsistenti, tipologieEsistenti, marchiEsistenti, onSalvato, onClose, sessione }){
  const accessToken = trovaAccessToken(sessione);
  const settoriIniziali = (p.settori||"").split(",").map(s=>s.trim()).filter(Boolean);
  const [f, setF] = useState({
    nome: p.nome||"", categoria: p.cat||"", tipologia: p.tip||"", marchio: p.mar||"",
    descrizione: p.desc||"", desc_prev: p.desc_prev||"", um: p.um||"pz",
    listino: p.listino ?? "", sconto: p.sconto ?? "", netto: p.netto ?? "",
    tipo_prezzo: p.tipo_prezzo||"listino", note: p.note||"", img: p.img||"", video: p.video||"",
  });
  const [settori, setSettori] = useState(settoriIniziali);
  const [stato, setStato] = useState("idle"); // idle | salvo | fatto | errore
  const [msg, setMsg] = useState("");
  const [caricandoImg, setCaricandoImg] = useState(false);
  const [erroreImg, setErroreImg] = useState("");
  const fileImgRef = useRef(null);
  const [schede, setSchede] = useState(p.schede || []); // [{nome, url}]
  const [caricandoScheda, setCaricandoScheda] = useState(false);
  const [erroreScheda, setErroreScheda] = useState("");
  const fileSchedaRef = useRef(null);

  if(ruolo !== "admin") return null;

  function set(campo, val){ setF(prev=>({...prev, [campo]:val})); }
  function toggleSettore(s){
    setSettori(prev => prev.includes(s) ? prev.filter(x=>x!==s) : [...prev, s]);
  }

  // Carica un PDF come nuova scheda tecnica. Il nome mostrato di default è
  // il nome del file (senza estensione); l'admin può poi rinominarlo
  // liberamente nell'elenco (es. "INFO PRODOTTO", "SCHEDA PER INSTALLAZIONE")
  // — più file, anche con lo stesso PDF sorgente, possono avere nomi diversi.
  async function caricaSchedaFile(file){
    if(!file) return;
    if(file.type !== "application/pdf"){ setErroreScheda("Sono ammessi solo file PDF."); return; }
    if(file.size > 15*1024*1024){ setErroreScheda("File troppo grande (max 15MB)."); return; }
    setErroreScheda(""); setCaricandoScheda(true);
    try{
      const base64 = await new Promise((res,rej)=>{
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Lettura file fallita"));
        r.readAsDataURL(file);
      });
      const { url } = await chiamaCatalogAdmin(
        "caricaSchedaTecnica",
        { nomeFile: file.name, contentType: file.type, base64, cod: p.cod },
        accessToken
      );
      const nomeDefault = file.name.replace(/\.pdf$/i, "");
      setSchede(prev => [...prev, { nome: nomeDefault, url }]);
    }catch(err){
      setErroreScheda("Errore caricamento: " + err.message);
    }
    setCaricandoScheda(false);
  }
  function rinominaScheda(i, nuovoNome){
    setSchede(prev => prev.map((s,idx) => idx===i ? {...s, nome:nuovoNome} : s));
  }
  function rimuoviScheda(i){
    setSchede(prev => prev.filter((_,idx) => idx!==i));
  }

  async function caricaImmagineFile(file){
    if(!file) return;
    if(file.size > 5*1024*1024){ setErroreImg("Immagine troppo grande (max 5MB)."); return; }
    setErroreImg(""); setCaricandoImg(true);
    try{
      const base64 = await new Promise((res,rej)=>{
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Lettura file fallita"));
        r.readAsDataURL(file);
      });
      const { url } = await chiamaCatalogAdmin(
        "caricaImmagine",
        { nomeFile: file.name, contentType: file.type, base64, cod: p.cod },
        accessToken
      );
      set("img", url);
    }catch(err){
      setErroreImg("Errore caricamento: " + err.message);
    }
    setCaricandoImg(false);
  }

  function nettoCalcolato(){
    const listino = parseFloat(f.listino);
    const sconto = parseFloat(f.sconto);
    if(!isNaN(listino) && !isNaN(sconto)) return +(listino*(1-sconto/100)).toFixed(2);
    return null;
  }

  async function salva(){
    setMsg("");
    if(!f.nome.trim()){ setStato("errore"); setMsg("Il nome è obbligatorio."); return; }
    if(!f.categoria.trim()){ setStato("errore"); setMsg("La categoria è obbligatoria."); return; }

    const nettoAuto = nettoCalcolato();
    const riga = {
      cod: p.cod, // invariato: è la chiave su cui avviene l'upsert
      nome: f.nome.trim(),
      categoria: f.categoria.trim().toUpperCase(),
      tipologia: f.tipologia.trim() || null,
      marchio: f.marchio.trim() || null,
      settori: settori.join(","),
      descrizione: f.descrizione.trim() || null,
      desc_prev: f.desc_prev.trim() || null,
      um: f.um.trim() || "pz",
      listino: f.listino!=="" ? parseFloat(f.listino) : null,
      sconto: f.sconto!=="" ? parseFloat(f.sconto) : 0,
      netto: f.netto!=="" ? parseFloat(f.netto) : (nettoAuto ?? null),
      tipo_prezzo: f.tipo_prezzo,
      note: f.note.trim() || null,
      img: f.img.trim() || null,
      video_url: f.video.trim() || null,
      schede_tecniche: schede,
      attivo: true,
    };

    try{
      setStato("salvo"); setMsg("Salvataggio…");
      await chiamaCatalogAdmin("upsertChunk", { rows: [riga] }, accessToken);
      setStato("fatto");
      setMsg("Prodotto aggiornato.");
      if(onSalvato) onSalvato(riga);
    }catch(err){
      setStato("errore");
      setMsg("Errore nel salvataggio: " + err.message);
    }
  }

  const lbl = {fontSize:11,fontFamily:F_MONO,color:"#9AA3AB",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4,display:"block"};
  const campo = (etichetta, node) => (
    <div style={{marginBottom:11}}>
      <label style={lbl}>{etichetta}</label>
      {node}
    </div>
  );

  const nettoAuto = nettoCalcolato();

  return (
    <div onClick={e=>{if(e.target===e.currentTarget && stato!=="salvo") onClose();}} style={{position:"fixed",inset:0,background:"rgba(14,26,64,.55)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:60}}>
      <div style={{background:"#fff",borderRadius:"14px 14px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{position:"sticky",top:0,background:"#fff",padding:"14px 20px 0",zIndex:2}}>
          <div style={{width:36,height:4,background:C.paperLine,borderRadius:2,margin:"0 auto 14px"}}/>
        </div>
        <div style={{padding:"0 20px 24px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:2}}>
            <div style={{fontFamily:F_DISPLAY,fontSize:18,fontWeight:600}}>Modifica prodotto</div>
            <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#9AA3AB",flexShrink:0,marginLeft:10}}>✕</button>
          </div>
          <div className="tnum" style={{fontSize:11.5,color:"#8A929A",fontFamily:F_MONO,marginBottom:16}}>COD {p.cod} — il codice non è modificabile</div>

          {campo("Nome *", <input value={f.nome} onChange={e=>set("nome",e.target.value)} style={S.inp}/>)}

          {campo("Categoria *", <>
            <select
              value={(categorieEsistenti||[]).includes(f.categoria) ? f.categoria : "__nuova__"}
              onChange={e=>set("categoria", e.target.value==="__nuova__" ? "" : e.target.value)}
              style={S.inp}
            >
              {f.categoria && !(categorieEsistenti||[]).includes(f.categoria) && (
                <option value={f.categoria}>{f.categoria} (attuale)</option>
              )}
              {(categorieEsistenti||[]).map(c=>(<option key={c} value={c}>{c}</option>))}
              <option value="__nuova__">+ Nuova categoria…</option>
            </select>
            {!(categorieEsistenti||[]).includes(f.categoria) && (
              <input value={f.categoria} onChange={e=>set("categoria",e.target.value)} placeholder="Nome della nuova categoria" style={{...S.inp,marginTop:8}}/>
            )}
            <div style={{fontSize:11,color:"#9AA3AB",marginTop:3}}>Viene salvata automaticamente in MAIUSCOLO.</div>
          </>)}

          {campo("Settore (uno o più)",
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {SETTORI_DISPONIBILI.map(s=>{
                const on = settori.includes(s);
                return (
                  <button key={s} onClick={()=>toggleSettore(s)} style={{
                    border:`1px solid ${on?C.ink:C.paperLine}`, borderRadius:7,
                    padding:"8px 14px", fontSize:12.5, cursor:"pointer", fontWeight:on?600:400,
                    background:on?C.ink:"#fff", color:on?"#fff":"#5B6770", textTransform:"capitalize",
                  }}>{on?"✓ ":""}{s}</button>
                );
              })}
            </div>
          )}

          {campo("Tipologia", <CampoSelezionabile valore={f.tipologia} onChange={v=>set("tipologia",v)} opzioni={tipologieEsistenti} placeholderNuovo="es. PONTI 2 COLONNE" sentinellaLabel="— nuova tipologia —"/>)}
          {campo("Marca", <CampoSelezionabile valore={f.marchio} onChange={v=>set("marchio",v)} opzioni={marchiEsistenti} placeholderNuovo="es. OMCN" sentinellaLabel="— nuova marca —"/>)}

          {campo("Descrizione", <input value={f.descrizione} onChange={e=>set("descrizione",e.target.value)} style={S.inp}/>)}
          {campo("Descrizione per preventivo (una caratteristica per riga)",
            <textarea value={f.desc_prev} onChange={e=>set("desc_prev",e.target.value)} rows={3} style={{...S.inp,resize:"vertical",fontFamily:F_BODY}}/>
          )}

          <div style={{display:"flex",gap:10}}>
            <div style={{flex:1}}>{campo("Unità", <input value={f.um} onChange={e=>set("um",e.target.value)} style={S.inp}/>)}</div>
            <div style={{flex:1}}>{campo("Listino €", <input type="number" value={f.listino} onChange={e=>set("listino",e.target.value)} style={S.inp}/>)}</div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <div style={{flex:1}}>{campo("Sconto %", <input type="number" value={f.sconto} onChange={e=>set("sconto",e.target.value)} style={S.inp}/>)}</div>
            <div style={{flex:1}}>{campo("Netto € (vuoto = calcolato)", <input type="number" value={f.netto} onChange={e=>set("netto",e.target.value)} placeholder={nettoAuto!==null?String(nettoAuto):"0.00"} style={S.inp}/>)}</div>
          </div>
          {f.netto==="" && nettoAuto!==null && (
            <div style={{fontSize:11,fontFamily:F_MONO,color:C.steel,marginTop:-4,marginBottom:11}}>Netto calcolato: € {nettoAuto}</div>
          )}

          {campo("Tipo prezzo",
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {TIPI_PREZZO.map(tp=>{
                const on=f.tipo_prezzo===tp.v;
                return (
                  <button key={tp.v} onClick={()=>set("tipo_prezzo",tp.v)} style={{
                    border:`1px solid ${on?C.ink:C.paperLine}`, borderRadius:7, padding:"7px 12px",
                    fontSize:12, cursor:"pointer", fontWeight:on?600:400,
                    background:on?C.ink:"#fff", color:on?"#fff":"#5B6770",
                  }}>{tp.label}</button>
                );
              })}
            </div>
          )}

          {campo("Immagine prodotto", <>
            <div style={{display:"flex",gap:8}}>
              <input value={f.img} onChange={e=>set("img",e.target.value)} placeholder="https://… oppure carica un file" style={{...S.inp,flex:1}}/>
              <button type="button" onClick={()=>fileImgRef.current?.click()} disabled={caricandoImg} style={{...S.btnS,padding:"0 14px",whiteSpace:"nowrap",opacity:caricandoImg?0.6:1}}>
                {caricandoImg ? "Carico…" : "⬆ CARICA"}
              </button>
              <input ref={fileImgRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{caricaImmagineFile(e.target.files[0]); e.target.value="";}}/>
            </div>
            {erroreImg && <div style={{fontSize:11,color:C.danger,marginTop:4}}>{erroreImg}</div>}
            {f.img && (
              <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
                <img src={f.img} alt="anteprima" style={{width:48,height:48,objectFit:"contain",border:`1px solid ${C.paperLine}`,borderRadius:6,background:C.paper}} onError={e=>{e.target.style.display="none";}}/>
                <span style={{fontSize:11,color:"#9AA3AB"}}>Anteprima</span>
              </div>
            )}
          </>)}

          {campo("Schede tecniche (PDF)", <>
            {schede.length > 0 && (
              <div style={{marginBottom:10}}>
                {schede.map((s,i)=>(
                  <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
                    <input value={s.nome} onChange={e=>rinominaScheda(i,e.target.value)} placeholder="es. INFO PRODOTTO" style={{...S.inp,flex:1}}/>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:C.ink,whiteSpace:"nowrap"}}>Apri</a>
                    <button type="button" onClick={()=>rimuoviScheda(i)} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:16,padding:"0 4px"}}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={()=>fileSchedaRef.current?.click()} disabled={caricandoScheda} style={{...S.btnS,padding:"9px 14px",opacity:caricandoScheda?0.6:1}}>
              {caricandoScheda ? "Carico…" : "⬆ Aggiungi scheda tecnica (PDF)"}
            </button>
            <input ref={fileSchedaRef} type="file" accept="application/pdf" style={{display:"none"}} onChange={e=>{caricaSchedaFile(e.target.files[0]); e.target.value="";}}/>
            {erroreScheda && <div style={{fontSize:11,color:C.danger,marginTop:4}}>{erroreScheda}</div>}
            <div style={{fontSize:11,color:"#9AA3AB",marginTop:6}}>
              Carica il PDF, poi scrivi il nome da mostrare (es. "INFO PRODOTTO", "SCHEDA PER INSTALLAZIONE"). Puoi caricarne più di uno.
            </div>
          </>)}

          {campo("Video prodotto (URL, opzionale)", <input value={f.video} onChange={e=>set("video",e.target.value)} placeholder="https://www.youtube.com/... oppure sito del produttore" style={S.inp}/>)}
          {campo("Note", <input value={f.note} onChange={e=>set("note",e.target.value)} style={S.inp}/>)}

          <button onClick={salva} disabled={stato==="salvo"} style={{...S.btnP,width:"100%",padding:"12px",marginTop:4,opacity:stato==="salvo"?0.6:1}}>
            {stato==="salvo" ? "Salvataggio…" : "Salva modifiche"}
          </button>

          {msg && (
            <div style={{marginTop:12,fontSize:12,fontFamily:F_MONO,color: stato==="errore"?C.danger : stato==="fatto"?C.ok : C.steel}}>
              {stato==="errore"?"● ":stato==="fatto"?"✓ ":"… "}{msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
