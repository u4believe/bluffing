/**
 * lib/http.js
 * Small helpers shared across api/ route handlers.
 */

export function sendJSON(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(body));
}

export function sendError(res, status, code, message) {
  sendJSON(res, status, { error: { code, message } });
}

export function methodGuard(req, res, allowedMethods) {
  // CORS: the browser frontend is served from a different origin than this API,
  // so every response needs these headers and OPTIONS preflights must succeed.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Agent-Key");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return false;
  }
  if (!allowedMethods.includes(req.method)) {
    sendError(res, 405, "method_not_allowed", `Allowed methods: ${allowedMethods.join(", ")}`);
    return false;
  }
  return true;
}

/** Extract and validate the X-Agent-Key header. Returns the raw key or null. */
export function getApiKey(req) {
  return req.headers["x-agent-key"] || null;
}

export async function readJSONBody(req) {
  if (req.body && typeof req.body === "object") return req.body; // Vercel auto-parses JSON bodies
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}
