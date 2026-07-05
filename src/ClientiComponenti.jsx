// ============================================================
// Telos Tech Hub — Anagrafica clienti
// 1) ImportClienti  : interfaccia (solo admin) per aggiornare la lista
//                     caricando il file Excel/CSV direttamente dall'app
// 2) SelezioneCliente: selettore da usare prima di preventivi / ordini /
//                     bacheca interventi. Ricerca su TUTTI i campi.
//
// Requisiti:
//  - SheetJS caricato via CDN (vedi nota in fondo) -> window.XLSX
//  - client supabase già inizializzato altrove come `supabase`
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
// Riusa il client Supabase già inizializzato nel progetto.
// Se nel tuo progetto il percorso o il nome dell'export è diverso,
// adatta questa sola riga (es. import supabase from './supabaseClient').
import { supabase } from './supabase/client';

// --- palette brand ---
const INDACO = '#162758';
const CIANO = '#57CECA';
const ANTRACITE = '#232323';

// Mappa colonne Excel -> colonne tabella `clienti`
const MAP = {
  'Codice': 'codice',
  'Ragione sociale': 'ragione_sociale',
  'Ragione sociale aggiuntiva': 'rag_sociale_agg',
  'Indirizzo': 'indirizzo',
  'Località': 'localita',
  'Provincia': 'provincia',
  'CAP': 'cap',
  'Codice Fiscale': 'codice_fiscale',
  'Partita IVA': 'partita_iva',
  'Telefono': 'telefono',
  'Mail': 'mail',
  'Descrizione filiale': 'filiale',
  'Descrizione categoria': 'categoria',
  'Descrizione pagamento': 'pagamento',
};

// ============================================================
// 1) IMPORT CLIENTI  (solo admin)
// ============================================================
export function ImportClienti({ ruolo }) {
  const [stato, setStato] = useState('idle'); // idle | leggo | carico | fatto | errore
  const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState({ fatti: 0, totali: 0 });
  const inputRef = useRef(null);

  if (ruolo !== 'admin') {
    return (
      <div style={box}>
        <p style={{ color: ANTRACITE, margin: 0 }}>
          L'aggiornamento dell'anagrafica clienti è riservato agli amministratori.
        </p>
      </div>
    );
  }

  const gestisciFile = async (file) => {
    if (!file) return;
    try {
      setStato('leggo');
      setMsg('Lettura del file in corso…');

      const buffer = await file.arrayBuffer();
      const wb = window.XLSX.read(buffer, { type: 'array' });

      // Prende il primo foglio con intestazione "Codice"
      let righe = [];
      for (const nome of wb.SheetNames) {
        const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: null, raw: false });
        if (raw.length && ('Codice' in raw[0])) { righe = raw; break; }
      }
      if (!righe.length) {
        setStato('errore');
        setMsg('Nessun foglio con colonna "Codice" trovato nel file.');
        return;
      }

      // Trasforma nelle colonne DB, scarta righe senza codice, dedup su codice
      const visti = new Set();
      const record = [];
      for (const r of righe) {
        const cod = (r['Codice'] ?? '').toString().trim();
        if (!cod || visti.has(cod)) continue;
        visti.add(cod);
        const row = { updated_at: new Date().toISOString() };
        for (const [xlsCol, dbCol] of Object.entries(MAP)) {
          const v = r[xlsCol];
          row[dbCol] = v == null ? null : v.toString().trim() || null;
        }
        record.push(row);
      }

      setStato('carico');
      setProgress({ fatti: 0, totali: record.length });

      // Upsert a blocchi di 500 (upsert = inserisce o aggiorna su chiave `codice`)
      const BATCH = 500;
      for (let i = 0; i < record.length; i += BATCH) {
        const blocco = record.slice(i, i + BATCH);
        const { error } = await supabase
          .from('clienti')
          .upsert(blocco, { onConflict: 'codice' });
        if (error) {
          setStato('errore');
          setMsg(`Errore durante il caricamento (blocco ${i / BATCH + 1}): ${error.message}`);
          return;
        }
        setProgress({ fatti: Math.min(i + BATCH, record.length), totali: record.length });
      }

      setStato('fatto');
      setMsg(`Anagrafica aggiornata: ${record.length.toLocaleString('it-IT')} clienti caricati.`);
    } catch (e) {
      setStato('errore');
      setMsg('Errore imprevisto: ' + (e?.message || e));
    }
  };

  const pct = progress.totali ? Math.round((progress.fatti / progress.totali) * 100) : 0;

  return (
    <div style={box}>
      <h3 style={{ color: INDACO, fontFamily: 'Oswald, sans-serif', margin: '0 0 12px' }}>
        Aggiorna anagrafica clienti
      </h3>
      <p style={{ color: ANTRACITE, fontSize: 14, marginTop: 0 }}>
        Carica il file Excel esportato dal gestionale. I clienti esistenti verranno
        aggiornati, i nuovi aggiunti. L'operazione può richiedere qualche secondo.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={(e) => gestisciFile(e.target.files?.[0])}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={stato === 'leggo' || stato === 'carico'}
        style={btnPrimario(stato === 'leggo' || stato === 'carico')}
      >
        {stato === 'carico' ? `Caricamento… ${pct}%` : 'Seleziona file e carica'}
      </button>

      {stato === 'carico' && (
        <div style={{ marginTop: 14 }}>
          <div style={{ height: 8, background: '#e6e6e6', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: CIANO, transition: 'width .2s' }} />
          </div>
          <div style={{ fontSize: 12, color: ANTRACITE, marginTop: 6 }}>
            {progress.fatti.toLocaleString('it-IT')} / {progress.totali.toLocaleString('it-IT')}
          </div>
        </div>
      )}

      {msg && (
        <p style={{
          marginTop: 14, fontSize: 14,
          color: stato === 'errore' ? '#b00020' : INDACO,
          fontWeight: 500,
        }}>
          {msg}
        </p>
      )}
    </div>
  );
}

// ============================================================
// 2) SELEZIONE CLIENTE  (ricerca su tutti i campi, server-side)
// ============================================================
export function SelezioneCliente({ onSeleziona, clienteSelezionato }) {
  const [query, setQuery] = useState('');
  const [risultati, setRisultati] = useState([]);
  const [caricamento, setCaricamento] = useState(false);
  const [aperto, setAperto] = useState(false);
  const timer = useRef(null);

  const cerca = useCallback(async (q) => {
    const t = q.trim();
    if (t.length < 2) { setRisultati([]); return; }
    setCaricamento(true);

    // Ricerca "contiene" su tutti i campi utili con OR.
    // ilike = case-insensitive; % attorno al termine = "contiene".
    const term = `%${t}%`;
    const { data, error } = await supabase
      .from('clienti')
      .select('codice, ragione_sociale, rag_sociale_agg, indirizzo, localita, provincia, cap, partita_iva, codice_fiscale, telefono, mail, filiale')
      .or([
        `codice.ilike.${term}`,
        `ragione_sociale.ilike.${term}`,
        `rag_sociale_agg.ilike.${term}`,
        `localita.ilike.${term}`,
        `provincia.ilike.${term}`,
        `partita_iva.ilike.${term}`,
        `codice_fiscale.ilike.${term}`,
        `mail.ilike.${term}`,
        `telefono.ilike.${term}`,
      ].join(','))
      .limit(25);

    setCaricamento(false);
    if (!error) setRisultati(data || []);
  }, []);

  // debounce 300ms
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => cerca(query), 300);
    return () => timer.current && clearTimeout(timer.current);
  }, [query, cerca]);

  const scegli = (c) => {
    onSeleziona?.(c);
    setQuery('');
    setRisultati([]);
    setAperto(false);
  };

  return (
    <div style={{ position: 'relative', maxWidth: 640 }}>
      <label style={{ display: 'block', fontFamily: 'Oswald, sans-serif', color: INDACO, fontSize: 14, marginBottom: 6 }}>
        Cliente
      </label>

      {clienteSelezionato ? (
        <div style={cardCliente}>
          <div>
            <div style={{ fontWeight: 600, color: INDACO }}>
              {clienteSelezionato.ragione_sociale || clienteSelezionato.codice}
            </div>
            <div style={{ fontSize: 13, color: ANTRACITE }}>
              {[clienteSelezionato.localita, clienteSelezionato.provincia].filter(Boolean).join(' (')}
              {clienteSelezionato.provincia ? ')' : ''}
              {clienteSelezionato.partita_iva ? ` · P.IVA ${clienteSelezionato.partita_iva}` : ''}
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: '#666' }}>
              {clienteSelezionato.codice}
            </div>
          </div>
          <button onClick={() => onSeleziona?.(null)} style={btnCambia}>Cambia</button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setAperto(true); }}
            onFocus={() => setAperto(true)}
            placeholder="Cerca per nome, codice, P.IVA, C.F., località, mail…"
            style={inputRicerca}
          />
          {aperto && (query.trim().length >= 2) && (
            <div style={dropdown}>
              {caricamento && <div style={rigaInfo}>Ricerca…</div>}
              {!caricamento && risultati.length === 0 && <div style={rigaInfo}>Nessun cliente trovato.</div>}
              {risultati.map((c) => (
                <div key={c.codice} style={rigaRisultato} onClick={() => scegli(c)}
                     onMouseEnter={(e) => e.currentTarget.style.background = '#f0fbfb'}
                     onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>
                  <div style={{ fontWeight: 600, color: INDACO }}>
                    {c.ragione_sociale || <span style={{ color: '#999' }}>[senza ragione sociale]</span>}
                  </div>
                  <div style={{ fontSize: 12, color: ANTRACITE }}>
                    {[c.localita, c.provincia && `(${c.provincia})`, c.partita_iva && `P.IVA ${c.partita_iva}`]
                      .filter(Boolean).join(' · ')}
                  </div>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#888' }}>
                    {c.codice}{c.filiale ? ` · ${c.filiale}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- stili ----------
const box = { border: '1px solid #e0e0e0', borderRadius: 10, padding: 20, background: 'white', maxWidth: 640 };
const cardCliente = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, border: `2px solid ${CIANO}`, borderRadius: 10, padding: '12px 16px', background: '#f7fefe' };
const inputRicerca = { width: '100%', padding: '11px 14px', borderRadius: 8, border: '1px solid #cfcfcf', fontSize: 15, fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' };
const dropdown = { position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, background: 'white', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.1)', maxHeight: 360, overflowY: 'auto' };
const rigaRisultato = { padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' };
const rigaInfo = { padding: '12px 14px', color: '#888', fontSize: 14 };
const btnCambia = { border: `1px solid ${INDACO}`, background: 'white', color: INDACO, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 };
const btnPrimario = (disabled) => ({ background: disabled ? '#9bb' : INDACO, color: 'white', border: 'none', borderRadius: 8, padding: '11px 20px', fontSize: 15, fontFamily: 'Oswald, sans-serif', cursor: disabled ? 'default' : 'pointer' });

// ============================================================
// NOTA — caricamento SheetJS (per leggere l'Excel nel browser)
// Aggiungi in public/index.html, dentro <head>:
//   <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
// In alternativa: npm install xlsx  e  import * as XLSX from 'xlsx';
// (in tal caso sostituisci window.XLSX con XLSX nel codice sopra)
// ============================================================
