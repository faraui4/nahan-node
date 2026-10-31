// Cloudflare Workers runtime shims for Node.js
if (!globalThis.crypto) globalThis.crypto = webcrypto;
// - connect()        -> cloudflare:sockets replacement (node:net)
// - WebSocketPair    -> server-side pair backed by the `ws` library
// - createD1()       -> D1-like database backed by node:sqlite
import net from "node:net";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/* ---------------- TCP sockets ---------------- */
export function connect({ hostname, port }) {
    const sock = net.connect({ host: hostname, port: Number(port) });
    sock.setNoDelay(true);

    const opened = new Promise((resolve, reject) => {
        sock.once("connect", () => resolve({}));
        sock.once("error", (e) => {
            console.log(`[tcp] connect failed ${hostname}:${port} -> ${e.code || e.message}`);
            reject(e);
        });
    });
    opened.catch(() => {});

    const readable = new ReadableStream({
        start(controller) {
            sock.on("data", (d) => controller.enqueue(new Uint8Array(d)));
            sock.on("end", () => {
                try { controller.close(); } catch {}
            });
            sock.on("error", (e) => {
                try { controller.error(e); } catch {}
            });
        },
        cancel() {
            sock.destroy();
        },
    });

    const writable = new WritableStream({
        write(chunk) {
            const buf = chunk instanceof ArrayBuffer
                ? Buffer.from(chunk)
                : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            return new Promise((resolve, reject) => {
                sock.write(buf, (err) => (err ? reject(err) : resolve()));
            });
        },
        close() {
            sock.end();
        },
        abort() {
            sock.destroy();
        },
    });

    return {
        opened,
        readable,
        writable,
        close() {
            sock.destroy();
            return Promise.resolve();
        },
    };
}

/* ---------------- WebSocketPair ---------------- */
class ServerSocket {
    constructor() {
        this.binaryType = "arraybuffer";
        this._ws = null;
        this._listeners = { message: [], close: [], error: [] };
        this._pending = [];
        this._closed = false;
    }
    accept() {}
    addEventListener(type, fn) {
        (this._listeners[type] ||= []).push(fn);
    }
    _emit(type, ev) {
        for (const fn of this._listeners[type] || []) {
            try { fn(ev); } catch {}
        }
    }
    send(data) {
        if (this._closed) return;
        if (!this._ws) {
            this._pending.push(data);
            return;
        }
        if (this._ws.readyState === 1) this._ws.send(data);
    }
    close() {
        if (this._closed) return;
        this._closed = true;
        try { this._ws?.close(); } catch {}
    }
    _attach(ws) {
        this._ws = ws;
        ws.binaryType = "arraybuffer";
        ws.on("message", (data, isBinary) => {
            let d = data;
            if (Buffer.isBuffer(d)) {
                d = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
            }
            this._emit("message", { data: d });
        });
        ws.on("close", () => {
            this._closed = true;
            this._emit("close", {});
        });
        ws.on("error", () => this._emit("error", {}));
        for (const p of this._pending) {
            try { ws.send(p); } catch {}
        }
        this._pending = [];
        if (this._closed) try { ws.close(); } catch {}
    }
}

export class WebSocketPair {
    constructor() {
        const server = new ServerSocket();
        const client = { __pair: server };
        this[0] = client;
        this[1] = server;
    }
}

// Replacement for `new Response(null, { status: 101, webSocket: client })`
export function wsResponse(client) {
    return { status: 101, webSocket: client, headers: new Headers() };
}

/* ---------------- D1 replacement (JSON file key/value store) ---------------- */
// The worker only uses: CREATE TABLE, SELECT value ... WHERE key=?, INSERT ... ON CONFLICT
export function createD1(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let data = {};
    try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    let timer = null;
    const flush = () => {
        timer = null;
        try {
            const tmp = file + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(data));
            fs.renameSync(tmp, file);
        } catch {}
    };
    const save = () => {
        if (!timer) timer = setTimeout(flush, 300);
    };
    process.on("SIGTERM", () => { flush(); process.exit(0); });
    process.on("SIGINT", () => { flush(); process.exit(0); });

    const make = (sql, params = []) => ({
        bind: (...p) => make(sql, p),
        async all() {
            if (/^\s*select/i.test(sql)) {
                const k = params[0];
                return { results: k in data ? [{ value: data[k] }] : [], success: true };
            }
            return { results: [], success: true };
        },
        async run() {
            if (/^\s*insert/i.test(sql)) {
                data[params[0]] = params[1];
                save();
            }
            return { success: true };
        },
    });
    return { prepare: (sql) => make(sql) };
}
