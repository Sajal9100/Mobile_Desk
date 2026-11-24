// spike/signaling-server/server.mjs
// THROWAWAY SPIKE CODE. No auth, no validation beyond JSON parse. Never deploy.
// Binds to 127.0.0.1 only; reach it from phones through a temporary TLS tunnel.
// Deviations from the brief (both because this server sits behind a public tunnel):
//  1. maxPayload is capped (SDP is ~10 KB); ws defaults to 100 MiB.
//  2. Every socket has an 'error' handler. The brief's version has none, so a single
//     malformed or oversize frame emits an unhandled 'error' and kills the whole process.
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8080);
const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1', maxPayload: 64 * 1024 });
const rooms = new Map(); // room -> Set<WebSocket>

const broadcast = (peers, data, except) => {
  for (const p of peers) if (p !== except && p.readyState === 1) p.send(data);
};

wss.on('connection', (ws) => {
  let room = null;
  console.log(`connection opened (total ${wss.clients.size})`); // never log room names or payloads
  ws.on('error', () => {}); // 'close' follows and cleans up; without this a bad frame crashes the server

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join' && typeof msg.room === 'string' && !room) {
      const peers = rooms.get(msg.room) ?? new Set();
      if (peers.size >= 2) { ws.send(JSON.stringify({ type: 'full' })); ws.close(); return; }
      room = msg.room;
      peers.add(ws);
      rooms.set(room, peers);
      broadcast(peers, JSON.stringify({ type: 'peers', count: peers.size }));
      return;
    }
    if (room) broadcast(rooms.get(room) ?? new Set(), raw.toString(), ws);
  });

  ws.on('close', () => {
    console.log(`connection closed (total ${wss.clients.size})`);
    const peers = room ? rooms.get(room) : undefined;
    if (!peers) return;
    peers.delete(ws);
    broadcast(peers, JSON.stringify({ type: 'peer-left' }));
    if (peers.size === 0) rooms.delete(room);
  });
});

console.log(`spike signaling listening on ws://127.0.0.1:${PORT}`);
