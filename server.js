// Node.js host for the Nahan worker (originally Cloudflare Workers)
import http from "node:http";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createD1 } from "./shim.js";
import worker from "./worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

const env = {
    IOT_DB: createD1(path.join(DATA_DIR, "nahan-data.json")),
    RELAY_IP: process.env.RELAY_IP || "",
    DASHBOARD_URL: process.env.DASHBOARD_URL || undefined,
    SUBSCRIPTION_URL: process.env.SUBSCRIPTION_URL || undefined,
};

const makeCtx = () => ({
    waitUntil(p) {
        Promise.resolve(p).catch(() => {});
    },
    passThroughOnException() {},
});

function clientIp(req) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
    return req.socket.remoteAddress || "0.0.0.0";
}

function toRequest(req) {
    const proto = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const url = `${String(proto).split(",")[0]}://${host}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
        if (["connection", "keep-alive", "transfer-encoding", "content-length"].includes(k)) continue;
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
        else if (v !== undefined) headers.set(k, v);
    }
    headers.set("cf-connecting-ip", clientIp(req));
    headers.set("host", String(host));
    const init = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = Readable.toWeb(req);
        init.duplex = "half";
    }
    const r = new Request(url, init);
    // Cloudflare-specific field (optional chaining is used in the worker)
    r.cf = {};
    return r;
}

const server = http.createServer(async (req, res) => {
    console.log(`[http] ${req.method} ${req.url.split("?")[0].slice(0, 40)}`);
    try {
        const response = await worker.fetch(toRequest(req), env, makeCtx());
        const headers = {};
        response.headers.forEach((v, k) => {
            if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) return;
            headers[k] = v;
        });
        const cookies = response.headers.getSetCookie?.() || [];
        if (cookies.length) headers["set-cookie"] = cookies;
        res.writeHead(response.status, headers);
        if (response.body) Readable.fromWeb(response.body).pipe(res);
        else res.end();
    } catch (e) {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
    socket.on("error", () => {});
    console.log(`[ws] upgrade request ${req.url.slice(0, 40)} from ${clientIp(req)}`);
    try {
        const response = await worker.fetch(toRequest(req), env, makeCtx());
        if (response.status === 101 && response.webSocket) {
            const serverSock = response.webSocket.__pair;
            wss.handleUpgrade(req, socket, head, (ws) => {
                console.log("[ws] connected");
                ws.on("close", () => console.log("[ws] closed"));
                serverSock._attach(ws);
            });
        } else {
            console.log(`[ws] rejected by worker, status=${response.status}`);
            socket.write(`HTTP/1.1 ${response.status || 404} Error\r\nConnection: close\r\n\r\n`);
            socket.destroy();
        }
    } catch (e) {
        console.log("[ws] error: " + (e && e.message));
        socket.destroy();
    }
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Nahan (Node) listening on :${PORT}`);
});

// Replacement for Cloudflare Cron Trigger (auto-update check), hourly
if (typeof worker.scheduled === "function") {
    setInterval(() => {
        worker.scheduled({}, env, makeCtx()).catch(() => {});
    }, 60 * 60 * 1000);
}

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
