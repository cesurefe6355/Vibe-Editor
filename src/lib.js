import * as Y from "yjs";

/* ------------------------------- Kullanıcı ------------------------------- */

export const COLORS = ["#7c6cff", "#f472b6", "#34d399", "#fbbf24", "#38bdf8", "#fb7185", "#a3e635", "#f97316"];
const USER_KEY = "vibe:user";
const RECENT_KEY = "vibe:recent";

export function loadUser() {
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY));
    if (u && typeof u.name === "string" && u.name.trim()) return { name: u.name.trim().slice(0, 24), color: safeColor(u.color) };
  } catch { /* yok say */ }
  return null;
}
export const saveUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u));
export const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : COLORS[0]);
export const initials = (name) => (name || "?").trim().slice(0, 2).toLocaleUpperCase("tr");
export const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

export function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list.filter((r) => r && ROOM_RE.test(r.id)).slice(0, 6) : [];
  } catch {
    return [];
  }
}
export function rememberRoom(id, name) {
  const next = [{ id, name, at: Date.now() }, ...loadRecent().filter((r) => r.id !== id)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}
export function forgetRoom(id) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecent().filter((r) => r.id !== id)));
}

/* --------------------------------- Oda --------------------------------- */

export const ROOM_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/;

// Kod ya da tam davet bağlantısı kabul eder.
export function parseRoomInput(input) {
  const m = String(input).trim().toLowerCase().match(/(?:^|\/r\/)([a-z0-9]{4}-[a-z0-9]{4})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "İstek başarısız."), { status: res.status });
  return data;
}
export const api = {
  createRoom: (name, password) => request("POST", "/api/rooms", { name, password }),
  getRoom: (id) => request("GET", `/api/rooms/${id}`),
  verify: (id, password) => request("POST", `/api/rooms/${id}/verify`, { password })
};

export const roomPassword = {
  get: (id) => sessionStorage.getItem(`vibe:pw:${id}`) || "",
  set: (id, pw) => (pw ? sessionStorage.setItem(`vibe:pw:${id}`, pw) : sessionStorage.removeItem(`vibe:pw:${id}`))
};

/* ------------------------------- Dosyalar ------------------------------- */

export const TEXT_EXT = {
  html: "html", htm: "html", css: "css", js: "javascript", mjs: "javascript", json: "json",
  md: "markdown", txt: "plaintext", svg: "xml", xml: "xml", csv: "plaintext", ts: "typescript"
};
export const IMAGE_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", ico: "image/x-icon", avif: "image/avif"
};
export const ACCEPT = [...Object.keys(TEXT_EXT), ...Object.keys(IMAGE_EXT)].map((e) => `.${e}`).join(",");
export const MAX_TEXT_BYTES = 500 * 1024;
export const MAX_IMAGE_BYTES = 1024 * 1024;

export const extOf = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");
export const languageOf = (name) => TEXT_EXT[extOf(name)] || "plaintext";
export const isImageName = (name) => extOf(name) in IMAGE_EXT;
export const isSafeImage = (url) => /^data:image\/(png|jpeg|gif|webp|x-icon|avif);base64,[A-Za-z0-9+/=]+$/.test(url);

const NAME_RE = /^(?!.*\.\.)[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){0,3}$/;
export function validateFileName(name) {
  if (!name) return "Dosya adı boş olamaz.";
  if (name.length > 60 || !NAME_RE.test(name)) return "Yalnızca harf, rakam, - _ . ve klasör için / kullanabilirsin.";
  const ext = extOf(name);
  if (!(ext in TEXT_EXT) && !(ext in IMAGE_EXT)) return "Desteklenen uzantılar: " + Object.keys(TEXT_EXT).join(", ") + " ve görseller.";
  return "";
}

export function validateFolderName(name) {
  if (!name) return "Klasör adı boş olamaz.";
  if (name.length > 60 || !NAME_RE.test(name) || name.split("/").some((part) => part === ".")) {
    return "Klasör adında harf, rakam, - _ . ve alt klasör için / kullanabilirsin (en fazla 4 seviye, 60 karakter).";
  }
  return "";
}

export function pathConflict(name, kind, files, folders) {
  const parents = name.split("/").slice(0, -1);
  if (parents.some((_part, i) => files.has(parents.slice(0, i + 1).join("/")))) {
    return "Bu yolun üst klasörlerinden biriyle aynı adda bir dosya var.";
  }
  if (files.has(name)) return "Bu adda bir dosya zaten var.";
  const isFolder = folders.has(name) || [...files.keys(), ...folders.keys()].some((path) => path.startsWith(`${name}/`));
  if (isFolder) return kind === "folder" ? "Bu adda bir klasör zaten var." : "Bu adda bir klasör var.";
  return "";
}

const TR = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" };
export function sanitizeFileName(name) {
  return name
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => TR[c])
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(-60);
}
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const end = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}${end}`)) return `${base}-${i}${end}`;
}

// Düz dosya listesinden klasör ağacı üretir.
export function buildTree(names, folders = []) {
  const root = { folders: new Map(), files: [] };
  const paths = [...names, ...folders.map((name) => `${name}/`)];
  for (const full of paths.sort((a, b) => a.localeCompare(b, "tr"))) {
    const parts = full.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    if (parts.at(-1)) node.files.push({ name: parts.at(-1), path: full });
  }
  return root;
}

// Yjs dokümanındaki dosyaları düz nesneye çevirir.
export function readFiles(filesMap) {
  const out = new Map();
  filesMap.forEach((value, name) => {
    if (value instanceof Y.Text) out.set(name, { kind: "text", text: value.toString() });
    else if (value && value.kind === "image" && isSafeImage(value.dataUrl)) out.set(name, { kind: "image", dataUrl: value.dataUrl });
  });
  return out;
}

export const STARTER_FILES = {
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
    <span class="eyebrow">VIBE EDITOR</span>
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
  background: radial-gradient(circle at top, #2a2f5c, #0b0e14 65%);
  font-family: system-ui, sans-serif;
}

.card {
  width: min(100%, 520px);
  padding: 40px;
  border: 1px solid #343b66;
  border-radius: 20px;
  background: #121629;
}

.eyebrow { color: #9d93ff; letter-spacing: .18em; font-size: 12px; }
h1 { margin: 10px 0; font-size: clamp(28px, 5vw, 40px); }
p { color: #aab3d1; line-height: 1.7; }

button {
  border: 0; border-radius: 10px; padding: 12px 18px;
  color: #fff; background: #7c6cff; font-weight: 700; cursor: pointer;
}
button:hover { filter: brightness(1.1); }`,
  "script.js": `const button = document.querySelector("#hello");
const message = document.querySelector("#message");

button?.addEventListener("click", () => {
  message.textContent = "Harika! Ortak projemiz çalışıyor. 🚀";
});`
};

/* ------------------------------- Önizleme ------------------------------- */

// Dosya haritasından tek parça, yalıtılmış bir HTML belgesi üretir.
export function buildPreview(files) {
  const index = files.get("index.html");
  if (!index || index.kind !== "text") return null;

  const lookup = (ref) => {
    if (!ref || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
    const clean = ref.split(/[?#]/)[0].replace(/^(\.\/|\/|\.\.\/)+/, "");
    if (files.has(clean)) return files.get(clean);
    for (const [name, file] of files) if (name.endsWith(`/${clean}`)) return file;
    return null;
  };

  const inlineCssUrls = (css) =>
    css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (all, _q, ref) => {
      const f = lookup(ref.trim());
      return f?.kind === "image" ? `url("${f.dataUrl}")` : all;
    });

  let html = index.text;
  html = html.replace(/(\b(?:src|href|poster)=["'])([^"']+)(["'])/gi, (all, a, ref, b) => {
    const f = lookup(ref);
    return f?.kind === "image" ? a + f.dataUrl + b : all;
  });
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel=["']?stylesheet/i.test(tag)) return tag;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    const f = lookup(href);
    return f?.kind === "text" ? `<style>${inlineCssUrls(f.text).replace(/<\/style/gi, "<\\/style")}</style>` : tag;
  });
  html = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (all, a, src, b) => {
    const f = lookup(src);
    return f?.kind === "text" ? `<script${a}${b}>${f.text.replace(/<\/script/gi, "<\\/script")}</script>` : all;
  });
  return html;
}
