// tests/test_asset_registry_broken.js — R1.2 Round2-R2 阻断缺陷修复验收:
//   已注册素材 URL 加载失败时, 不再静默隐藏 <img>, 而是运行时替换为统一 fallback 占位。
//   测试注册一个真实存在于 Registry、但内容不是有效图片的临时文件(HTTP 200, 图片解码失败),
//   避免把预期的 404 计入 requestfailed。
// 验证项:
//   1) render(已注册损坏素材) 输出 host span + <img>, src 带 assets/ 前缀;
//   2) 无效图片触发 onerror, <img> 被移除(fallback 替换);
//   3) fallback 出现且含素材 ID 与用途文案、无 undefined;
//   4) 全程 pageerror = 0、requestfailed = 0。
// 用法: node tests/test_asset_registry_broken.js
const fs = require('fs');
const path = require('path');
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18938;
const REL2 = 'Agent新手村_R1.2-round2-dev.html';
const TMP = path.join(ROOT, 'assets', '_r2tmp');

(async () => {
  const rep = new TestReport('test_asset_registry_broken');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    // 写入普通文本作为 .png: 服务器返回 HTTP 200, 但浏览器按图片解码失败 -> 触发 onerror(不计 404)
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, 'broken.png'), 'this is NOT a valid PNG image; intentionally broken for fallback test');

    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL2)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const res = await page.evaluate(async () => {
      const A = window.AssetRegistry;
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      // 1) 把一个真实可访问(HTTP 200)但非有效图片的临时文件注册进 Registry
      A.splash['BROKEN'] = 'assets/_r2tmp/broken.png';
      const html = A.render('splash', 'BROKEN');
      const host = document.createElement('div');
      host.innerHTML = html;
      const span = host.querySelector('.asset-runtime-host');
      const img = host.querySelector('img');
      const src = img ? img.getAttribute('src') : null;
      const hasSpan = !!span, hasImg = !!img;
      // 2) 插入真实 DOM, 等待图片 error + fallback 替换
      document.body.appendChild(host);
      await w(1200);
      // 3) 验证: <img> 已被移除(被 fallback 替换)、fallback 出现
      const stillImg = !!document.querySelector('.asset-runtime-host img');
      const fb = document.querySelector('.asset-fallback');
      const fbText = fb ? fb.textContent : '';
      const fbType = fb ? fb.getAttribute('data-type') : null;
      const fbId = fb ? fb.getAttribute('data-id') : null;
      document.body.removeChild(host.parentNode ? host : host); // 安全清理(host 可能已被替换)
      return {
        hasSpan, hasImg, src,
        imgRemoved: !stillImg,
        fbExists: !!fb,
        fbText, fbType, fbId
      };
    });

    rep.assert(res.hasSpan && res.hasImg, 'render(已注册损坏素材) 输出 host span + <img>');
    rep.assert(res.src && res.src.indexOf('assets/') === 0, `损坏素材 src 带 assets/ 前缀 (${res.src})`);
    rep.assert(res.imgRemoved, 'onerror 后 <img> 被移除(被 fallback 替换, 不再静默破图)');
    rep.assert(res.fbExists, '加载失败后出现统一 fallback 占位');
    rep.assert(res.fbId === 'BROKEN', `fallback 含素材 ID (data-id=${res.fbId})`);
    rep.assert(res.fbType === 'splash', `fallback 含素材分类用途 (data-type=${res.fbType})`);
    rep.assert(res.fbText.indexOf('BROKEN') >= 0, 'fallback 文案含素材 ID (BROKEN)');
    rep.assert(res.fbText.indexOf('undefined') < 0, 'fallback 文案无 undefined');
    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `资源加载 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
