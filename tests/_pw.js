// tests/_pw.js — 浏览器测试共享设施 (playwright-core + 内置静态服务器)
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

function findChromium() {
  // 1) 环境变量显式指定
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (envPath) {
    if (fs.existsSync(envPath)) return envPath;
    throw new Error('环境变量 PLAYWRIGHT_CHROMIUM_PATH 指向的文件不存在: ' + envPath);
  }
  // 2) Playwright 默认浏览器目录 (ms-playwright)
  const base = path.join(process.env.USERPROFILE || process.env.HOME || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(base)) {
    const dirs = fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => parseInt(b.split('-')[1]) - parseInt(a.split('-')[1]));
    for (const d of dirs) {
      for (const sub of ['chrome-win64', 'chrome-win']) {
        const exe = path.join(base, d, sub, 'chrome.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  // 3) Windows Edge  4) Windows Chrome
  const fallbacks = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const exe of fallbacks) {
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error([
    '未找到可用的 Chromium/Edge/Chrome 浏览器，浏览器测试无法运行。请任选其一解决:',
    '  1) 设置环境变量 PLAYWRIGHT_CHROMIUM_PATH 指向浏览器可执行文件,',
    '     例如: set PLAYWRIGHT_CHROMIUM_PATH=D:\\browsers\\chrome.exe',
    '  2) 安装 Playwright Chromium: npx playwright@1.61.1 install chromium',
    '     (或已装 python 版: python -m playwright install chromium)',
    '  3) 安装 Microsoft Edge: https://www.microsoft.com/edge',
    '  4) 安装 Google Chrome: https://www.google.com/chrome/'
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
