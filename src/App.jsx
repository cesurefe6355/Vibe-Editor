import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  COLORS, api, forgetRoom, initials, loadRecent, loadUser, parseRoomInput,
  randomColor, rememberRoom, roomPassword, saveUser
} from "./lib.js";

const Workspace = lazy(() => import("./Workspace.jsx"));

/* ------------------------------ Küçük parçalar ------------------------------ */

export function Logo({ size = 32 }) {
  return (
    <span className="logo" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size * 0.62} height={size * 0.62} fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 11l-5 5 5 5M20 11l5 5-5 5" />
      </svg>
    </span>
  );
}

export function Avatar({ name, color, size = 28 }) {
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.4 }} title={name}>
      {initials(name)}
    </span>
  );
}

function Loading({ text }) {
  return (
    <div className="center-screen">
      <div className="spinner" />
      <p className="muted">{text}</p>
    </div>
  );
}

/* --------------------------------- Ad ekranı --------------------------------- */

function Welcome({ initial, onDone, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [color, setColor] = useState(initial?.color || randomColor());
  const shown = name.trim() || "Adın";

  const submit = (e) => {
    e.preventDefault();
    if (name.trim()) onDone({ name: name.trim().slice(0, 24), color });
  };

  return (
    <div className="center-screen">
      <form className="card welcome" onSubmit={submit}>
        <div className="brand-row"><Logo size={40} /><strong>Vibe Editor</strong></div>
        <h1>{initial ? "Profilini düzenle" : "Hoş geldin 👋"}</h1>
        <p className="muted">
          {initial ? "Adın ve rengin, editörde imlecinin altında görünür." : "Başlamadan önce adını yaz. Takım arkadaşların seni imlecinin altındaki bu adla tanıyacak."}
        </p>

        <label className="field">
          <span>Adın</span>
          <input autoFocus value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="ör. Ayşe" />
        </label>

        <div className="field">
          <span>İmleç rengin</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`swatch ${c === color ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Renk ${c}`} />
            ))}
          </div>
        </div>

        <div className="cursor-demo" aria-hidden="true">
          <code>const <b>merhaba</b> = "dünya";</code>
          <span className="demo-caret" style={{ borderColor: color }}>
            <em style={{ background: color }}>{shown}</em>
          </span>
        </div>

        <div className="row-actions">
          {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Vazgeç</button>}
          <button className="btn primary grow" disabled={!name.trim()}>{initial ? "Kaydet" : "Devam et →"}</button>
        </div>
      </form>
    </div>
  );
}

/* --------------------------------- Ana sayfa --------------------------------- */

function Home({ user, navigate, onProfile }) {
  const [projectName, setProjectName] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [recent, setRecent] = useState(loadRecent);

  const create = async (e) => {
    e.preventDefault();
    setError("");
    if (usePassword && password.length < 4) return setError("Parola en az 4 karakter olmalı.");
    setBusy(true);
    try {
      const { id } = await api.createRoom(projectName.trim(), usePassword ? password : "");
      roomPassword.set(id, usePassword ? password : "");
      navigate(`/r/${id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const join = (e) => {
    e.preventDefault();
    const id = parseRoomInput(joinInput);
    if (!id) return setJoinError("Geçerli bir oda kodu veya davet bağlantısı gir. Örnek: k7x2-m9qa");
    navigate(`/r/${id}`);
  };

  return (
    <div className="home">
      <header className="home-top">
        <div className="brand-row"><Logo /><strong>Vibe Editor</strong></div>
        <button className="user-chip" onClick={onProfile} title="Profilini düzenle">
          <Avatar name={user.name} color={user.color} size={26} />
          <span>{user.name}</span>
        </button>
      </header>

      <main className="home-main">
        <section className="hero">
          <h1>Birlikte kod yazın,<br /><span className="grad">aynı anda.</span></h1>
          <p className="muted">Bir oda oluştur, bağlantıyı paylaş; herkes aynı dosyaları canlı düzenlesin ve sonucu anında görsün.</p>
        </section>

        <section className="home-grid">
          <form className="card" onSubmit={create}>
            <h2>Yeni oda oluştur</h2>
            <label className="field">
              <span>Proje adı <small>(isteğe bağlı)</small></span>
              <input value={projectName} maxLength={40} onChange={(e) => setProjectName(e.target.value)} placeholder="ör. Portföy sitesi" />
            </label>
            <label className="check">
              <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
              <span>Parola ile koru</span>
            </label>
            {usePassword && (
              <label className="field">
                <span>Oda parolası</span>
                <input type="password" value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} placeholder="En az 4 karakter" autoComplete="new-password" />
              </label>
            )}
            {error && <p className="error">{error}</p>}
            <button className="btn primary" disabled={busy}>{busy ? "Oluşturuluyor…" : "Oda oluştur"}</button>
          </form>

          <form className="card" onSubmit={join}>
            <h2>Odaya katıl</h2>
            <label className="field">
              <span>Oda kodu veya davet bağlantısı</span>
              <input value={joinInput} onChange={(e) => { setJoinInput(e.target.value); setJoinError(""); }} placeholder="k7x2-m9qa" spellCheck="false" />
            </label>
            {joinError && <p className="error">{joinError}</p>}
            <button className="btn secondary">Katıl</button>
            <p className="hint">Parolalı odalarda parola, odaya girerken istenir.</p>
          </form>
        </section>

        {recent.length > 0 && (
          <section className="recent">
            <h3>Son odaların</h3>
            <ul>
              {recent.map((r) => (
                <li key={r.id}>
                  <button className="recent-open" onClick={() => navigate(`/r/${r.id}`)}>
                    <strong>{r.name}</strong>
                    <code>{r.id}</code>
                  </button>
                  <button className="icon-btn" title="Listeden kaldır" aria-label="Listeden kaldır" onClick={() => { forgetRoom(r.id); setRecent(loadRecent()); }}>×</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

/* --------------------------------- Oda geçidi --------------------------------- */

function RoomGate({ id, user, navigate, onProfile }) {
  const [phase, setPhase] = useState("loading");
  const [room, setRoom] = useState(null);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    (async () => {
      try {
        const info = await api.getRoom(id);
        if (cancelled) return;
        setRoom(info);
        if (!info.locked) return setPhase("ready");
        const saved = roomPassword.get(id);
        if (saved) {
          try {
            await api.verify(id, saved);
            if (!cancelled) setPhase("ready");
            return;
          } catch {
            roomPassword.set(id, "");
          }
        }
        if (!cancelled) setPhase("locked");
      } catch (err) {
        if (cancelled) return;
        if (err.status === 404) forgetRoom(id);
        setPhase(err.status === 404 ? "notfound" : "error");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (phase === "ready" && room) rememberRoom(id, room.name);
    document.title = phase === "ready" && room ? `${room.name} · Vibe Editor` : "Vibe Editor";
    return () => { document.title = "Vibe Editor"; };
  }, [phase, room, id]);

  const unlock = async (e) => {
    e.preventDefault();
    setBusy(true);
    setPwError("");
    try {
      await api.verify(id, pw);
      roomPassword.set(id, pw);
      setPhase("ready");
    } catch (err) {
      setPwError(err.message);
    }
    setBusy(false);
  };

  if (phase === "loading") return <Loading text="Oda kontrol ediliyor…" />;

  if (phase === "ready") {
    return (
      <Suspense fallback={<Loading text="Editör yükleniyor…" />}>
        <Workspace roomId={id} roomName={room.name} locked={room.locked} user={user} onLeave={() => navigate("/")} onProfile={onProfile} />
      </Suspense>
    );
  }

  return (
    <div className="center-screen">
      <div className="card welcome">
        <div className="brand-row"><Logo size={40} /><strong>Vibe Editor</strong></div>
        {phase === "locked" ? (
          <form onSubmit={unlock}>
            <h1>🔒 Bu oda parolalı</h1>
            <p className="muted"><strong>{room.name}</strong> odasına girmek için parolayı yaz.</p>
            <label className="field">
              <span>Parola</span>
              <input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            </label>
            {pwError && <p className="error">{pwError}</p>}
            <div className="row-actions">
              <button type="button" className="btn ghost" onClick={() => navigate("/")}>Ana sayfa</button>
              <button className="btn primary grow" disabled={busy || !pw}>{busy ? "Kontrol ediliyor…" : "Odaya gir"}</button>
            </div>
          </form>
        ) : (
          <>
            <h1>{phase === "notfound" ? "Oda bulunamadı" : "Bir sorun oluştu"}</h1>
            <p className="muted">
              {phase === "notfound" ? `“${id}” kodlu bir oda yok. Bağlantıyı kontrol et veya yeni bir oda oluştur.` : "Sunucuya ulaşılamadı. Biraz sonra tekrar dene."}
            </p>
            <button className="btn primary" onClick={() => navigate("/")}>Ana sayfaya dön</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Kök ---------------------------------- */

export default function App() {
  const [user, setUser] = useState(loadUser);
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to) => {
    window.history.pushState({}, "", to);
    setPath(to);
  }, []);

  const save = (u) => {
    saveUser(u);
    setUser(u);
    setEditing(false);
  };

  // Ad girilmeden hiçbir ekran açılmaz; oda bağlantısıyla gelenler adı girince doğrudan odaya geçer.
  if (!user) return <Welcome onDone={save} />;
  if (editing) return <Welcome initial={user} onDone={save} onCancel={() => setEditing(false)} />;

  const match = path.match(/^\/r\/([a-z0-9]{4}-[a-z0-9]{4})\/?$/i);
  if (match) {
    return <RoomGate key={match[1].toLowerCase()} id={match[1].toLowerCase()} user={user} navigate={navigate} onProfile={() => setEditing(true)} />;
  }
  return <Home user={user} navigate={navigate} onProfile={() => setEditing(true)} />;
}
