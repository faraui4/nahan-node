# Nahan - Node.js version

Port of the Cloudflare Worker (`worker.src.js`) to a regular Node.js server.

## Files
- `worker.src.js` : original Worker code (untouched)
- `worker.js`     : generated Node-compatible copy (`npm run build`)
- `shim.js`       : replaces cloudflare:sockets, WebSocketPair and D1 (SQLite)
- `server.js`     : HTTP + WebSocket server
- `Dockerfile`    : for Docker deploy

## Deploy on MS HOST
1. Push this folder to a GitHub repo.
2. New project -> connect repo -> pick Docker (or Node.js: build `npm install`, start `npm start`).
3. Port: 3000 (or whatever `PORT` they inject).
4. IMPORTANT: attach a persistent volume at `/app/data` (or set `DATA_DIR`), otherwise users/settings reset on every redeploy.

## First run
- Dashboard: `https://YOUR-DOMAIN/sync/dash`
- Default master key is `admin` -> change it immediately in the dashboard.
- Subscription: `https://YOUR-DOMAIN/sync` (add `?sub=USERNAME` for multi-user)

## Env vars (optional)
PORT, DATA_DIR, RELAY_IP, DASHBOARD_URL, SUBSCRIPTION_URL

## Notes
- Works on Node >= 18 (no native modules; data is stored in data/nahan-data.json).
- The host must allow WebSocket upgrades and outbound TCP connections.
- "Auto update" via Cloudflare API is irrelevant here; update by pushing new code to GitHub.
