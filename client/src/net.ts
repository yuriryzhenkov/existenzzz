import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export class Net {
  ws: WebSocket | null = null;
  private url: string;
  private retry = 0;
  onMsg: (m: ServerMsg) => void = () => {};
  onStatus: (s: 'open' | 'closed') => void = () => {};
  private closedByUs = false;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    this.closedByUs = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.onStatus('open'); };
    ws.onmessage = (e) => {
      try { this.onMsg(JSON.parse(e.data)); } catch (err) { console.warn(err); }
    };
    ws.onclose = () => {
      this.onStatus('closed');
      if (this.closedByUs) return;
      const delay = Math.min(10000, 500 * Math.pow(1.7, this.retry++));
      setTimeout(() => this.connect(), delay);
    };
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
  }
}
