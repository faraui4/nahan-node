// Generates worker.js (Node-compatible) from worker.src.js (original Cloudflare version)
import fs from "node:fs";

let s = fs.readFileSync("worker.src.js", "utf8").replace(/\r\n/g, "\n");

function rep(from, to) {
    if (!s.includes(from)) throw new Error("patch point not found: " + from);
    s = s.replace(from, to);
}

rep(
    'import { connect } from "cloudflare:sockets";',
    'import { connect, WebSocketPair, wsResponse } from "./shim.js";',
);
rep(
    "return new Response(null, { status: 101, webSocket: client });",
    "return wsResponse(client);",
);
// close the upstream TCP socket when the client websocket closes
rep(
    '    webSocket.addEventListener("close", () => {\n        activeConnections--;',
    '    webSocket.addEventListener("close", () => {\n        try { remoteSocket && remoteSocket.close(); } catch (e) {}\n        activeConnections--;',
);
// close the client websocket when the upstream ends
rep(
    "                write(chunk) {\n                    webSocket.send(chunk);\n                },\n",
    "                write(chunk) {\n                    webSocket.send(chunk);\n                },\n                close() {\n                    try { webSocket.close(); } catch (e) {}\n                },\n",
);

fs.writeFileSync("worker.js", s);
console.log("worker.js generated");
