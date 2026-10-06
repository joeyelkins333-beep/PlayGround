#!/usr/bin/env bash
# Vale of Oaths — static file server (no dependencies, no build step).
# Serves the project directory (which already contains index.html) in the
# foreground on $PORT (default 3000) and records the deployment output for
# the controller in $OPENCODE_WEB_DIR/deployment-output.json.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT_DIR="$PWD"
PORT="${PORT:-3000}"
: "${OPENCODE_WEB_DIR:?OPENCODE_WEB_DIR must be set}"

# Per-command timing helper: t <name> <command...>
t() {
  local name="$1"; shift
  local start end status
  start="$(date +%s%N)"
  "$@"
  status="$?"
  end="$(date +%s%N)"
  printf 'timing step=%s duration_ms=%d status=%d\n' "$name" "$(( (end - start) / 1000000 ))" "$status" >&2
  return "$status"
}

t check_files test -f "$PROJECT_DIR/index.html"
t check_node command -v node

# Static site: the source directory IS the built output (both stay inside
# PROJECT_DIR). OPENCODE_WEB_DIR is used only for worker metadata.
t write_deployment_output node -e '
const fs = require("node:fs");
const path = require("node:path");
const out = path.join(process.env.OPENCODE_WEB_DIR, "deployment-output.json");
const payload = { project: process.env.PROJECT_DIR, directory: process.env.PROJECT_DIR };
fs.writeFileSync(out, JSON.stringify(payload));
console.log("deployment-output.json -> " + out + " " + JSON.stringify(payload));
'

echo "Serving $PROJECT_DIR on port $PORT (foreground)" >&2

# Foreground static server with exact MIME types. exec replaces this shell so
# the tmux app-server session tracks the server process directly.
# (A forever-running server has no meaningful duration to time; every setup
# command above is timed, and the launcher times this script as a whole.)
# Note: plain `node` with a stdin script loses CJS `require`, and
# `node /dev/stdin` re-opens the path (fails for pipes), so the program is
# piped with --input-type=commonjs and no filename argument.
exec node --input-type=commonjs <<'SERVER_EOF'
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.PROJECT_DIR || process.cwd();
const port = Number(process.env.PORT || 3000);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.normalize(path.join(root, '.' + pathname));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    let stat;
    try { stat = fs.statSync(file); } catch { stat = null; }
    if (!stat || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
    console.log(new Date().toISOString(), req.method, url.pathname, 200);
  } catch (err) {
    console.error('serve error:', err.message);
    try { res.writeHead(500); res.end('Error'); } catch {}
  }
});
server.listen(port, '0.0.0.0', () => console.log(`static server listening on 0.0.0.0:${port} root=${root}`));
SERVER_EOF
