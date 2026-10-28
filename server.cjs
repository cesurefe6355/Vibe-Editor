const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Y = require("yjs");
const { WebSocketServer } = require("ws");
const { setupWSConnection, setPersistence, getYDoc, docs } = require("y-websocket/bin/utils");

const PORT = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === "production";
// Render'da kalıcı disk bağlarsan DATA_DIR'i disk yoluna (ör. /var/data) ayarla.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const ROOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const ROOM_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/;
const MAX_CONN_PER_IP = 30;

/* ------------------------------ Oda verisi ------------------------------ */

const META_FILE = path.join(DATA_DIR, "rooms.json");
let rooms = {};
try {
  rooms = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
} catch {
  rooms = {};
}

let metaTimer = null;
function saveMeta(immediate = false) {
  const write = () => {
    const tmp = `${META_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rooms));
    fs.renameSync(tmp, META_FILE);
  };
  clearTimeout(metaTimer);
  if (immediate) return write();
  metaTimer = setTimeout(write, 300);
}

function newRoomId() {
  for (;;) {
    const bytes = crypto.randomBytes(8);
    const raw = Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join("");
    const id = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    if (!rooms[id]) return id;
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString("hex");
}

function checkPassword(room, password) {
  if (!room.hash) return true;
  if (typeof password !== "string" || password.length > 64) return false;
  const a = Buffer.from(hashPassword(password, room.salt), "hex");
  const b = Buffer.from(room.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* --------------------------- Kalıcı doküman kaydı --------------------------- */

const docFile = (id) => path.join(DATA_DIR, `${id}.ystate`);
const pendingWrites = new Map();
const loading = new Map();

async function persistDoc(id, doc) {
  const file = docFile(id);
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, Buffer.from(Y.encodeStateAsUpdate(doc)));
  await fs.promises.rename(tmp, file);
}

setPersistence({
  provider: null,
  bindState: (id, doc) => {
    let timer = null;
    doc.on("update", () => {
      clearTimeout(timer);
      timer = setTimeout(() => persistDoc(id, doc).catch((e) => console.error("Kayıt hatası:", e.message)), 2000);
    });
  },
  writeState: (id, doc) => {
    const p = persistDoc(id, doc).catch((e) => console.error("Kayıt hatası:", e.message));
    pendingWrites.set(id, p);
    p.finally(() => pendingWrites.delete(id));
    return p;
  }
});

// Doküman diskten yüklenmeden istemciyle senkronizasyon başlamaz;
// böylece istemci boş bir oda görüp başlangıç dosyalarını üzerine yazamaz.
async function ensureLoaded(id) {
  if (docs.has(id) && loading.has(id)) return loading.get(id);
  await pendingWrites.get(id);
  const doc = getYDoc(id, true);
  const task = (async () => {
    try {
      Y.applyUpdate(doc, await fs.promises.readFile(docFile(id)));
    } catch {
      /* yeni oda */
    }
  })();
  loading.set(id, task);
  return task;
}

/* --------------------------------- HTTP --------------------------------- */

const app = express();
const server = http.createServer(app);
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY"
  });
  next();
});
app.use(express.json({ limit: "2kb" }));

function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: "Çok fazla istek. Biraz bekleyip tekrar dene." });
    next();
  };
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/rooms", limiter(20, 60 * 60 * 1000), (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 40) || "Adsız proje";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (password && (password.length < 4 || password.length > 64)) {
    return res.status(400).json({ error: "Parola 4–64 karakter olmalı." });
  }
  const id = newRoomId();
  const room = { name, createdAt: Date.now() };
  if (password) {
    room.salt = crypto.randomBytes(16).toString("hex");
    room.hash = hashPassword(password, room.salt);
  }
  rooms[id] = room;
  saveMeta();
  res.status(201).json({ id });
});

app.get("/api/rooms/:id", limiter(120, 60 * 1000), (req, res) => {
  const room = ROOM_RE.test(req.params.id) ? rooms[req.params.id] : null;
  if (!room) return res.status(404).json({ error: "Oda bulunamadı." });
  res.json({ id: req.params.id, name: room.name, locked: Boolean(room.hash) });
});

app.post("/api/rooms/:id/verify", limiter(10, 60 * 1000), (req, res) => {
  const room = ROOM_RE.test(req.params.id) ? rooms[req.params.id] : null;
  if (!room) return res.status(404).json({ error: "Oda bulunamadı." });
  if (!checkPassword(room, req.body?.password)) return res.status(401).json({ error: "Parola hatalı." });
  res.json({ ok: true });
});

/* ------------------------------- WebSocket ------------------------------- */

const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
const connsByIp = new Map();

function reject(socket, code, text) {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, "http://localhost");
  const match = url.pathname.match(/^\/sync\/([a-z0-9]{4}-[a-z0-9]{4})$/);
  if (!match) return reject(socket, 404, "Not Found");

  if (isProduction && request.headers.origin) {
    try {
      if (new URL(request.headers.origin).host !== request.headers.host) return reject(socket, 403, "Forbidden");
    } catch {
      return reject(socket, 403, "Forbidden");
    }
  }

  const roomId = match[1];
  const room = rooms[roomId];
  if (!room) return reject(socket, 404, "Not Found");
  if (!checkPassword(room, url.searchParams.get("pw") || "")) return reject(socket, 401, "Unauthorized");

  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",").pop().trim();
  const ip = forwarded || request.socket.remoteAddress || "?";
  if ((connsByIp.get(ip) || 0) >= MAX_CONN_PER_IP) return reject(socket, 429, "Too Many Requests");

  // Doküman diskten yüklenmeden el sıkışma tamamlanmaz; istemcinin ilk mesajı kaybolmaz.
  ensureLoaded(roomId)
    .then(() => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        connsByIp.set(ip, (connsByIp.get(ip) || 0) + 1);
        ws.on("close", () => {
          const left = (connsByIp.get(ip) || 1) - 1;
          if (left <= 0) connsByIp.delete(ip);
          else connsByIp.set(ip, left);
        });
        setupWSConnection(ws, request, { docName: roomId, gc: true });
      });
    })
    .catch((error) => {
      console.error("Bağlantı hatası:", error.message);
      reject(socket, 500, "Internal Server Error");
    });
});

/* ------------------------------ Statik dosyalar ------------------------------ */

if (isProduction) {
  const dist = path.join(__dirname, "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Vibe Editor: http://localhost:${PORT}  (veri: ${DATA_DIR})`);
});

/* ------------------------------ Güvenli kapanış ------------------------------ */

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    saveMeta(true);
    await Promise.all([...docs.entries()].map(([id, doc]) => persistDoc(id, doc)));
  } catch (error) {
    console.error("Kapanışta kayıt hatası:", error.message);
  }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
