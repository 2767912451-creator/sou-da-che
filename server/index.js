// ============================================================
// 搜打撤 - 服务端入口
// Express 静态页面 + REST API + WebSocket 实时对战
// ============================================================
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { register, login, auth, publicUser, setBring, topPlayers, shopList, buyItem, sellItem, setLoadout, consumeLoadout, setAppearance } from './store.js';
import { getWorld } from './world.js';
import { RoomManager } from './rooms.js';
import { WEAPONS, ITEMS, SNAPSHOT_HZ, MAX_PLAYERS } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// 全局异常保护：单次错误打日志，不让服务器整个崩掉
process.on('uncaughtException', (e) => console.error('[guard] 未捕获异常:', e));
process.on('unhandledRejection', (e) => console.error('[guard] 未处理的 Promise 拒绝:', e));

// 静态资源：前端页面 + 共享模块（前端直接 import 同一份配置/地形代码）
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- REST API ----------
app.post('/api/register', (req, res) => {
  const r = register(req.body?.name, req.body?.pass);
  if (r.err) return res.status(400).json(r);
  // 注册成功自动登录
  const l = login(req.body?.name, req.body?.pass);
  res.json(l);
});

app.post('/api/login', (req, res) => {
  const r = login(req.body?.name, req.body?.pass);
  if (r.err) return res.status(400).json(r);
  res.json(r);
});

function getUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  return auth(token);
}

app.get('/api/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ err: '未登录' });
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/bring', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ err: '未登录' });
  const { weaponId } = req.body || {};
  if (weaponId) {
    if (!WEAPONS[weaponId]) return res.status(400).json({ err: '无效武器' });
    if (!user.stash.some(s => s.id === weaponId)) return res.status(400).json({ err: '仓库中没有该武器' });
  }
  const u = setBring(user.name, weaponId || null);
  res.json({ ok: true, user: u });
});

app.get('/api/world', (req, res) => {
  res.json(getWorld());
});

app.get('/api/leaderboard', (req, res) => {
  res.json({ ok: true, top: topPlayers(10) });
});

// ---------- 房间 ----------
const roomMgr = new RoomManager(consumeLoadout);

app.get('/api/rooms', (req, res) => {
  res.json({ ok: true, rooms: roomMgr.list() });
});

app.post('/api/rooms/create', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ err: '未登录' });
  const name = String(req.body?.name || '').trim().slice(0, 16);
  const pass = String(req.body?.pass || '').slice(0, 16);
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]{1,16}$/.test(name)) return res.status(400).json({ err: '房间名需 1-16 位（中文/字母/数字）' });
  // 同名房间不允许
  if ([...roomMgr.rooms.values()].some(r => r.name === name)) return res.status(400).json({ err: '已存在同名房间' });
  const r = roomMgr.create(name, pass || null, user.name);
  if (r.err) return res.status(400).json(r);
  res.json({ ok: true, room: r.room.info() });
});

// ---------- 商店 / 背包 ----------
app.get('/api/shop', (req, res) => {
  res.json({ ok: true, shop: shopList() });
});

app.post('/api/shop/buy', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ err: '未登录' });
  const r = buyItem(user.name, String(req.body?.itemId || ''));
  if (r.err) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/shop/sell', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ err: '未登录' });
  const r = sellItem(user.name, String(req.body?.itemId || ''), parseInt(req.body?.qty, 10) || 1);
  if (r.err) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/appearance', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ err: '未登录' });
  const r = setAppearance(user.name, req.body || {});
  if (r.err) return res.status(400).json(r);
  res.json(r);
});

app.post('/api/loadout', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ err: '未登录' });
  const r = setLoadout(user.name, req.body?.items || []);
  if (r.err) return res.status(400).json(r);
  res.json(r);
});

app.get('/api/meta', (req, res) => {
  res.json({ ok: true, weapons: WEAPONS, items: ITEMS, maxPlayers: MAX_PLAYERS });
});

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

setInterval(() => {
  for (const room of roomMgr.rooms.values()) room.match.snapshot();
}, Math.round(1000 / SNAPSHOT_HZ));   // 快照（各房间独立逻辑循环由房间自己驱动）

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let player = null;
  let room = null;
  let member = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!player) {
      if (msg.t === 'join') {
        const user = auth(msg.token);
        if (!user) {
          try { ws.send(JSON.stringify({ t: 'err', text: '登录已过期，请重新登录' })); } catch {}
          ws.close();
          return;
        }
        // 选房间
        room = msg.roomId ? roomMgr.get(msg.roomId) : roomMgr.getDefault();
        if (!room) {
          try { ws.send(JSON.stringify({ t: 'err', text: '房间不存在或已解散' })); } catch {}
          ws.close();
          return;
        }
        if (room.pass && room.pass !== String(msg.roomPass || '')) {
          try { ws.send(JSON.stringify({ t: 'err', text: '房间密码错误' })); } catch {}
          ws.close();
          return;
        }
        const r = room.joinMember(ws, user);
        if (r.err) {
          try { ws.send(JSON.stringify({ t: 'err', text: r.err })); } catch {}
          ws.close();
          return;
        }
        member = r.member;
        player = r.player;
      }
      return;
    }
    // 房间级消息（等待室交互）
    if (member) {
      if (msg.t === 'roomReady') { room.toggleReady(member.name); return; }
      if (msg.t === 'roomStart') {
        const r = room.start(member.name);
        if (r.err) { try { ws.send(JSON.stringify({ t: 'msg', text: r.err })); } catch {} }
        return;
      }
      if (msg.t === 'roomLeave') {
        room.leaveMember(member);
        member = null; player = null;
        try { ws.send(JSON.stringify({ t: 'roomLeft' })); } catch {}
        return;
      }
    }
    if (player && room) room.match.onMsg(player, msg);
  });

  ws.on('close', () => {
    if (member && room) { room.leaveMember(member); member = null; player = null; }
  });
  ws.on('error', () => {
    if (member && room) { room.leaveMember(member); member = null; player = null; }
  });
});

// 心跳清理死连接
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);

server.listen(PORT, () => {
  const w = getWorld();
  console.log('========================================');
  console.log('  王兰花的超级搜打撤 · 海岛篇 已启动');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  世界: 建筑 ${w.buildings.length} | 家具 ${w.furniture.length} | 战利品点 ${w.lootSpawns.length} | 树 ${w.trees.length}`);
  console.log('========================================');
});
