const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const { setupWSConnection } = require("y-websocket/bin/utils");

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === "production";
const root = __dirname;

app.disable("x-powered-by");
app.get("/health", (_req, res) => res.json({ ok: true, service: "ortak-kod-editoru" }));

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname !== "/sync" && !pathname.startsWith("/sync/")) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws, request) => {
  // Room IDs are generated randomly in the browser. Anyone with the room link
  // can join; do not use this MVP for private or sensitive source code.
  setupWSConnection(ws, request, { gc: true });
});

if (isProduction) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Ortak IDE sunucusu: http://localhost:${PORT}`);
  console.log(`WebSocket eşzamanlama: ws://localhost:${PORT}/sync`);
});
