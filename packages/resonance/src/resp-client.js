import net from 'node:net';

// Minimal RESP2 client over node:net. The resonance bus needs GET, SET, RPUSH,
// LRANGE, SCAN, DEL and EVAL, so a full client library would add a dependency
// surface far larger than the protocol we actually speak. Every failure path
// raises an explicit Error: a network bus that silently no-ops is worse than
// one that crashes.

const SIMPLE_STRING = 0x2b; // +
const ERROR = 0x2d; // -
const INTEGER = 0x3a; // :
const BULK_STRING = 0x24; // $
const ARRAY = 0x2a; // *

class RedisReplyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RedisReplyError';
  }
}

function encodeCommand(args) {
  const parts = [Buffer.from(`*${args.length}\r\n`, 'utf8')];
  for (const arg of args) {
    const value = Buffer.isBuffer(arg) ? arg : Buffer.from(String(arg), 'utf8');
    parts.push(Buffer.from(`$${value.length}\r\n`, 'utf8'), value, Buffer.from('\r\n', 'utf8'));
  }
  return Buffer.concat(parts);
}

// Returns { value, next } once a whole reply is buffered, or null while the
// reply is still incomplete.
function decodeReply(buffer, offset) {
  if (offset >= buffer.length) return null;
  const terminator = buffer.indexOf('\r\n', offset, 'utf8');
  if (terminator === -1) return null;

  const type = buffer[offset];
  const line = buffer.toString('utf8', offset + 1, terminator);
  const afterLine = terminator + 2;

  switch (type) {
    case SIMPLE_STRING:
      return { value: line, next: afterLine };
    case ERROR:
      return { value: new RedisReplyError(line), next: afterLine };
    case INTEGER:
      return { value: Number(line), next: afterLine };
    case BULK_STRING: {
      const length = Number(line);
      if (Number.isNaN(length)) throw new Error(`malformed RESP bulk length: ${line}`);
      if (length === -1) return { value: null, next: afterLine };
      const dataEnd = afterLine + length;
      if (buffer.length < dataEnd + 2) return null;
      return { value: buffer.toString('utf8', afterLine, dataEnd), next: dataEnd + 2 };
    }
    case ARRAY: {
      const count = Number(line);
      if (Number.isNaN(count)) throw new Error(`malformed RESP array length: ${line}`);
      if (count === -1) return { value: null, next: afterLine };
      const items = [];
      let cursor = afterLine;
      for (let index = 0; index < count; index += 1) {
        const item = decodeReply(buffer, cursor);
        if (item === null) return null;
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new Error(`unsupported RESP type byte: 0x${type.toString(16)}`);
  }
}

export function createRespClient({
  host = '127.0.0.1',
  port = 6380,
  password,
  connectTimeoutMs = 5000,
  commandTimeoutMs = 10_000,
} = {}) {
  const target = `${host}:${port}`;
  let socket = null;
  let ready = null;
  let buffer = Buffer.alloc(0);
  const pending = [];

  function rejectPending(error) {
    while (pending.length > 0) {
      const waiter = pending.shift();
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  function discard() {
    const dying = socket;
    socket = null;
    ready = null;
    buffer = Buffer.alloc(0);
    if (dying) {
      dying.removeAllListeners();
      dying.on('error', () => {});
      dying.destroy();
    }
  }

  function onData(chunk) {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    for (;;) {
      let reply;
      try {
        reply = decodeReply(buffer, 0);
      } catch (cause) {
        const error = new Error(`redis protocol error from ${target}: ${cause.message}`);
        rejectPending(error);
        discard();
        return;
      }
      if (reply === null) return;
      buffer = Buffer.from(buffer.subarray(reply.next));
      const waiter = pending.shift();
      if (waiter === undefined) continue;
      clearTimeout(waiter.timer);
      if (reply.value instanceof RedisReplyError) waiter.reject(reply.value);
      else waiter.resolve(reply.value);
    }
  }

  function openSocket() {
    return new Promise((resolve, reject) => {
      const opening = net.createConnection({ host, port });
      socket = opening;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error(`redis connection failed: timed out connecting to ${target} after ${connectTimeoutMs}ms`);
        rejectPending(error);
        discard();
        reject(error);
      }, connectTimeoutMs);

      function fail(message) {
        const error = new Error(`redis connection failed: ${message}`);
        rejectPending(error);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }

      opening.setNoDelay(true);
      opening.on('data', onData);
      opening.on('error', (cause) => fail(`${cause.message} (${target})`));
      opening.on('close', () => {
        if (socket === opening) {
          socket = null;
          ready = null;
          buffer = Buffer.alloc(0);
        }
        fail(`connection to ${target} closed`);
      });
      opening.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
    });
  }

  function send(args) {
    return new Promise((resolve, reject) => {
      if (socket === null || socket.destroyed) {
        reject(new Error(`redis connection failed: not connected to ${target}`));
        return;
      }
      const waiter = { resolve, reject };
      waiter.timer = setTimeout(() => {
        const index = pending.indexOf(waiter);
        if (index !== -1) pending.splice(index, 1);
        const error = new Error(`redis command timed out: ${args[0]} against ${target} after ${commandTimeoutMs}ms`);
        discard();
        reject(error);
      }, commandTimeoutMs);
      pending.push(waiter);
      socket.write(encodeCommand(args));
    });
  }

  async function connect() {
    if (ready !== null) return ready;
    const attempt = (async () => {
      await openSocket();
      if (typeof password === 'string' && password.length > 0) {
        try {
          await send(['AUTH', password]);
        } catch (cause) {
          throw new Error(`redis authentication failed against ${target}: ${cause.message}`);
        }
      }
    })();
    ready = attempt;
    try {
      await attempt;
    } catch (error) {
      discard();
      throw error;
    }
    return attempt;
  }

  return Object.freeze({
    connect,

    async command(args) {
      if (!Array.isArray(args) || args.length === 0) throw new TypeError('command requires a non-empty argument array');
      await connect();
      return send(args);
    },

    async close() {
      rejectPending(new Error(`redis connection closed by client (${target})`));
      discard();
    },
  });
}
