// ============================================================
// 房间管理：等待室（加入/准备/房主开始）→ 对局 → 结算回等待室
// 对局进行中禁止加入；全员撤离或死亡即本局结束
// ============================================================
import { Match } from './match.js';
import { MAX_PLAYERS } from '../shared/constants.js';

function sendWs(ws, msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* 忽略 */ }
  }
}

export class Room {
  constructor(id, name, pass, isDefault) {
    this.id = id;
    this.name = name;
    this.pass = pass || null;
    this.isDefault = !!isDefault;
    this.creator = null;           // 房主昵称
    this.members = [];             // [{name, user, ws, ready, player}] 按加入顺序
    this.createdAt = Date.now();
    this.emptySince = null;
    this.match = new Match();
    // 对局内玩家出局时回调（死亡/撤离）：从对局名单移除
    this.match.onPlayerOut = (p) => {
      const m = this.members.find(x => x.name === p.name);
      if (m) { m.player = null; m.ready = false; }
      this.broadcastRoomState();
    };
    // 对局结束回调：回到等待室并刷新全员界面
    this.match.onMatchEnd = () => {
      this.broadcastRoomState();
    };
    this.timers = [
      setInterval(() => this.match.tick(), 100),
    ];
  }

  state() { return this.match.state; }

  info() {
    return {
      id: this.id,
      name: this.name,
      hasPass: !!this.pass,
      isDefault: this.isDefault,
      creator: this.creator,
      state: this.match.state,
      members: this.members.length,
      players: this.members.filter(m => m.player && (m.player.state === 'ground' || m.player.state === 'sky')).length,
      maxPlayers: MAX_PLAYERS,
      live: this.match.state === 'live',
      matchT: this.match.state === 'live' ? Math.round(this.match.matchT) : 0,
      matchLen: this.match.matchLen,
    };
  }

  roomState() {
    return {
      t: 'roomState',
      state: this.match.state,
      roomName: this.name,
      creator: this.creator,
      matchT: this.match.state === 'live' ? Math.round(this.match.matchT) : 0,
      members: this.members.map(m => ({
        name: m.name,
        ready: m.ready,
        owner: m.name === this.creator,
        st: m.player ? m.player.state : 'out',
      })),
    };
  }

  broadcastRoomState() {
    const msg = this.roomState();
    for (const m of this.members) sendWs(m.ws, msg);
  }

  findMember(name) { return this.members.find(m => m.name === name); }

  /** 加入房间（仅等待室阶段） */
  joinMember(ws, user) {
    if (this.match.state !== 'waiting') return { err: '对局已开始，无法中途加入' };
    if (this.members.some(m => m.name === user.name)) return { err: '你已在该房间中' };
    if (this.members.length >= MAX_PLAYERS) return { err: '房间已满' };
    const player = this.match.join(ws, user.name, user);
    const member = { name: user.name, user, ws, ready: false, player };
    if (!this.creator) this.creator = user.name;
    this.members.push(member);
    this.broadcastRoomState();
    return { member, player };
  }

  /** 离开房间（等待室主动退出 / 掉线） */
  leaveMember(member) {
    const idx = this.members.indexOf(member);
    if (idx < 0) return;
    this.members.splice(idx, 1);
    if (member.player) this.match.leave(member.player);
    if (this.creator === member.name) {
      this.creator = this.members.length ? this.members[0].name : null;
    }
    this.broadcastRoomState();
  }

  /** 准备/取消准备 */
  toggleReady(name) {
    const m = this.findMember(name);
    if (!m || this.match.state !== 'waiting') return;
    m.ready = !m.ready;
    this.broadcastRoomState();
  }

  /** 房主开始游戏：全员已准备 + 等待室状态 */
  start(name) {
    if (this.creator !== name) return { err: '只有房主才能开始游戏' };
    if (this.match.state !== 'waiting') return { err: '对局已开始' };
    const unready = this.members.filter(m => !m.ready);
    if (unready.length) return { err: `还有 ${unready.length} 人未准备：${unready.map(m => m.name).join('、')}` };
    // 消耗各成员携带清单，注入对局（出局成员先重建 player 对象）
    for (const m of this.members) {
      if (!m.player) m.player = this.match.join(m.ws, m.name, m.user);
      m.player.loadoutItems = this.consumeFn(m.name);
    }
    this.match.startMatch();
    this.broadcastRoomState();
    return { ok: true };
  }

  destroy() {
    this.timers.forEach(clearInterval);
  }
}

export class RoomManager {
  constructor(consumeFn) {
    this.consumeFn = consumeFn;   // store.consumeLoadout
    this.rooms = new Map();
    this.seq = 1;
    this.create('公共战场', null, null, true);
    setInterval(() => this.cleanup(), 20000);
  }

  create(name, pass, owner, isDefault = false) {
    if (this.rooms.size >= 8) return { err: '房间数已达上限（8 个），请稍后再试' };
    const id = 'R' + this.seq++;
    const room = new Room(id, name, pass, isDefault);
    room.consumeFn = this.consumeFn;
    this.rooms.set(id, room);
    console.log(`[room] 房间创建: ${name}${pass ? '（有密码）' : ''}${owner ? ' by ' + owner : ''}`);
    return { room };
  }

  get(id) { return this.rooms.get(id); }

  getDefault() {
    for (const r of this.rooms.values()) if (r.isDefault) return r;
    return [...this.rooms.values()][0];
  }

  list() {
    return [...this.rooms.values()]
      .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.id.localeCompare(b.id))
      .map(r => r.info());
  }

  cleanup() {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.isDefault) continue;
      if (room.members.length === 0) {
        if (!room.emptySince) room.emptySince = now;
        else if (now - room.emptySince > 60000) {
          room.destroy();
          this.rooms.delete(id);
          console.log(`[room] 房间「${room.name}」空置解散`);
        }
      } else {
        room.emptySince = null;
      }
    }
  }
}
