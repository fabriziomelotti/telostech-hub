import { useState, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// AUTENTICAZIONE — Supabase Auth via REST (nessuna libreria esterna)
// Login con email + password; il RUOLO viene letto dalla tabella `profili`.
//
// MFA (TOTP, obbligatorio per tutti gli utenti):
// Ci appoggiamo al livello di garanzia nativo di Supabase Auth (claim "aal"
// dentro l'access token): aal1 = solo password, aal2 = password + secondo
// fattore verificato. La sessione persistita in localStorage (STORAGE_KEY)
// mantiene l'aal con cui è stata creata anche attraverso i refresh — quindi
// su un dispositivo già verificato non viene MAI richiesto un nuovo codice,
// mentre un login da zero (dispositivo nuovo, o dopo logout) riparte sempre
// da aal1 e va rielevato. Nessuna tabella custom di "dispositivi fidati":
// la garanzia è verificata realmente da Supabase dentro il JWT, non solo
// lato app.
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://trexrsxfjcysbigrjiwg.supabase.co";
// Nota: usiamo la nuova "publishable key" (sb_publishable_...) al posto della
// legacy anon key, per poter disattivare quest'ultima insieme a service_role
// (Supabase permette di disattivarle solo insieme). Stesso ruolo, stesso
// posto nel codice — solo il valore è cambiato.
const SUPABASE_ANON_KEY = "sb_publishable_p5wsUvOwpGTxGd3TQ9BPTg_mZyhk6JN";

// dove salviamo la sessione tra un refresh e l'altro
const STORAGE_KEY = "telos_auth";

// ─── Chiamate REST ad Auth ───────────────────────────────────────────────────

// Login: restituisce { access_token, refresh_token, user }
async function authLogin(email, password){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if(!res.ok){
    const msg = data?.error_description || data?.msg || data?.error || "Credenziali non valide";
    throw new Error(msg);
  }
  return data;
}

// Rinnova la sessione da un refresh_token salvato
async function authRefresh(refresh_token){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  });
  if(!res.ok) throw new Error("Sessione scaduta");
  return res.json();
}

// Logout lato server (invalida il token)
async function authLogout(access_token){
  try{
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${access_token}`,
      },
    });
  }catch{ /* ignora errori di rete in logout */ }
}

// Legge il profilo (ruolo, nome) dell'utente loggato usando il SUO token
async function leggiProfilo(access_token, userId){
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profili?select=ruolo,nome,email,attivo,cliente_codice&id=eq.${userId}`,
    {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${access_token}`,
      },
    }
  );
  if(!res.ok) throw new Error("Impossibile leggere il profilo");
  const righe = await res.json();
  return righe?.[0] || null;
}

// ─── MFA (TOTP) — chiamate REST dirette agli endpoint /auth/v1/factors ──────

// Legge il claim "aal" (Authenticator Assurance Level) dal JWT senza bisogno
// di round-trip col server: aal1 = solo password, aal2 = password + MFA.
function decodificaAal(access_token){
  try{
    const parte = access_token.split(".")[1];
    const base64 = parte.replace(/-/g,"+").replace(/_/g,"/");
    const padded = base64 + "===".slice((base64.length + 3) % 4);
    const payload = JSON.parse(atob(padded));
    return payload.aal || "aal1";
  }catch{
    return "aal1";
  }
}

// Elenco dei fattori MFA già registrati dall'utente (arriva dentro l'oggetto
// utente completo — non esiste un endpoint REST separato per la sola lista)
async function mfaListaFattori(access_token){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${access_token}` },
  });
  if(!res.ok) throw new Error("Impossibile leggere i fattori di sicurezza");
  const utente = await res.json();
  return utente?.factors || [];
}

// Rimuove un fattore (usato per pulire i tentativi di registrazione
// abbandonati prima di crearne uno nuovo, evitando l'accumulo)
async function mfaElimina(access_token, factorId){
  await fetch(`${SUPABASE_URL}/auth/v1/factors/${factorId}`, {
    method: "DELETE",
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${access_token}` },
  }).catch(()=>{});
}

// Crea un nuovo fattore TOTP: risposta include QR (SVG) e secret per
// l'inserimento manuale nell'app authenticator
async function mfaRegistra(access_token){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/factors`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ factor_type: "totp", friendly_name: "Telos Tech Hub" }),
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data?.error_description || data?.msg || data?.message || "Impossibile avviare la registrazione del secondo fattore");
  return data; // { id, totp: { qr_code, secret, uri } }
}

// Apre una "sfida" (nonce a breve scadenza) per il fattore indicato
async function mfaSfida(access_token, factorId){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/factors/${factorId}/challenge`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${access_token}` },
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data?.error_description || data?.msg || data?.message || "Impossibile avviare la verifica");
  return data; // { id, expires_at }
}

// Verifica il codice a 6 cifre contro la sfida aperta. Se corretto, Supabase
// restituisce una NUOVA sessione (access_token/refresh_token) già a aal2 —
// è questa la sessione che salviamo, non quella di partenza.
async function mfaVerifica(access_token, factorId, challengeId, code){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/factors/${factorId}/verify`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
  const data = await res.json();
  if(!res.ok) throw new Error(data?.error_description || data?.msg || data?.message || "Codice non valido o scaduto");
  return data; // nuova sessione, aal2
}

// ─── Hook di sessione ────────────────────────────────────────────────────────
// Espone: sessione ({token, user, ruolo, nome}) | null, stato di caricamento,
// mfaStep (null | {tipo:"enroll",...} | {tipo:"verifica"}) e le funzioni
// login/completaMFA/annullaMFA/logout. La sessione persiste tra i refresh.
export function useAuth(){
  const [sessione, setSessione] = useState(null);
  const [caricando, setCaricando] = useState(true);
  const [errore, setErrore] = useState("");
  const [mfaStep, setMfaStep] = useState(null);
  // Rinnovo automatico del token: Supabase emette access_token validi circa
  // un'ora (expires_in, in secondi, nella risposta di login/refresh). Prima
  // non c'era alcun rinnovo dopo il caricamento iniziale della pagina: una
  // volta scaduto il token, ogni chiamata falliva con 401 finché non si
  // ricaricava la pagina (che forza un nuovo refresh all'avvio). Questi tre
  // riferimenti tengono traccia del timer pianificato, di QUANDO scade il
  // token corrente e dell'ultima sessione nota (per poterla leggere dagli
  // event listener sotto, che restano montati una volta sola).
  const timerRef = useRef(null);
  const scadenzaRef = useRef(0); // Date.now() + ms alla prossima scadenza
  const sessioneRef = useRef(null);
  useEffect(()=>{ sessioneRef.current = sessione; },[sessione]);
  // Sessione "in sospeso" (aal1) durante l'enrollment/verifica MFA: non è
  // ancora la sessione finale, quindi non entra in `sessione` né viene
  // persistita, ma serve come Authorization per le chiamate agli endpoint
  // /auth/v1/factors/*.
  const pendingAuthRef = useRef(null);
  const pendingFactorIdRef = useRef(null);

  // costruisce l'oggetto sessione a partire dai dati Auth + profilo
  async function componiSessione(auth){
    const profilo = await leggiProfilo(auth.access_token, auth.user.id);
    if(!profilo){
      throw new Error("Profilo non trovato. Contatta l'amministratore.");
    }
    if(profilo.attivo === false){
      throw new Error("Utente disattivato. Contatta l'amministratore.");
    }
    return {
      token: auth.access_token,
      refresh: auth.refresh_token,
      expiresIn: auth.expires_in || 3600,
      user: auth.user,
      ruolo: profilo.ruolo,
      nome: profilo.nome || profilo.email,
      email: profilo.email,
      cliente_codice: profilo.cliente_codice || null,
    };
  }

  function pianificaProssimoRefresh(refreshToken, expiresIn){
    if(timerRef.current) clearTimeout(timerRef.current);
    const margineSec = 300; // rinnova 5 minuti prima della scadenza reale
    const attesaSec = Math.max((expiresIn||3600) - margineSec, 30);
    scadenzaRef.current = Date.now() + attesaSec*1000;
    timerRef.current = setTimeout(()=>{ eseguiRefreshConRetry(refreshToken); }, attesaSec*1000);
  }

  // Rende definitiva una sessione già a aal2: la salva, pianifica il
  // prossimo rinnovo automatico e ripulisce ogni stato MFA in sospeso.
  async function finalizzaSessione(auth){
    const nuova = await componiSessione(auth);
    setSessione(nuova);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ refresh: nuova.refresh }));
    pianificaProssimoRefresh(nuova.refresh, nuova.expiresIn);
    pendingAuthRef.current = null;
    pendingFactorIdRef.current = null;
    setMfaStep(null);
    return nuova;
  }

  // Punto unico da cui passa OGNI sessione Auth appena ottenuta (login o
  // refresh): guarda il livello di garanzia e decide se può proseguire
  // direttamente (aal2 — dispositivo già verificato) o se deve fermarsi su
  // una schermata MFA (aal1 — dispositivo nuovo o login da zero). Ritorna
  // true se la sessione è definitiva, false se resta in sospeso su MFA.
  async function elaboraAutenticazione(auth){
    const livello = decodificaAal(auth.access_token);
    if(livello === "aal2"){
      await finalizzaSessione(auth);
      return true;
    }
    // aal1: bisogna passare da MFA prima di entrare
    const fattori = await mfaListaFattori(auth.access_token);
    const verificato = fattori.find(f => f.factor_type === "totp" && f.status === "verified");
    if(verificato){
      // fattore già registrato in passato: basta il codice, niente nuovo QR
      pendingAuthRef.current = auth;
      pendingFactorIdRef.current = verificato.id;
      setMfaStep({ tipo: "verifica" });
      return false;
    }
    // nessun fattore verificato: registrazione obbligatoria. Prima ripulisce
    // eventuali tentativi precedenti abbandonati, per non accumulare fattori
    // "unverified" orfani ad ogni reload della pagina di enrollment.
    const daPulire = fattori.filter(f => f.factor_type === "totp" && f.status !== "verified");
    for(const f of daPulire) await mfaElimina(auth.access_token, f.id);
    const nuovoFattore = await mfaRegistra(auth.access_token);
    pendingAuthRef.current = auth;
    pendingFactorIdRef.current = nuovoFattore.id;
    setMfaStep({
      tipo: "enroll",
      qrSvg: nuovoFattore.totp?.qr_code || "",
      secret: nuovoFattore.totp?.secret || "",
      uri: nuovoFattore.totp?.uri || "",
    });
    return false;
  }

  // Se il rinnovo pianificato fallisce (es. un blip di rete), riprova ogni
  // minuto fino a 3 volte invece di lasciar scadere la sessione in
  // silenzio — dopo, l'utente lo scoprirà al prossimo 401 e potrà rifare
  // login quando preferisce, senza essere interrotto a forza.
  async function eseguiRefreshConRetry(refreshToken, tentativi=0){
    try{
      const auth = await authRefresh(refreshToken);
      await elaboraAutenticazione(auth);
    }catch{
      if(tentativi < 3){
        timerRef.current = setTimeout(()=>{ eseguiRefreshConRetry(refreshToken, tentativi+1); }, 60000);
      }
    }
  }

  // Se la scheda era in background o il dispositivo in sospensione, i timer
  // del browser possono non scattare puntuali (spesso vengono sospesi): al
  // ritorno in primo piano controlliamo se il token risulta già scaduto e,
  // in tal caso, lo rinnoviamo subito invece di aspettare la prossima
  // chiamata (che altrimenti fallirebbe con 401).
  useEffect(()=>{
    function alRitorno(){
      if(document.visibilityState!=="visible") return;
      const s = sessioneRef.current;
      if(!s) return;
      if(Date.now() >= scadenzaRef.current){
        authRefresh(s.refresh).then(elaboraAutenticazione).catch(()=>{});
      }
    }
    document.addEventListener("visibilitychange", alRitorno);
    window.addEventListener("focus", alRitorno);
    return ()=>{
      document.removeEventListener("visibilitychange", alRitorno);
      window.removeEventListener("focus", alRitorno);
    };
  }, []);

  // al primo mount: prova a ripristinare la sessione salvata
  useEffect(()=>{
    let vivo = true;
    (async ()=>{
      try{
        const raw = localStorage.getItem(STORAGE_KEY);
        if(!raw){ if(vivo) setCaricando(false); return; }
        const salvata = JSON.parse(raw);
        // rinnova il token col refresh_token salvato: se la sessione era già
        // a aal2 (dispositivo già verificato) prosegue dritta, altrimenti
        // (dispositivo verificato PRIMA che esistesse l'MFA) si ferma su MFA
        const auth = await authRefresh(salvata.refresh);
        await elaboraAutenticazione(auth);
      }catch{
        localStorage.removeItem(STORAGE_KEY);
      }finally{
        if(vivo) setCaricando(false);
      }
    })();
    return ()=>{ vivo = false; if(timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  async function login(email, password){
    setErrore("");
    try{
      const auth = await authLogin(email.trim(), password);
      return await elaboraAutenticazione(auth);
    }catch(err){
      setErrore(err.message);
      return false;
    }
  }

  // Usata sia per confermare l'enrollment (primo QR scansionato) sia per la
  // verifica su dispositivo nuovo: in entrambi i casi è "apri una sfida sul
  // fattore in sospeso e verifica il codice digitato".
  async function completaMFA(code){
    setErrore("");
    try{
      const auth = pendingAuthRef.current;
      const factorId = pendingFactorIdRef.current;
      if(!auth || !factorId) throw new Error("Sessione scaduta, effettua di nuovo l'accesso.");
      const sfida = await mfaSfida(auth.access_token, factorId);
      const nuovoAuth = await mfaVerifica(auth.access_token, factorId, sfida.id, code);
      await finalizzaSessione(nuovoAuth);
      return true;
    }catch(err){
      setErrore(err.message);
      return false;
    }
  }

  // Annulla un enrollment/verifica in corso e torna alla schermata di login
  // pulita (es. l'utente si accorge di aver sbagliato account, o il telefono
  // non è a portata di mano in questo momento)
  async function annullaMFA(){
    const auth = pendingAuthRef.current;
    if(timerRef.current) clearTimeout(timerRef.current);
    pendingAuthRef.current = null;
    pendingFactorIdRef.current = null;
    setMfaStep(null);
    setErrore("");
    if(auth?.access_token) await authLogout(auth.access_token);
  }

  async function logout(){
    if(timerRef.current) clearTimeout(timerRef.current);
    if(sessione?.token) await authLogout(sessione.token);
    localStorage.removeItem(STORAGE_KEY);
    setSessione(null);
  }

  return { sessione, caricando, errore, setErrore, mfaStep, login, completaMFA, annullaMFA, logout };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHERMATA DI LOGIN — riusa lo stile Telos (dark/light, loghi, card)
// Props: onLogin(email,password) -> Promise<bool>, errore, Logo, G, C, S, F_*
// (le passiamo da App.jsx così il file non duplica gli asset dei loghi)
// mfaStep/onCompletaMFA/onAnnullaMFA: gestiscono la schermata di enrollment
// o verifica del secondo fattore, mostrata al posto del form quando attiva.
// ═══════════════════════════════════════════════════════════════════════════
export function LoginReale({ onLogin, errore, Logo, G, C, S, F_BODY, F_MONO, mfaStep, onCompletaMFA, onAnnullaMFA }){
  const [dark, setDark] = useState(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [codice, setCodice] = useState("");
  const [verificando, setVerificando] = useState(false);

  useEffect(()=>{
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = e => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  },[]);

  // il codice va reinserito da capo ogni volta che cambia schermata MFA
  useEffect(()=>{ setCodice(""); },[mfaStep?.tipo]);

  const L = dark ? {
    bg: C.inkDeep, card: C.surface, cardBorder: C.surfaceRaised,
    labelColor: C.steel, subColor: C.steelLight,
    inputBg: C.inkDeep, inputColor: "#fff", inputBorder: C.surfaceRaised,
    footerColor: "#4A5680",
  } : {
    bg: "#F4F2EC", card: "#fff", cardBorder: C.paperLine,
    labelColor: "#9AA3AB", subColor: "#6B7280",
    inputBg: "#fff", inputColor: C.charcoal, inputBorder: C.paperLine,
    footerColor: "#9AA3AB",
  };

  async function submit(){
    if(inCorso) return;
    if(!email.trim() || !password){ return; }
    setInCorso(true);
    await onLogin(email, password);
    setInCorso(false);
  }

  async function submitCodice(){
    if(verificando || codice.trim().length < 6) return;
    setVerificando(true);
    await onCompletaMFA(codice.trim());
    setVerificando(false);
  }

  const inputStyle = {
    width:"100%", padding:"11px 12px", fontSize:13.5, borderRadius:7,
    background:L.inputBg, color:L.inputColor, border:`1px solid ${L.inputBorder}`,
    marginBottom:12, outline:"none", fontFamily:F_BODY,
  };

  const codiceStyle = {
    ...inputStyle, fontFamily:F_MONO, fontSize:22, letterSpacing:"0.35em",
    textAlign:"center", padding:"13px 10px",
  };

  const eyebrowStyle = {
    fontFamily:F_MONO, fontSize:10.5, fontWeight:600, color:L.labelColor,
    textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6,
  };
  const subStyle = { fontSize:11.5, color:L.subColor, marginBottom:16, lineHeight:1.5 };

  const erroreBox = errore && (
    <div style={{fontSize:11.5,color:C.danger,background:"rgba(200,75,58,0.12)",borderRadius:6,padding:"8px 10px",marginBottom:12,fontFamily:F_MONO}}>
      ● {errore}
    </div>
  );

  function BtnAnnulla(){
    return (
      <button
        onClick={onAnnullaMFA}
        style={{...S.btnS,width:"100%",padding:"10px",fontSize:12.5,marginTop:10}}
      >
        Annulla e torna al login
      </button>
    );
  }

  let corpo;

  if(mfaStep?.tipo === "enroll"){
    // primo accesso in assoluto: registrazione obbligatoria del secondo fattore
    corpo = (
      <>
        <div style={eyebrowStyle}>Protezione account · Passo obbligatorio</div>
        <div style={subStyle}>
          Inquadra questo codice con un'app authenticator (Google Authenticator, Microsoft Authenticator, ecc.), poi inserisci il codice a 6 cifre generato per confermare.
        </div>
        <div style={{background:"#fff",borderRadius:8,padding:14,display:"flex",justifyContent:"center",marginBottom:14}}>
          {mfaStep.qrSvg?.startsWith("data:") ? (
            <img src={mfaStep.qrSvg} alt="QR codice MFA" style={{width:180,height:180}}/>
          ) : (
            <div style={{width:180,height:180}} dangerouslySetInnerHTML={{__html: mfaStep.qrSvg}}/>
          )}
        </div>
        {mfaStep.secret && (
          <div style={{fontSize:10.5,color:L.subColor,marginBottom:14,lineHeight:1.6}}>
            Non riesci a scansionare? Inserisci questo codice manualmente nell'app:
            <div style={{fontFamily:F_MONO,fontSize:12,color:L.inputColor,background:L.inputBg,border:`1px solid ${L.inputBorder}`,borderRadius:6,padding:"8px 10px",marginTop:6,wordBreak:"break-all",userSelect:"all"}}>
              {mfaStep.secret}
            </div>
          </div>
        )}
        <input
          type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          value={codice}
          onChange={e=>setCodice(e.target.value.replace(/\D/g,""))}
          onKeyDown={e=>{ if(e.key==="Enter") submitCodice(); }}
          placeholder="000000"
          style={codiceStyle}
        />
        {erroreBox}
        <button
          onClick={submitCodice}
          disabled={verificando || codice.trim().length < 6}
          style={{...S.btnAccent,width:"100%",padding:"13px",fontSize:14,opacity:(verificando||codice.trim().length<6)?0.5:1,cursor:(verificando||codice.trim().length<6)?"default":"pointer"}}
        >
          {verificando ? "Verifica in corso…" : "Conferma e attiva"}
        </button>
        <BtnAnnulla/>
      </>
    );
  } else if(mfaStep?.tipo === "verifica"){
    // dispositivo nuovo: fattore già registrato, serve solo il codice
    corpo = (
      <>
        <div style={eyebrowStyle}>Nuovo dispositivo rilevato</div>
        <div style={subStyle}>
          Per motivi di sicurezza, da un dispositivo mai usato prima serve il codice della tua app authenticator.
        </div>
        <input
          type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          autoFocus
          value={codice}
          onChange={e=>setCodice(e.target.value.replace(/\D/g,""))}
          onKeyDown={e=>{ if(e.key==="Enter") submitCodice(); }}
          placeholder="000000"
          style={codiceStyle}
        />
        {erroreBox}
        <button
          onClick={submitCodice}
          disabled={verificando || codice.trim().length < 6}
          style={{...S.btnAccent,width:"100%",padding:"13px",fontSize:14,opacity:(verificando||codice.trim().length<6)?0.5:1,cursor:(verificando||codice.trim().length<6)?"default":"pointer"}}
        >
          {verificando ? "Verifica in corso…" : "Verifica e accedi"}
        </button>
        <BtnAnnulla/>
      </>
    );
  } else {
    // form di login normale
    corpo = (
      <>
        <div style={eyebrowStyle}>Accesso</div>
        <div style={subStyle}>Inserisci le tue credenziali</div>
        <input
          type="email"
          value={email}
          onChange={e=>setEmail(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") document.getElementById("login-pwd")?.focus(); }}
          placeholder="Email"
          autoComplete="username"
          style={inputStyle}
        />
        <input
          id="login-pwd"
          type="password"
          value={password}
          onChange={e=>setPassword(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") submit(); }}
          placeholder="Password"
          autoComplete="current-password"
          style={inputStyle}
        />
        {erroreBox}
        <button
          onClick={submit}
          disabled={inCorso || !email.trim() || !password}
          style={{...S.btnAccent,width:"100%",padding:"13px",fontSize:14,opacity:(inCorso||!email.trim()||!password)?0.5:1,cursor:(inCorso||!email.trim()||!password)?"default":"pointer"}}
        >
          {inCorso ? "Accesso in corso…" : "Accedi al sistema"}
        </button>
      </>
    );
  }

  return (
    <div style={{minHeight:"100dvh",background:L.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:F_BODY,transition:"background 0.3s"}}>
      <style>{G}</style>
      <div style={{maxWidth:360,width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <Logo variant="full" height={36}/>
          <Logo variant="telostech" height={38}/>
        </div>

        <div style={{background:L.card,border:`1px solid ${L.cardBorder}`,borderRadius:10,padding:"24px 22px",transition:"background 0.3s,border-color 0.3s"}}>
          {corpo}
        </div>

        <div style={{fontSize:10.5,color:L.footerColor,textAlign:"center",marginTop:18,lineHeight:1.6,fontFamily:F_MONO}}>
          TELOS TECH HUB · ACCESSO RISERVATO
        </div>
      </div>
    </div>
  );
}
