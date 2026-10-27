import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { MonacoBinding } from "y-monaco";

const STARTER_FILES = {
  "index.html": `<!doctype html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ortak projemiz</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="card">
    <span class="eyebrow">ORTAK IDE</span>
    <h1>Merhaba, ekip! 👋</h1>
    <p>Bu sayfayı birlikte geliştiriyoruz.</p>
    <button id="hello">Bana tıkla</button>
    <p id="message" aria-live="polite"></p>
  </main>
  <script src="script.js"></script>
</body>
</html>`,
  "style.css": `* { box-sizing: border-box; }

body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  color: #e8eefc;
  background: radial-gradient(circle at top, #20345d, #0b1020 65%);
  font-family: Inter, system-ui, sans-serif;
}

.card {
  width: min(100%, 560px);
  padding: 42px;
  border: 1px solid #34415e;
  border-radius: 24px;
  background: #111a2d;
  box-shadow: 0 24px 80px #0005;
}

.eyebrow { color: #63d7c6; letter-spacing: .18em; font-size: 12px; }
h1 { margin-bottom: 12px; font-size: clamp(28px, 5vw, 44px); }
p { color: #aebbd4; line-height: 1.7; }
button {
  border: 0; border-radius: 10px; padding: 12px 18px;
  color: #07121c; background: #63d7c6; font-weight: 700; cursor: pointer;
}
button:hover { filter: brightness(1.08); }`,
  "script.js": `const button = document.querySelector("#hello");
const message = document.querySelector("#message");

button?.addEventListener("click", () => {
  message.textContent = "Harika! Ortak projemiz çalışıyor. 🚀";
});`
};

const LANGUAGES = {
  "index.html": "html",
  "style.css": "css",
  "script.js": "javascript"
};

function makeRoomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/sync`;
}

export default function App() {
  const [roomId, setRoomId] = useState(() => {
    const url = new URL(window.location.href);
    const existing = url.searchParams.get("room");
    if (existing && /^[a-f0-9]{16}$/.test(existing)) return existing;
    const fresh = makeRoomId();
    url.searchParams.set("room", fresh);
    window.history.replaceState({}, "", url);
    return fresh;
  });
  const [activeFile, setActiveFile] = useState("index.html");
  const [connection, setConnection] = useState("connecting");
  const [participants, setParticipants] = useState(1);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [fileNames, setFileNames] = useState(Object.keys(STARTER_FILES));
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const ydocRef = useRef(null);
  const providerRef = useRef(null);
  const editorRef = useRef(null);
  const bindingRef = useRef(null);
  const modelsRef = useRef(new Map());
  const textsRef = useRef(new Map());
  const [docReady, setDocReady] = useState(false);
  const [docVersion, setDocVersion] = useState(0);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(getWebSocketUrl(), `room-${roomId}`, ydoc, {
      connect: true
    });
    ydocRef.current = ydoc;
    providerRef.current = provider;

    const files = ydoc.getMap("files");
    provider.on("status", ({ status }) => setConnection(status));
    provider.on("connection-error", () => setErrorMessage("Sunucuya bağlanılamadı. Sunucunun çalıştığını kontrol et."));
    provider.awareness.setLocalStateField("user", {
      name: localStorage.getItem("collab-name") || `Geliştirici ${Math.floor(Math.random() * 90 + 10)}`,
      color: "#60a5fa"
    });

    const initialize = () => {
      if (files.size === 0) {
        ydoc.transact(() => {
          for (const [name, content] of Object.entries(STARTER_FILES)) {
            if (!files.has(name)) {
              const text = new Y.Text();
              text.insert(0, content);
              files.set(name, text);
            }
          }
        });
      }
      setFileNames(Array.from(files.keys()).sort());
      setDocReady(true);
    };

    const onFilesChanged = () => {
      setFileNames(Array.from(files.keys()).sort());
      setDocVersion((v) => v + 1);
    };
    files.observe(onFilesChanged);

    const onAwareness = () => {
      const states = provider.awareness.getStates();
      setParticipants(states.size || 1);
    };
    provider.awareness.on("change", onAwareness);

    const onSync = (isSynced) => {
      if (isSynced) initialize();
    };
    provider.on("sync", onSync);

    // Offline fallback: still make the editor usable while reconnecting.
    const fallback = window.setTimeout(() => {
      if (!docReady && files.size === 0) initialize();
    }, 1800);

    return () => {
      window.clearTimeout(fallback);
      files.unobserve(onFilesChanged);
      provider.awareness.off("change", onAwareness);
      provider.off("sync", onSync);
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      setDocReady(false);
    };
    // room is fixed for this app instance; it changes only through "new room".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const getTextForFile = useCallback((name) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return null;
    const files = ydoc.getMap("files");
    let text = files.get(name);
    if (!(text instanceof Y.Text)) {
      text = new Y.Text();
      files.set(name, text);
    }
    textsRef.current.set(name, text);
    return text;
  }, []);

  const currentContent = useMemo(() => {
    const text = textsRef.current.get(activeFile);
    return text ? text.toString() : (STARTER_FILES[activeFile] || "");
  }, [activeFile, docVersion, docReady]);

  const bindEditor = useCallback((editor) => {
    editorRef.current = editor;
    if (!docReady || !ydocRef.current) return;
    if (bindingRef.current) {
      bindingRef.current.destroy();
      bindingRef.current = null;
    }
    const model = editor.getModel();
    if (!model) return;
    const ytext = getTextForFile(activeFile);
    if (!ytext) return;
    bindingRef.current = new MonacoBinding(
      ytext,
      model,
      new Set([editor]),
      providerRef.current?.awareness
    );
  }, [activeFile, docReady, getTextForFile]);

  useEffect(() => {
    if (!docReady || !editorRef.current) return;
    const editor = editorRef.current;
    const ytext = getTextForFile(activeFile);
    if (!ytext) return;

    let model = modelsRef.current.get(activeFile);
    if (!model || model.isDisposed()) {
      const uri = window.monaco?.Uri.parse(`file:///workspace/${activeFile}`);
      model = window.monaco?.editor.createModel(ytext.toString(), LANGUAGES[activeFile] || "plaintext", uri);
      if (!model) return;
      modelsRef.current.set(activeFile, model);
    }
    editor.setModel(model);
    if (bindingRef.current) bindingRef.current.destroy();
    bindingRef.current = new MonacoBinding(
      ytext,
      model,
      new Set([editor]),
      providerRef.current?.awareness
    );
    return () => {
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
    };
  }, [activeFile, docReady, getTextForFile]);

  useEffect(() => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;
    const files = ydoc.getMap("files");
    const updatePreview = () => setPreviewVersion((v) => v + 1);
    files.forEach((value) => {
      if (value instanceof Y.Text) value.observe(updatePreview);
    });
    const observeAdded = (event) => {
      event.changes.keys.forEach((_change, key) => {
        const value = files.get(key);
        if (value instanceof Y.Text) value.observe(updatePreview);
      });
    };
    files.observe(observeAdded);
    return () => {
      files.unobserve(observeAdded);
      files.forEach((value) => {
        if (value instanceof Y.Text) value.unobserve(updatePreview);
      });
    };
  }, [docReady, docVersion]);

  const buildPreview = () => {
    const files = ydocRef.current?.getMap("files");
    const read = (name, fallback) => {
      const value = files?.get(name);
      return value instanceof Y.Text ? value.toString() : fallback;
    };
    let html = read("index.html", STARTER_FILES["index.html"]);
    const css = read("style.css", "");
    const js = read("script.js", "");
    html = html.replace(/<link\b[^>]*href=["']style\.css["'][^>]*>/i, "");
    html = html.replace(/<script\b[^>]*src=["']script\.js["'][^>]*>\s*<\/script>/i, "");
    const styleTag = `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
    const scriptTag = `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`;
    if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${styleTag}</head>`);
    else html = `${styleTag}${html}`;
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${scriptTag}</body>`);
    else html += scriptTag;
    return html;
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setErrorMessage("Bağlantı kopyalanamadı. Adres çubuğundaki bağlantıyı elle kopyalayabilirsin.");
    }
  };

  const createRoom = () => {
    const fresh = makeRoomId();
    const url = new URL(window.location.href);
    url.searchParams.set("room", fresh);
    window.history.pushState({}, "", url);
    setRoomId(fresh);
    setActiveFile("index.html");
    setErrorMessage("");
  };

  const addFile = (event) => {
    event.preventDefault();
    const name = newFileName.trim();
    if (!/^[\w.-]+\.(html|css|js)$/i.test(name)) {
      setErrorMessage("Dosya adı .html, .css veya .js ile bitmeli; boşluk kullanma.");
      return;
    }
    const files = ydocRef.current?.getMap("files");
    if (!files || files.has(name)) {
      setErrorMessage("Bu dosya zaten var.");
      return;
    }
    files.set(name, new Y.Text());
    setFileNames((current) => [...new Set([...current, name])].sort());
    setActiveFile(name);
    setNewFileName("");
    setShowNewFile(false);
    setErrorMessage("");
  };

  const deleteFile = (name) => {
    if (Object.hasOwn(STARTER_FILES, name)) {
      setErrorMessage("Başlangıç dosyaları bu sürümde silinemez.");
      return;
    }
    if (!window.confirm(`${name} dosyası ortak projeden silinsin mi?`)) return;
    ydocRef.current?.getMap("files").delete(name);
    modelsRef.current.get(name)?.dispose();
    modelsRef.current.delete(name);
    if (activeFile === name) setActiveFile("index.html");
  };

  const activeLanguage = LANGUAGES[activeFile] || (activeFile.endsWith(".html") ? "html" : activeFile.endsWith(".css") ? "css" : activeFile.endsWith(".js") ? "javascript" : "plaintext");

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span>&lt;/&gt;</span></div>
          <div><strong>Ortak<span>IDE</span></strong><small>Gerçek zamanlı geliştirme</small></div>
        </div>
        <div className="room-meta">
          <span className={`status-dot ${connection === "connected" ? "online" : ""}`} />
          <span>{connection === "connected" ? "Bağlı" : connection === "connecting" ? "Bağlanıyor…" : "Bağlantı yok"}</span>
          <span className="meta-divider" />
          <span className="people-icon">♧</span>
          <span>{participants} kişi</span>
        </div>
        <div className="top-actions">
          <button className="button secondary" onClick={createRoom} title="Yeni ve boş bir oda oluştur">Yeni oda</button>
          <button className="button primary" onClick={copyInvite}>{copied ? "Kopyalandı ✓" : "↗ Davet bağlantısı"}</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="side-heading"><span>GEZGİN</span><button className="icon-button" title="Yeni dosya" onClick={() => setShowNewFile((v) => !v)}>＋</button></div>
          <div className="project-label"><span className="folder-glyph">▾</span><span>ORTAK-PROJE</span></div>
          {showNewFile && (
            <form className="new-file-form" onSubmit={addFile}>
              <input autoFocus value={newFileName} onChange={(e) => setNewFileName(e.target.value)} placeholder="ör. app.js" aria-label="Yeni dosya adı" />
              <button type="submit">Ekle</button>
            </form>
          )}
          <nav className="file-list" aria-label="Proje dosyaları">
            {fileNames.map((name) => (
              <div key={name} className={`file-row ${activeFile === name ? "selected" : ""}`}>
                <button className="file-select" onClick={() => setActiveFile(name)}>
                  <span className={`file-icon ${name.endsWith(".html") ? "html" : name.endsWith(".css") ? "css" : "js"}`}>{name.endsWith(".html") ? "5" : name.endsWith(".css") ? "#" : "JS"}</span>
                  <span>{name}</span>
                </button>
                {!Object.hasOwn(STARTER_FILES, name) && <button className="delete-file" onClick={() => deleteFile(name)} title={`${name} dosyasını sil`}>×</button>}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="avatar-stack"><span className="avatar blue">S</span><span className="avatar purple">+</span></div>
            <div><strong>Ortak çalışma</strong><small>{participants} katılımcı çevrimiçi</small></div>
          </div>
        </aside>

        <main className="editor-area">
          <div className="tabbar">
            <div className="active-tab"><span className={`file-icon ${activeFile.endsWith(".html") ? "html" : activeFile.endsWith(".css") ? "css" : "js"}`}>{activeFile.endsWith(".html") ? "5" : activeFile.endsWith(".css") ? "#" : "JS"}</span>{activeFile}<span className="tab-close">×</span></div>
            <div className="editor-status">UTF-8 <span>•</span> {activeLanguage.toUpperCase()}</div>
          </div>
          <div className="editor-container">
            <Editor
              height="100%"
              theme="vs-dark"
              language={activeLanguage}
              value={currentContent}
              onMount={(editor, monaco) => {
                window.monaco = monaco;
                editorRef.current = editor;
                bindEditor(editor);
              }}
              onChange={() => {}}
              options={{
                automaticLayout: true,
                minimap: { enabled: true },
                fontSize: 14,
                fontFamily: "'Cascadia Code', 'Consolas', monospace",
                fontLigatures: true,
                lineNumbers: "on",
                roundedSelection: false,
                scrollBeyondLastLine: false,
                tabSize: 2,
                wordWrap: "on",
                padding: { top: 18 },
                renderLineHighlight: "all",
                cursorBlinking: "smooth",
                smoothScrolling: true
              }}
            />
          </div>
          <footer className="statusbar"><span>⌘ Ortak oturum</span><span>Oda: {roomId.slice(0, 8)}</span><span>{connection === "connected" ? "Değişiklikler canlı eşitleniyor" : "Sunucu bağlantısı bekleniyor"}</span></footer>
        </main>

        {previewOpen && (
          <aside className="preview-area">
            <div className="preview-header">
              <div><span className="preview-dot" /><strong>CANLI ÖNİZLEME</strong></div>
              <div className="preview-actions"><button className="icon-button" title="Önizlemeyi yenile" onClick={() => setPreviewVersion((v) => v + 1)}>↻</button><button className="icon-button" title="Önizlemeyi kapat" onClick={() => setPreviewOpen(false)}>×</button></div>
            </div>
            <div className="browser-bar"><span>←</span><span>→</span><span>↻</span><div>⌕ &nbsp; ortak-proje.local</div></div>
            <iframe
              key={previewVersion}
              title="Proje canlı önizlemesi"
              sandbox="allow-scripts"
              srcDoc={buildPreview()}
              className="preview-frame"
            />
          </aside>
        )}
        {!previewOpen && <button className="show-preview" onClick={() => setPreviewOpen(true)}>Önizlemeyi aç</button>}
      </div>
      {errorMessage && <div className="toast" role="status"><span>{errorMessage}</span><button onClick={() => setErrorMessage("")}>×</button></div>}
      <div className="disclaimer">MVP · Bağlantıya sahip kişiler odaya katılabilir. Hassas veya gizli kodları henüz paylaşmayın.</div>
    </div>
  );
}
