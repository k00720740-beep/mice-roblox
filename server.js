const express = require('express'), http = require('http'), crypto = require('crypto'), path = require('path');
const { WebSocketServer } = require('ws');

const SECRET = process.env.GAME_SECRET || 'CHANGE_ME';
const RANGE = Number(process.env.RANGE || 60); // studs

const app = express(); 
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app), wss = new WebSocketServer({ server });
const tokens = new Map(), users = new Map();
const auth = (req, res, next) => req.body.secret === SECRET ? next() : res.sendStatus(403);

app.post('/token', auth, (req, res) => {
  const { userId, name } = req.body, t = crypto.randomBytes(16).toString('hex');
  tokens.set(t, { userId: String(userId), name, exp: Date.now() + 3600e3 });
  const base = process.env.PUBLIC_URL || 'https://' + req.headers.host;
  console.log(`[TOKEN] تم إنشاء رابط للاعب: ${name} (${userId})`);
  res.json({ url: `${base}/?t=${t}` });
});

app.post('/sync', auth, (req, res) => {
  const list = req.body.players || [], out = {};
  for (const p of list) {
    const id = String(p.id), u = users.get(id);
    if (!u) { out[id] = { linked: false, on: false, level: 0 }; continue; }
    u.pos = p; u.on = u.ready && !!p.on;
    out[id] = { linked: u.ready, on: u.on, level: u.on ? u.level : 0 };
  }
  for (const p of list) {
    const a = users.get(String(p.id)); if (!a || a.ws.readyState !== 1) continue;
    const near = [];
    if (a.ready) for (const q of list) {
      const b = users.get(String(q.id));
      if (!b || b === a || !b.ready) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      if (d < RANGE) near.push({ id: String(q.id), g: d < 10 ? 1 : (RANGE - d) / (RANGE - 10) });
    }
    a.ws.send(JSON.stringify({ type: 'state', on: a.on, near }));
  }
  res.json({ users: out });
});

wss.on('connection', ws => {
  let id = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'hello') {
      const t = tokens.get(m.t);
      if (!t || t.exp < Date.now()) return ws.send(JSON.stringify({ type: 'bad' }));
      id = t.userId;
      users.set(id, { ws, name: t.name, ready: !!m.ready, on: false, level: 0, pos: null });
      console.log(`[WS] متصل جديد: ${t.name} (${id})`);
      return ws.send(JSON.stringify({ type: 'hello', id, name: t.name }));
    }
    const u = id && users.get(id); if (!u || u.ws !== ws) return;
    if (m.type === 'ready') {
      u.ready = true;
      console.log(`[WS] اللاعب ${u.name} جاهز ومربوط بالمايك`);
    }
    else if (m.type === 'level') u.level = Math.max(0, Math.min(1, +m.v || 0));
    else if (m.type === 'signal') {
      const to = users.get(String(m.to));
      if (to && to.ws.readyState === 1) {
        console.log(`[SIGNAL] نقل إشارة صوتية من ${id} إلى ${m.to}`);
        to.ws.send(JSON.stringify({ type: 'signal', from: id, data: m.data }));
      }
    }
  });
  ws.on('close', () => { 
    if (id && users.get(id)?.ws === ws) {
      console.log(`[WS] انقطع اتصال اللاعب: ${id}`);
      users.delete(id); 
    }
  });
});

server.listen(process.env.PORT || 3000);
