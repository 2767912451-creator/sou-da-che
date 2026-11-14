// WebSocket 客户端封装
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.onClose = null;
    this.onOpen = null;
  }

  on(type, cb) { this.handlers.set(type, cb); return this; }

  connect(token, bring, roomId, roomPass) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws.onopen = () => {
      this.send({ t: 'join', token, bring: bring || null, roomId: roomId || null, roomPass: roomPass || null });
      if (this.onOpen) this.onOpen();
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const h = this.handlers.get(msg.t);
      if (h) h(msg);
      const any = this.handlers.get('*');
      if (any) any(msg);
    };
    this.ws.onclose = () => { if (this.onClose) this.onClose(); };
    this.ws.onerror = () => {};
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    try { this.ws && this.ws.close(); } catch (e) { /* 忽略 */ }
    this.ws = null;
  }
}
