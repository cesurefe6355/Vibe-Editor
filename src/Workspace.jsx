import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { MonacoBinding } from "y-monaco";
import { Avatar, Logo } from "./App.jsx";
import {
  ACCEPT, IMAGE_EXT, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, STARTER_FILES, TEXT_EXT,
  buildPreview, buildTree, extOf, isImageName, isSafeImage, languageOf, readFiles,
  roomPassword, safeColor, sanitizeFileName, uniqueName, validateFileName
} from "./lib.js";

// Monaco'yu CDN yerine paketten ve kendi worker'larıyla çalıştır.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  }
};
loader.config({ monaco });

const EDITOR_OPTIONS = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  fontLigatures: true,
  scrollBeyondLastLine: false,
  tabSize: 2,
  wordWrap: "on",
  padding: { top: 14 },
  renderLineHighlight: "line",
  cursorBlinking: "smooth",
  smoothScrolling: true,
  bracketPairColorization: { enabled: true }
};

const defineTheme = (m) =>
  m.editor.defineTheme("vibe", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0d1017",
      "editorGutter.background": "#0d1017",
      "editor.lineHighlightBackground": "#161b26",
      "editorLineNumber.foreground": "#4a5268",
      "editorLineNumber.activeForeground": "#aab3d1"
    }
  });

const wsBase = () => `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/sync`;
const cleanName = (n) => String(n ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 24) || "Misafir";
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

function badge(name) {
  const e = extOf(name);
  if (e === "html" || e === "htm") return { label: "<>", cls: "html" };
  if (e === "css") return { label: "#", cls: "css" };
  if (e === "js" || e === "mjs" || e === "ts") return { label: "JS", cls: "js" };
  if (e === "json") return { label: "{}", cls: "json" };
  if (e in IMAGE_EXT) return { label: "▣", cls: "img" };
  return { label: "≡", cls: "txt" };
}

/* ------------------------------- Dosya ağacı ------------------------------- */

function TreeNode({ node, prefix, depth, active, collapsed, peersByFile, onOpen, onToggle, onDelete }) {
  return (
    <>
      {[...node.folders.entries()].map(([name, child]) => {
        const key = `${prefix}${name}/`;
        const closed = collapsed.has(key);
        return (
          <div key={key}>
            <button className="tree-row folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onToggle(key)}>
              <span className={`caret ${closed ? "" : "open"}`}>›</span>
              <span className="tree-name">{name}</span>
            </button>
            {!closed && (
              <TreeNode node={child} prefix={key} depth={depth + 1} active={active} collapsed={collapsed}
                peersByFile={peersByFile} onOpen={onOpen} onToggle={onToggle} onDelete={onDelete} />
            )}
          </div>
        );
      })}
      {node.files.map((f) => {
        const b = badge(f.name);
        const here = peersByFile.get(f.path) || [];
        return (
          <div key={f.path} className={`tree-row file ${active === f.path ? "active" : ""}`} style={{ paddingLeft: 10 + depth * 14 }}>
            <button className="tree-main" onClick={() => onOpen(f.path)} title={f.path}>
              <span className={`ficon ${b.cls}`}>{b.label}</span>
              <span className="tree-name">{f.name}</span>
              <span className="dots">
                {here.slice(0, 3).map((p) => <i key={p.id} style={{ background: p.color }} title={p.name} />)}
              </span>
            </button>
            <button className="tree-del" title={`${f.path} dosyasını sil`} aria-label={`${f.path} dosyasını sil`} onClick={() => onDelete(f.path)}>×</button>
          </div>
        );
      })}
    </>
  );
}

/* --------------------------------- Çalışma alanı --------------------------------- */

export default function Workspace({ roomId, roomName, locked, user, onLeave, onProfile }) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [synced, setSynced] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [fileNames, setFileNames] = useState([]);
  const [peers, setPeers] = useState([]);
  const [openTabs, setOpenTabs] = useState(["index.html"]);
  const [activeFile, setActiveFile] = useState("index.html");
  const [editor, setEditor] = useState(null);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [previewHtml, setPreviewHtml] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewW, setPreviewW] = useState(460);
  const [resizing, setResizing] = useState(false);
  const [mobilePane, setMobilePane] = useState("editor");
  const [saveState, setSaveState] = useState("saved");
  const [toast, setToast] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const dragDepth = useRef(0);
  const toastTimer = useRef(null);

  const notify = useCallback((message, kind = "info") => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  /* ---- Yjs oturumu ---- */
  useEffect(() => {
    const ydoc = new Y.Doc();
    const password = roomPassword.get(roomId);
    const provider = new WebsocketProvider(wsBase(), roomId, ydoc, {
      params: password ? { pw: password } : {},
      maxBackoffTime: 4000
    });
    const files = ydoc.getMap("files");
    const meta = ydoc.getMap("meta");
    let saveTimer = null;

    const syncNames = () => setFileNames(Array.from(files.keys()));
    const syncPeers = () => {
      const list = [];
      provider.awareness.getStates().forEach((state, id) => {
        if (!state.user) return;
        list.push({
          id,
          name: cleanName(state.user.name),
          color: safeColor(state.user.color),
          file: typeof state.file === "string" ? state.file : null,
          me: id === provider.awareness.clientID
        });
      });
      list.sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name, "tr"));
      setPeers(list);
    };
    const onSync = (ok) => {
      if (!ok) return;
      // Sunucu içeriği yükledikten sonra, oda hâlâ boşsa başlangıç dosyalarını ekle.
      if (!meta.get("seeded")) {
        ydoc.transact(() => {
          meta.set("seeded", true);
          for (const [name, content] of Object.entries(STARTER_FILES)) files.set(name, new Y.Text(content));
        });
      }
      syncNames();
      setSynced(true);
    };
    const onUpdate = (_update, origin) => {
      if (origin === provider) return;
      setSaveState("saving");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => setSaveState("saved"), 700);
    };

    provider.on("status", ({ status: s }) => setStatus(s));
    provider.on("sync", onSync);
    files.observe(syncNames);
    provider.awareness.on("change", syncPeers);
    ydoc.on("update", onUpdate);
    const timeout = setTimeout(() => setTimedOut(true), 10000);
    setSession({ ydoc, provider, files, meta });

    return () => {
      clearTimeout(timeout);
      clearTimeout(saveTimer);
      files.unobserve(syncNames);
      provider.awareness.off("change", syncPeers);
      ydoc.off("update", onUpdate);
      provider.destroy();
      ydoc.destroy();
      try {
        monaco.editor.getModels().forEach((m) => m.uri.scheme === "inmemory" && m.uri.authority === "vibe" && m.dispose());
      } catch { /* yok say */ }
      setSession(null);
      setSynced(false);
      setPeers([]);
    };
  }, [roomId]);

  // Ad, renk ve açık dosya; diğer katılımcılara imleç etiketi olarak gider.
  useEffect(() => {
    session?.provider.awareness.setLocalStateField("user", { name: user.name, color: user.color });
  }, [session, user.name, user.color]);
  useEffect(() => {
    session?.provider.awareness.setLocalStateField("file", activeFile);
  }, [session, activeFile]);

  /* ---- Sekmeler: silinen dosyaları temizle ---- */
  useEffect(() => {
    if (!synced) return;
    const exists = new Set(fileNames);
    setOpenTabs((tabs) => {
      const kept = tabs.filter((t) => exists.has(t));
      return kept.length === tabs.length ? tabs : kept;
    });
    if (!activeFile || !exists.has(activeFile)) {
      const next = openTabs.find((t) => exists.has(t)) || (exists.has("index.html") ? "index.html" : fileNames[0] || null);
      setActiveFile(next);
      if (next) setOpenTabs((t) => (t.includes(next) ? t : [...t, next]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileNames, synced]);

  /* ---- Monaco <-> Yjs bağlantısı ---- */
  const activeEntry = synced && activeFile ? session?.files.get(activeFile) : null;
  const activeIsText = activeEntry instanceof Y.Text;
  const activeImage = activeEntry && !activeIsText && isSafeImage(activeEntry.dataUrl) ? activeEntry : null;

  useEffect(() => {
    if (!editor || !session || !activeIsText) return;
    const uri = monaco.Uri.parse(`inmemory://vibe/${roomId}/${activeFile}`);
    const model = monaco.editor.getModel(uri) || monaco.editor.createModel("", languageOf(activeFile), uri);
    editor.setModel(model);
    const binding = new MonacoBinding(activeEntry, model, new Set([editor]), session.provider.awareness);
    const sub = editor.onDidChangeCursorPosition((e) => setCursorPos({ line: e.position.lineNumber, col: e.position.column }));
    return () => {
      sub.dispose();
      binding.destroy();
      session.provider.awareness.setLocalStateField("selection", null);
    };
    // activeEntry kimliği değişince (dosya yeniden oluşturulunca) yeniden bağlanır.
  }, [editor, session, activeFile, activeEntry, activeIsText, roomId]);

  /* ---- Canlı önizleme ---- */
  const refreshPreview = useCallback(() => {
    if (session) setPreviewHtml(buildPreview(readFiles(session.files)));
  }, [session]);

  useEffect(() => {
    if (!session || !synced) return;
    refreshPreview();
    let t = null;
    const onChange = () => {
      clearTimeout(t);
      t = setTimeout(refreshPreview, 450);
    };
    session.ydoc.on("update", onChange);
    return () => {
      clearTimeout(t);
      session.ydoc.off("update", onChange);
    };
  }, [session, synced, refreshPreview]);

  /* ---- Uzak imleçler: renk + imlecin altında ad etiketi ---- */
  const cursorCss = useMemo(
    () =>
      peers
        .filter((p) => !p.me)
        .map(
          (p) => `
.yRemoteSelection-${p.id} { background: ${p.color}44; }
.yRemoteSelectionHead-${p.id} { position: absolute; height: 100%; box-sizing: border-box; border-left: 2px solid ${p.color}; z-index: 5; }
.yRemoteSelectionHead-${p.id}::after {
  content: "${p.name}"; position: absolute; top: 100%; left: -2px; z-index: 50; pointer-events: none; white-space: nowrap;
  padding: 1px 7px; border-radius: 0 5px 5px 5px; background: ${p.color}; color: #0b0e14;
  font: 600 11px/17px system-ui, sans-serif; box-shadow: 0 2px 6px #0006;
}`
        )
        .join("\n"),
    [peers]
  );

  /* ---- Dosya işlemleri ---- */
  const openFile = (name) => {
    setOpenTabs((t) => (t.includes(name) ? t : [...t, name]));
    setActiveFile(name);
    setMobilePane("editor");
  };

  const closeTab = (name) => {
    const idx = openTabs.indexOf(name);
    const rest = openTabs.filter((t) => t !== name);
    setOpenTabs(rest);
    if (activeFile === name) setActiveFile(rest[Math.max(0, idx - 1)] || null);
  };

  const addFile = (e) => {
    e.preventDefault();
    const name = newName.trim();
    const problem = validateFileName(name);
    if (problem) return notify(problem, "error");
    if (isImageName(name)) return notify("Görselleri “Yükle” düğmesiyle ekleyebilirsin.", "error");
    if (session.files.has(name)) return notify("Bu adda bir dosya zaten var.", "error");
    session.files.set(name, new Y.Text());
    setNewName("");
    setAdding(false);
    openFile(name);
  };

  const removeFile = () => {
    session.files.delete(confirmDelete);
    setConfirmDelete(null);
  };

  const upload = async (list) => {
    if (!session) return;
    const taken = new Set(session.files.keys());
    let added = 0;
    for (const file of Array.from(list)) {
      const ext = extOf(file.name);
      const isText = ext in TEXT_EXT;
      const isImage = ext in IMAGE_EXT;
      if (!isText && !isImage) {
        notify(`${file.name}: bu dosya türü desteklenmiyor.`, "error");
        continue;
      }
      if (file.size > (isText ? MAX_TEXT_BYTES : MAX_IMAGE_BYTES)) {
        notify(`${file.name}: dosya çok büyük (en fazla ${isText ? "500 KB" : "1 MB"}).`, "error");
        continue;
      }
      const name = uniqueName(sanitizeFileName(file.name) || `dosya.${ext}`, taken);
      try {
        if (isText) session.files.set(name, new Y.Text(await file.text()));
        else session.files.set(name, { kind: "image", mime: IMAGE_EXT[ext], dataUrl: await readAsDataUrl(file) });
        taken.add(name);
        added += 1;
        if (added === 1) openFile(name);
      } catch {
        notify(`${file.name} okunamadı.`, "error");
      }
    }
    if (added) notify(`${added} dosya yüklendi ve ortak projeye eklendi.`, "success");
  };

  const copyInvite = async () => {
    const link = `${window.location.origin}/r/${roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      notify(locked ? "Bağlantı kopyalandı. Parolayı ayrıca paylaşmayı unutma." : "Davet bağlantısı kopyalandı.", "success");
    } catch {
      notify(`Bağlantıyı elle kopyala: ${link}`);
    }
  };

  /* ---- Sürükle-bırak ve önizleme boyutu ---- */
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const dragProps = {
    onDragEnter: (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current += 1; setDragging(true); },
    onDragOver: (e) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: (e) => { if (!hasFiles(e)) return; dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      upload(e.dataTransfer.files);
    }
  };

  const startResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = previewW;
    setResizing(true);
    const move = (ev) => setPreviewW(clamp(startW - (ev.clientX - startX), 280, window.innerWidth - 560));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResizing(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ---- Türetilmiş değerler ---- */
  const tree = useMemo(() => buildTree(fileNames), [fileNames]);
  const peersByFile = useMemo(() => {
    const map = new Map();
    peers.forEach((p) => p.file && map.set(p.file, [...(map.get(p.file) || []), p]));
    return map;
  }, [peers]);
  const toggleFolder = (key) =>
    setCollapsed((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const online = status === "connected";
  const saveLabel = !online ? "Çevrimdışı" : saveState === "saving" ? "Kaydediliyor…" : "Kaydedildi";
  const showEditor = activeIsText;

  return (
    <div className={`ws pane-${mobilePane} ${resizing ? "resizing" : ""}`} {...dragProps}>
      <style>{cursorCss}</style>

      <header className="ws-top">
        <button className="brand-btn" onClick={onLeave} title="Ana sayfaya dön">
          <Logo size={28} />
          <strong>Vibe Editor</strong>
        </button>
        <div className="room-title">
          <strong>{roomName}</strong>
          <code>{roomId}</code>
          {locked && <span title="Parola korumalı">🔒</span>}
        </div>
        <div className="top-right">
          <span className={`save ${online ? saveState : "offline"}`}><i />{saveLabel}</span>
          <div className="avatars" title={peers.map((p) => p.name).join(", ")}>
            {peers.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} color={p.color} size={28} />)}
            {peers.length > 5 && <span className="more">+{peers.length - 5}</span>}
          </div>
          <button className="btn primary sm" onClick={copyInvite}>Davet et</button>
          <button className="me-btn" onClick={onProfile} title="Profilini düzenle"><Avatar name={user.name} color={user.color} size={28} /></button>
        </div>
      </header>

      <div className="ws-body">
        {/* --- Kenar çubuğu --- */}
        <aside className="side">
          <div className="side-head">
            <span>DOSYALAR</span>
            <div>
              <button className="icon-btn" title="Yeni dosya" aria-label="Yeni dosya" onClick={() => setAdding((v) => !v)}>＋</button>
              <button className="icon-btn" title="Dosya yükle" aria-label="Dosya yükle" onClick={() => fileInput.current?.click()}>⇪</button>
            </div>
          </div>
          <input ref={fileInput} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />

          {adding && (
            <form className="new-file" onSubmit={addFile}>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ör. js/app.js" aria-label="Yeni dosya adı" />
              <button className="btn primary sm">Ekle</button>
            </form>
          )}

          <nav className="tree" aria-label="Proje dosyaları">
            {synced ? (
              <TreeNode node={tree} prefix="" depth={0} active={activeFile} collapsed={collapsed} peersByFile={peersByFile}
                onOpen={openFile} onToggle={toggleFolder} onDelete={setConfirmDelete} />
            ) : <p className="muted pad">Yükleniyor…</p>}
          </nav>

          <button className="drop-hint" onClick={() => fileInput.current?.click()}>
            <strong>Dosya yükle</strong>
            <span>veya buraya sürükle-bırak<br />HTML, CSS, JS, JSON, görsel…</span>
          </button>

          <div className="side-head"><span>KATILIMCILAR · {peers.length}</span></div>
          <ul className="people">
            {peers.map((p) => (
              <li key={p.id}>
                <Avatar name={p.name} color={p.color} size={22} />
                <span className="pname">{p.name}{p.me && <small> (sen)</small>}</span>
                {p.file && <code title={p.file}>{p.file.split("/").pop()}</code>}
              </li>
            ))}
          </ul>
        </aside>

        {/* --- Editör --- */}
        <section className="editor-col">
          <div className="tabs" role="tablist">
            {openTabs.map((t) => {
              const b = badge(t);
              return (
                <div key={t} role="tab" aria-selected={t === activeFile} className={`tab ${t === activeFile ? "active" : ""}`}>
                  <button className="tab-main" onClick={() => setActiveFile(t)}>
                    <span className={`ficon ${b.cls}`}>{b.label}</span>{t.split("/").pop()}
                  </button>
                  <button className="tab-x" aria-label={`${t} sekmesini kapat`} onClick={() => closeTab(t)}>×</button>
                </div>
              );
            })}
          </div>

          {!online && synced && <div className="banner">Bağlantı koptu, yeniden bağlanılıyor… Yazdıkların bağlantı gelince otomatik eşitlenir.</div>}

          <div className="editor-stage">
            <div className={`editor-wrap ${showEditor ? "" : "hidden"}`}>
              <Editor height="100%" theme="vibe" defaultValue="" language="plaintext" loading={null}
                beforeMount={defineTheme} onMount={(ed) => setEditor(ed)} options={EDITOR_OPTIONS} />
            </div>

            {activeImage && (
              <div className="image-view">
                <img src={activeImage.dataUrl} alt={activeFile} />
                <p className="muted">{activeFile}</p>
              </div>
            )}
            {synced && !activeFile && (
              <div className="empty">
                <h3>Açık dosya yok</h3>
                <p className="muted">Soldan bir dosya seç, yeni dosya oluştur ya da dosya yükle.</p>
              </div>
            )}
            {!synced && (
              <div className="overlay">
                {timedOut && !online ? (
                  <>
                    <h3>Sunucuya bağlanılamadı</h3>
                    <p className="muted">Parola değişmiş ya da oda silinmiş olabilir. Yeniden deneniyor…</p>
                    <button className="btn secondary" onClick={onLeave}>Ana sayfaya dön</button>
                  </>
                ) : (
                  <><div className="spinner" /><p className="muted">Oda yükleniyor…</p></>
                )}
              </div>
            )}
          </div>

          <footer className="statusbar">
            <span>{activeFile ? languageOf(activeFile) : "—"}</span>
            {activeIsText && <span>Satır {cursorPos.line}, Sütun {cursorPos.col}</span>}
            <span className="grow" />
            <span className={online ? "ok" : "bad"}>{online ? `● Canlı · ${peers.length} kişi` : "● Bağlantı yok"}</span>
          </footer>
        </section>

        {/* --- Önizleme --- */}
        {previewOpen && <div className="resizer" onPointerDown={startResize} role="separator" aria-orientation="vertical" />}
        {previewOpen ? (
          <aside className="preview" style={{ "--pw": `${previewW}px` }}>
            <div className="preview-head">
              <strong>CANLI ÖNİZLEME</strong>
              <div>
                <button className="icon-btn" title="Yenile" aria-label="Önizlemeyi yenile" onClick={refreshPreview}>↻</button>
                <button className="icon-btn" title="Kapat" aria-label="Önizlemeyi kapat" onClick={() => setPreviewOpen(false)}>×</button>
              </div>
            </div>
            {previewHtml ? (
              <iframe title="Canlı önizleme" sandbox="allow-scripts allow-forms allow-modals" srcDoc={previewHtml} />
            ) : (
              <div className="empty"><p className="muted">Önizleme için kökte bir <code>index.html</code> dosyası gerekir.</p></div>
            )}
          </aside>
        ) : (
          <button className="show-preview" onClick={() => setPreviewOpen(true)}>Önizlemeyi aç</button>
        )}
      </div>

      <nav className="mobile-nav">
        {[["files", "Dosyalar"], ["editor", "Editör"], ["preview", "Önizleme"]].map(([key, label]) => (
          <button key={key} className={mobilePane === key ? "on" : ""} onClick={() => { setMobilePane(key); if (key === "preview") setPreviewOpen(true); }}>{label}</button>
        ))}
      </nav>

      {dragging && <div className="drop-overlay"><div><strong>Dosyaları bırak</strong><span>Ortak projeye eklenecek</span></div></div>}

      {confirmDelete && (
        <div className="modal-back" onClick={() => setConfirmDelete(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2>Dosya silinsin mi?</h2>
            <p className="muted"><code>{confirmDelete}</code> herkes için ortak projeden silinecek.</p>
            <div className="row-actions">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Vazgeç</button>
              <button className="btn danger" onClick={removeFile}>Sil</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.message}</div>}
    </div>
  );
}
