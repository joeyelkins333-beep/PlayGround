#!/usr/bin/env bash
# Capture desktop + mobile screenshots of the running app.
# Inputs: CAPTURE_URL (exact URL to open), CAPTURE_DIR (output directory).
# Writes final-desktop.png and final-mobile.png into CAPTURE_DIR.
# Exit 75: temporary navigation/browser infrastructure failure.
# Exit 1: script usage defect or app rendering defect.
# Never touches the app server; only opens/closes its own browser.
set -euo pipefail
cd "$(dirname "$0")"

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

fail() { echo "capture.sh: $*" >&2; exit "$1"; }

t check_env bash -c '
  [[ -n "${CAPTURE_URL:-}" ]] || { echo "CAPTURE_URL must be set" >&2; exit 1; }
  [[ -n "${CAPTURE_DIR:-}" ]] || { echo "CAPTURE_DIR must be set" >&2; exit 1; }
' || exit 1
t check_node command -v node
t make_dir mkdir -p "$CAPTURE_DIR"

t run_capture node --input-type=commonjs <<'CAPTURE_EOF'
const { join } = require('node:path');
const { readFileSync, statSync } = require('node:fs');
const { createRequire } = require('node:module');

const url = process.env.CAPTURE_URL;
const output = process.env.CAPTURE_DIR;
const phase = async (name, fn) => {
  const start = Date.now();
  try {
    const result = await fn();
    console.error(`timing capture_phase=${name} duration_ms=${Date.now() - start} status=0`);
    return result;
  } catch (err) {
    console.error(`timing capture_phase=${name} duration_ms=${Date.now() - start} status=1 err=${err.name || 'Error'}`);
    throw err;
  }
};
const transient = (error) => { throw Object.assign(error, { exitCode: 75 }); };

const runtime = join(process.env.HOME, '.local/share/omgithub-playwright');
const runtimeRequire = createRequire(join(runtime, 'package.json'));
const { chromium } = runtimeRequire('playwright');
const config = JSON.parse(readFileSync(join(runtime, 'linux.json'), 'utf8'));
if (!process.env.DISPLAY) {
  process.env.DISPLAY = ':' + readFileSync(join(runtime, 'display'), 'utf8').trim();
}

const VIEWS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];
const READY_SELECTOR = process.env.CAPTURE_READY_SELECTOR || 'canvas#game';
const START_SELECTOR = process.env.CAPTURE_START_SELECTOR || '#btn-start';
const AUTO_START = process.env.CAPTURE_AUTO_START !== 'false';

(async () => {
let browser;
try {
  browser = await phase('browser_launch', () =>
    chromium.launch({ ...config.browser.launchOptions, timeout: 30000 }).catch(transient));

  for (const view of VIEWS) {
    const context = await phase(`${view.name}_context`, () =>
      browser.newContext({
        viewport: { width: view.width, height: view.height },
        ...(view.mobile ? { isMobile: true, hasTouch: true } : {}),
      }).catch(transient));
    const page = await phase(`${view.name}_page`, () => context.newPage().catch(transient));
    try {
      page.setDefaultTimeout(30000);
      page.on('pageerror', (error) => console.error(`pageerror ${view.name}: ${error.message}`));
      const response = await phase(`${view.name}_goto`, () =>
        page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(transient));
      await phase(`${view.name}_response`, async () => {
        if (!response || [408, 429, 500, 502, 503, 504].includes(response.status())) {
          throw Object.assign(new Error(`HTTP ${response ? response.status() : 'no-response'} loading ${url}`), { exitCode: 75 });
        }
        if (!response.ok()) {
          throw Object.assign(new Error(`HTTP ${response.status()} loading ${url}`), { exitCode: 1 });
        }
      });
      // NOTE: wait for the game canvas, not `body` — body has zero size here
      // (all children are fixed-position), which made body-based waits fail.
      await phase(`${view.name}_ready`, async () => {
        try {
          await page.locator(READY_SELECTOR).waitFor({ state: 'visible', timeout: 30000 });
        } catch (err) {
          throw Object.assign(new Error(`rendered content (${READY_SELECTOR}) never became visible`), { exitCode: 1 });
        }
      });
      await phase(`${view.name}_fonts`, () =>
        page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 10000 }).catch(() => {}));
      await phase(`${view.name}_autostart`, async () => {
        if (!AUTO_START) { console.error(`autostart ${view.name}: disabled`); return; }
        const btn = page.locator(START_SELECTOR);
        if ((await btn.count()) > 0 && await btn.first().isVisible().catch(() => false)) {
          await btn.first().click({ timeout: 5000 }).catch(() => {});
          console.error(`autostart ${view.name}: clicked ${START_SELECTOR}`);
        } else {
          console.error(`autostart ${view.name}: no visible ${START_SELECTOR}, kept title screen`);
        }
      });
      await phase(`${view.name}_settle`, () => page.waitForTimeout(1500));
      const path = join(output, `final-${view.name}.png`);
      await phase(`${view.name}_screenshot`, () =>
        page.screenshot({ path, timeout: 30000 }).catch((error) => {
          if (error.name === 'TimeoutError' || !browser.isConnected()) transient(error);
          throw error;
        }));
      const bytes = statSync(path).size;
      console.error(`captured ${view.name}: ${path} (${bytes} bytes)`);
      if (bytes === 0) throw Object.assign(new Error(`empty screenshot ${path}`), { exitCode: 1 });
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = error.exitCode || 1;
} finally {
  await browser?.close().catch((error) => { console.error(error); process.exitCode ||= 75; });
}
})().catch((error) => { console.error(error); process.exitCode = error.exitCode || 1; });
CAPTURE_EOF
capture_status="$?"
t verify_pngs bash -c '
  for f in final-desktop.png final-mobile.png; do
    p="${CAPTURE_DIR}/$f"
    [[ -s "$p" ]] || { echo "missing or empty screenshot: $p" >&2; exit 1; }
    echo "verified $p ($(stat -c %s "$p") bytes)"
  done
' || exit 1
exit "$capture_status"
