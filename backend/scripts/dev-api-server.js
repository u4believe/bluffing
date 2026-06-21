/**
 * scripts/dev-api-server.js
 *
 * Lightweight local stand-in for the Vercel HTTP API. Mounts the existing
 * api/v1/* handlers (standard `(req, res)` functions) on a plain Node http
 * server, so the frontend can hit register / find_table / leaderboard / verify
 * without `vercel dev` (which is unreliable in this WSL environment).
 *
 * It supplies the bits Vercel normally would: parsed `req.body`, `req.query`
 * (incl. dynamic `[id]` params), the `res.status().send()` shim, and CORS for
 * the Next dev app on :3000.
 *
 * Usage (Node 20, env sourced for the WS shared secret):
 *   set -a; . ./.env; set +a
 *   WS_SERVER_INTERNAL_SHARED_SECRET=dev-secret PORT=3001 node scripts/dev-api-server.js
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PORT = process.env.PORT || 3001;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// method + path pattern → handler file. ':param' segments map to req.query[param].
const routes = [
  { method: "POST", pattern: "/v1/agents/register",    file: "api/v1/agents/register.js" },
  { method: "GET",  pattern: "/v1/agents/:id/history", file: "api/v1/agents/[id]/history.js" },
  { method: "POST", pattern: "/v1/tables/find",        file: "api/v1/tables/find.js" },
  { method: "POST", pattern: "/v1/tables/leave",       file: "api/v1/tables/leave.js" },
  { method: "POST", pattern: "/v1/tables/:id/join",    file: "api/v1/tables/[id]/join.js" },
  { method: "POST", pattern: "/v1/tables/:id/action",  file: "api/v1/tables/[id]/action.js" },
  { method: "GET",  pattern: "/v1/matches/:id/log",    file: "api/v1/matches/[id]/log.js" },
  { method: "GET",  pattern: "/v1/matches/:id/verify", file: "api/v1/matches/[id]/verify.js" },
  { method: "GET",  pattern: "/v1/leaderboard",        file: "api/v1/leaderboard/index.js" },
];

function matchRoute(method, pathname) {
  const aSeg = pathname.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.method !== method) continue;
    const pSeg = r.pattern.split("/").filter(Boolean);
    if (pSeg.length !== aSeg.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pSeg.length; i++) {
      if (pSeg[i].startsWith(":")) params[pSeg[i].slice(1)] = decodeURIComponent(aSeg[i]);
      else if (pSeg[i] !== aSeg[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve(data); }
    });
  });
}

const handlerCache = new Map();
async function loadHandler(file) {
  if (!handlerCache.has(file)) {
    const mod = await import(pathToFileURL(path.join(ROOT, file)).href);
    handlerCache.set(file, mod.default);
  }
  return handlerCache.get(file);
}

const server = http.createServer(async (req, res) => {
  // CORS so the Next dev app (:3000) can call this API (:3001).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Agent-Key");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const matched = matchRoute(req.method, url.pathname);
  if (!matched) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: `No route for ${req.method} ${url.pathname}` } }));
    return;
  }

  // Vercel-style shims the handlers expect.
  req.query = { ...Object.fromEntries(url.searchParams), ...matched.params };
  req.body = await readBody(req);
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.end(body); };

  const started = Date.now();
  try {
    const handler = await loadHandler(matched.route.file);
    await handler(req, res);
    console.log(`${req.method} ${url.pathname} → ${res.statusCode} (${Date.now() - started}ms)`);
  } catch (err) {
    console.error(`${req.method} ${url.pathname} handler error:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "internal_error", message: String(err?.message || err) } }));
    }
  }
});

server.listen(PORT, () => console.log(`Bluffline dev API on :${PORT} (mounting api/v1/* handlers)`));
