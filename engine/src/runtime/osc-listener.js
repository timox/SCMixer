import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';

function readString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end += 1;
  const value = buf.toString('utf8', offset, end);
  return { value, next: offset + Math.ceil((end - offset + 1) / 4) * 4 };
}

/** Décode un message OSC simple (int32, float32, chaîne). Les autres types sont refusés. */
export function decodeOsc(buf) {
  const addr = readString(buf, 0);
  if (!addr.value.startsWith('/')) throw new Error('Adresse OSC invalide');
  let offset = addr.next;
  const args = [];
  if (offset >= buf.length) return { address: addr.value, args };
  const tags = readString(buf, offset);
  offset = tags.next;
  for (const tag of tags.value.slice(1)) {
    if (tag === 'i') { args.push(buf.readInt32BE(offset)); offset += 4; }
    else if (tag === 'f') { args.push(buf.readFloatBE(offset)); offset += 4; }
    else if (tag === 's') { const s = readString(buf, offset); args.push(s.value); offset = s.next; }
    else throw new Error(`Type OSC non pris en charge : ${tag}`);
  }
  return { address: addr.value, args };
}

/** Récepteur UDP local (127.0.0.1, port choisi par le système) émettant `message` { address, args }. */
export class OscListener extends EventEmitter {
  #socket = null;

  async start() {
    if (this.#socket) throw new Error('Récepteur OSC déjà démarré');
    const socket = dgram.createSocket('udp4');
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, '127.0.0.1', () => { socket.off('error', reject); resolve(); });
    });
    socket.on('message', (buf) => {
      let message;
      try { message = decodeOsc(buf); } catch { return; }
      this.emit('message', message);
    });
    socket.on('error', () => {});
    this.#socket = socket;
    return socket.address().port;
  }

  stop() {
    if (!this.#socket) return;
    try { this.#socket.close(); } catch { /* déjà fermé */ }
    this.#socket = null;
  }
}
