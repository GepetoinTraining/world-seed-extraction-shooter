/**
 * A WEBSOCKET, ON NODE'S OWN HTTP (RFC 6455). Online play needs a socket, and nothing new is
 * installed for it: the handshake and the frames are a few dozen lines. Text frames only, which is
 * all the live room speaks (JSON); a ping is answered, a close is closed. A client's frames come
 * masked, as the RFC says they must; a server's go bare.
 *
 * What a frame may carry is what the room sends and takes; a message too large for one read is
 * gathered across reads, so nothing here is a ceiling on a message.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface ISocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onMessage(fn: (text: string) => void): void;
  onClose(fn: () => void): void;
  readonly open: boolean;
}

/** Answers the upgrade, or refuses it with a plain HTTP status. */
export function acceptSocket(req: IncomingMessage, raw: Duplex): ISocket | null {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string') {
    raw.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  raw.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);

  let open = true;
  let buffered = Buffer.alloc(0);
  let pieces: Buffer[] = [];
  const onMessage: ((text: string) => void)[] = [];
  const onClose: (() => void)[] = [];

  const frame = (opcode: number, payload: Buffer) => {
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | opcode, n])
      : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff])
      : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
    return Buffer.concat([head, payload]);
  };

  const shut = () => {
    if (!open) return;
    open = false;
    for (const fn of onClose) fn();
  };

  raw.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      if (buffered.length < 2) return;
      const fin = (buffered[0] & 0x80) !== 0;
      const opcode = buffered[0] & 0x0f;
      const masked = (buffered[1] & 0x80) !== 0;
      let length = buffered[1] & 0x7f;
      let at = 2;
      if (length === 126) { if (buffered.length < 4) return; length = buffered.readUInt16BE(2); at = 4; }
      else if (length === 127) { if (buffered.length < 10) return; length = Number(buffered.readBigUInt64BE(2)); at = 10; }
      const maskAt = at;
      if (masked) at += 4;
      if (buffered.length < at + length) return;
      const payload = Buffer.from(buffered.subarray(at, at + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buffered[maskAt + (i % 4)];
      buffered = buffered.subarray(at + length);

      if (opcode === 0x8) { if (open) raw.end(frame(0x8, payload.subarray(0, 2))); shut(); return; }
      if (opcode === 0x9) { raw.write(frame(0xa, payload)); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        pieces.push(payload);
        if (fin) {
          const text = Buffer.concat(pieces).toString('utf8');
          pieces = [];
          for (const fn of onMessage) fn(text);
        }
      }
    }
  });
  raw.on('close', shut);
  raw.on('error', shut);

  return {
    get open() { return open; },
    send(text) { if (open) raw.write(frame(0x1, Buffer.from(text, 'utf8'))); },
    close(code = 1000, reason = '') {
      if (!open) return;
      const body = Buffer.alloc(2 + Buffer.byteLength(reason));
      body.writeUInt16BE(code, 0);
      body.write(reason, 2);
      raw.end(frame(0x8, body));
      shut();
    },
    onMessage(fn) { onMessage.push(fn); },
    onClose(fn) { onClose.push(fn); }
  };
}
