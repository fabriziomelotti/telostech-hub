import { useState, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// AUTENTICAZIONE — Supabase Auth via REST (nessuna libreria esterna)
// Login con email + password; il RUOLO viene letto dalla tabella `profili`.
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
    `${SUPABASE_URL}/rest/v1/profili?select=ruolo,nome,email,attivo&id=eq.${userId}`,
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

// ─── Hook di sessione ────────────────────────────────────────────────────────
// Espone: sessione ({token, user, ruolo, nome}) | null, stato di caricamento,
// e le funzioni login/logout. La sessione persiste tra i refresh di pagina.
export function useAuth(){
  const [sessione, setSessione] = useState(null);
  const [caricando, setCaricando] = useState(true);
  const [errore, setErrore] = useState("");

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
      user: auth.user,
      ruolo: profilo.ruolo,
      nome: profilo.nome || profilo.email,
      email: profilo.email,
    };
  }

  // al primo mount: prova a ripristinare la sessione salvata
  useEffect(()=>{
    let vivo = true;
    (async ()=>{
      try{
        const raw = localStorage.getItem(STORAGE_KEY);
        if(!raw){ if(vivo) setCaricando(false); return; }
        const salvata = JSON.parse(raw);
        // rinnova il token col refresh_token salvato
        const auth = await authRefresh(salvata.refresh);
        const nuova = await componiSessione(auth);
        if(vivo){
          setSessione(nuova);
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ refresh: nuova.refresh }));
        }
      }catch{
        localStorage.removeItem(STORAGE_KEY);
      }finally{
        if(vivo) setCaricando(false);
      }
    })();
    return ()=>{ vivo = false; };
  }, []);

  async function login(email, password){
    setErrore("");
    try{
      const auth = await authLogin(email.trim(), password);
      const nuova = await componiSessione(auth);
      setSessione(nuova);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ refresh: nuova.refresh }));
      return true;
    }catch(err){
      setErrore(err.message);
      return false;
    }
  }

  async function logout(){
    if(sessione?.token) await authLogout(sessione.token);
    localStorage.removeItem(STORAGE_KEY);
    setSessione(null);
  }

  return { sessione, caricando, errore, setErrore, login, logout };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHERMATA DI LOGIN — riusa lo stile Telos (dark/light, loghi, card)
// Props: onLogin(email,password) -> Promise<bool>, errore, Logo, G, C, S, F_*
// (le passiamo da App.jsx così il file non duplica gli asset dei loghi)
// ═══════════════════════════════════════════════════════════════════════════
export function LoginReale({ onLogin, errore, Logo, G, C, S, F_BODY, F_MONO }){
  const [dark, setDark] = useState(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inCorso, setInCorso] = useState(false);

  useEffect(()=>{
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = e => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  },[]);

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

  const inputStyle = {
    width:"100%", padding:"11px 12px", fontSize:13.5, borderRadius:7,
    background:L.inputBg, color:L.inputColor, border:`1px solid ${L.inputBorder}`,
    marginBottom:12, outline:"none", fontFamily:F_BODY,
  };

  return (
    <div style={{minHeight:"100dvh",background:L.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:F_BODY,transition:"background 0.3s"}}>
      <style>{G}</style>
      <div style={{maxWidth:360,width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <Logo variant="full" height={36}/>
          <Logo variant="telostech" height={38}/>
        </div>

        <div style={{background:L.card,border:`1px solid ${L.cardBorder}`,borderRadius:10,padding:"24px 22px",transition:"background 0.3s,border-color 0.3s"}}>
          <div style={{fontFamily:F_MONO,fontSize:10.5,fontWeight:600,color:L.labelColor,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Accesso</div>
          <div style={{fontSize:11.5,color:L.subColor,marginBottom:16,lineHeight:1.5}}>Inserisci le tue credenziali</div>

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

          {errore && (
            <div style={{fontSize:11.5,color:C.danger,background:"rgba(200,75,58,0.12)",borderRadius:6,padding:"8px 10px",marginBottom:12,fontFamily:F_MONO}}>
              ● {errore}
            </div>
          )}

          <button
            onClick={submit}
            disabled={inCorso || !email.trim() || !password}
            style={{...S.btnAccent,width:"100%",padding:"13px",fontSize:14,opacity:(inCorso||!email.trim()||!password)?0.5:1,cursor:(inCorso||!email.trim()||!password)?"default":"pointer"}}
          >
            {inCorso ? "Accesso in corso…" : "Accedi al sistema"}
          </button>
        </div>

        <div style={{fontSize:10.5,color:L.footerColor,textAlign:"center",marginTop:18,lineHeight:1.6,fontFamily:F_MONO}}>
          TELOS TECH HUB · ACCESSO RISERVATO
        </div>
      </div>
    </div>
  );
}
