// tests/_pw.js — 浏览器测试共享设施 (playwright-core + 内置静态服务器)
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

function findChromium() {
  // 1) 环境变量显式指定(优先级最高)
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (envPath) {
    if (fs.existsSync(envPath)) return envPath;
    throw new Error('环境变量 PLAYWRIGHT_CHROMIUM_PATH 指向的文件不存在: ' + envPath);
  }
  // 2) Playwright 默认浏览器缓存(按平台自动探测, 无需手动设环境变量)
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const bases = [];
  if (process.platform === 'darwin') {
    bases.push(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  } else if (process.platform === 'linux') {
    bases.push(path.join(home, '.cache', 'ms-playwright'));
    bases.push('/root/.cache/ms-playwright');
  } else {
    bases.push(path.join(home, 'AppData', 'Local', 'ms-playwright'));
  }
  const macCand = p => path.join(p, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  const linCand = p => path.join(p, 'chrome-linux', 'chrome');
  const winCands = p => [path.join(p, 'chrome-win64', 'chrome.exe'), path.join(p, 'chrome-win', 'chrome.exe')];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => parseInt(b.split('-')[1]) - parseInt(a.split('-')[1]));
    for (const d of dirs) {
      const bp = path.join(base, d);
      const cands = process.platform === 'darwin' ? [macCand(bp)]
        : process.platform === 'linux' ? [linCand(bp)]
        : winCands(bp);
      for (const c of cands) if (fs.existsSync(c)) return c;
    }
  }
  // 3) 系统浏览器回退(macOS / Windows)
  const fallbacks = [];
  if (process.platform === 'darwin') {
    fallbacks.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    fallbacks.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else if (process.platform === 'win32' || process.platform === 'win64') {
    fallbacks.push('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
    fallbacks.push('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe');
    fallbacks.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    fallbacks.push('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
  }
  for (const exe of fallbacks) {
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error([
    '未找到可用的 Chromium/Edge/Chrome 浏览器，浏览器测试无法运行。请任选其一解决:',
    '  1) 设置环境变量 PLAYWRIGHT_CHROMIUM_PATH 指向浏览器可执行文件',
    '  2) 安装 Playwright Chromium: npx playwright@1.61.1 install chromium',
    '     (或已装 python 版: python -m playwright install chromium)',
    '  3) 安装 Microsoft Edge / Google Chrome'
  ].join('\n'));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript' };

function startServer(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const fp = path.join(ROOT, rel);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404); res.end('404'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

async function launch() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  return browser;
}

function attachCollectors(page, state) {
  state.pageErrors = state.pageErrors || [];
  state.failedRequests = state.failedRequests || [];
  state.consoleErrors = state.consoleErrors || [];
  page.on('pageerror', e => state.pageErrors.push(String(e && e.message || e)));
  page.on('requestfailed', r => state.failedRequests.push(r.url() + ' :: ' + (r.failure() ? r.failure().errorText : '?')));
  page.on('console', msg => { if (msg.type() === 'error') state.consoleErrors.push(msg.text()); });
}

class TestReport {
  constructor(name) { this.name = name; this.passed = 0; this.failed = 0; this.lines = []; }
  ok(msg) { this.passed++; this.lines.push('  [PASS] ' + msg); console.log('  [PASS] ' + msg); }
  fail(msg) { this.failed++; this.lines.push('  [FAIL] ' + msg); console.log('  [FAIL] ' + msg); }
  assert(cond, msg) { cond ? this.ok(msg) : this.fail(msg); }
  finish() {
    const verdict = this.failed === 0 ? 'ALL PASS' : this.failed + ' FAILED';
    console.log('\n== ' + this.name + ': ' + this.passed + ' pass / ' + this.failed + ' fail — ' + verdict + ' ==');
    return this.failed === 0 ? 0 : 1;
  }
}

module.exports = { ROOT, findChromium, startServer, launch, attachCollectors, TestReport };
