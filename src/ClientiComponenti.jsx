import { useState, useEffect, useRef } from "react";

// ─── SUPABASE REST (fetch diretto — nessuna libreria esterna) ────────────────
// Stessi valori inline usati in App.jsx. Tenuti qui per rendere il file
// autonomo. Se preferisci una sola fonte, esportali da App.jsx e importali.
const SUPABASE_URL = "https://trexrsxfjcysbigrjiwg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyZXhyc3hmamN5c2JpZ3JqaXdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzUwMTMsImV4cCI6MjA5ODMxMTAxM30.NnVQR4sk2NNkVbWkK-6IXYMa7MGQKOduluk1S8r5yG0";

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

// POST/UPSERT con Prefer: resolution=merge-duplicates → inserisce o aggiorna
// sulla primary key (codice). Batch di righe già mappate alle colonne DB.
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

export function SelezioneCliente({ onSeleziona, clienteSelezionato }){
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
        const dati = await sbGet("clienti", params);
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

export function CreaProdotto({ ruolo, onCreato }){
  const vuoto = {
    cod:"", nome:"", categoria:"", tipologia:"", marchio:"",
    descrizione:"", desc_prev:"", um:"pz",
    listino:"", sconto:"", netto:"", tipo_prezzo:"listino", note:"", img:"",
  };
  const [f, setF] = useState(vuoto);
  const [settori, setSettori] = useState([]); // array di stringhe
  const [stato, setStato] = useState("idle"); // idle | salvo | fatto | errore
  const [msg, setMsg] = useState("");

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
      categoria: f.categoria.trim(),
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
      attivo: true,
    };

    try{
      setStato("salvo"); setMsg("Salvataggio…");
      await sbUpsert("prodotti", [riga]);
      setStato("fatto");
      setMsg(`Prodotto "${riga.nome}" salvato. Ricarica il catalogo per vederlo.`);
      setF(vuoto); setSettori([]);
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

      {campo("Categoria *", <input value={f.categoria} onChange={e=>set("categoria",e.target.value)} placeholder="es. PONTI SOLLEVATORI" style={S.inp}/>)}

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

      {campo("Tipologia", <input value={f.tipologia} onChange={e=>set("tipologia",e.target.value)} placeholder="es. PONTI 2 COLONNE" style={S.inp}/>)}
      {campo("Marca", <input value={f.marchio} onChange={e=>set("marchio",e.target.value)} placeholder="es. OMCN" style={S.inp}/>)}

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

      {campo("URL immagine", <input value={f.img} onChange={e=>set("img",e.target.value)} placeholder="https://…" style={S.inp}/>)}
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
