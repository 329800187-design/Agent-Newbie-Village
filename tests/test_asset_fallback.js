// tests/test_asset_fallback.js — R1.2 Round2-R1 验收:
//   AssetRegistry 素材注册 + 降级占位(get/exists/fallback/render);
//   真实 fixture 图片经浏览器加载 naturalWidth/naturalHeight>0 且 requestfailed=0;
//   物理目录映射兼容 peipei/kuro/nodes/bg/cert 等, 角色 id 以「子类型:文件名」避免重名覆盖。
// 用法: node tests/test_asset_fallback.js
const fs = require('fs');
const path = require('path');
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18933;
const REL2 = 'Agent新手村_R1.2-round2-dev.html';
const BUCKETS = ['splash', 'onboard', 'character', 'node', 'done', 'background', 'boss', 'certificate', 'ui'];

// 1x1 PNG (base64) —— 仅用于验证浏览器真实加载
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TMP = path.join(ROOT, 'assets', '_r2tmp');

(async () => {
  const rep = new TestReport('test_asset_fallback');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    // 写入临时 fixture 图片到 assets/_r2tmp/(测试结束后清理, 不入库)
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, 'sample.png'), Buffer.from(PNG_B64, 'base64'));
    fs.writeFileSync(path.join(TMP, 'peipei_R2FIX.png'), Buffer.from(PNG_B64, 'base64'));
    fs.writeFileSync(path.join(TMP, 'kuro_R2FIX.png'), Buffer.from(PNG_B64, 'base64'));

    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL2)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const info = await page.evaluate((BUCKETS) => {
      const A = window.AssetRegistry;
      const out = {
        exists: !!A,
        hasBuckets: BUCKETS.every(b => A && Object.prototype.hasOwnProperty.call(A, b)),
        methods: ['get', 'exists', 'fallback', 'render'].every(m => A && typeof A[m] === 'function')
      };
      let reg = null;
      for (const b of BUCKETS) {
        const ks = Object.keys(A[b] || {});
        if (ks.length) { reg = { type: b, id: ks[0], src: A[b][ks[0]] }; break; }
      }
      out.reg = reg;
      if (reg) {
        const g = A.get(reg.type, reg.id);
        out.getOk = g.ok === true && !!g.src;
        out.renderImg = A.render(reg.type, reg.id).indexOf('<img') >= 0;
      }
      const missType = 'character', missId = 'ZZ99';
      out.missExists = A.exists(missType, missId);
      const fb = A.fallback(missType, missId);
      out.fbHasId = fb.indexOf(missId) >= 0;
      out.fbHasType = fb.indexOf('character') >= 0;
      out.fbNoUndef = fb.indexOf('undefined') < 0;
      out.fbNoImg = fb.indexOf('<img') < 0;
      const rd = A.render(missType, missId);
      out.renderFallback = rd.indexOf('<img') < 0 && rd.indexOf('占位') >= 0 && rd.indexOf(missId) >= 0;
      return out;
    }, BUCKETS);

    rep.assert(info.exists, 'AssetRegistry 已暴露到 window');
    rep.assert(info.hasBuckets, 'AssetRegistry 含 9 个素材分类桶');
    rep.assert(info.methods, 'AssetRegistry 含 get/exists/fallback/render 方法');
    rep.assert(info.reg && info.getOk, `已注册素材 get 返回 ok+src (${info.reg ? info.reg.type + '/' + info.reg.id : '无'})`);
    rep.assert(info.reg && info.renderImg, '已注册素材 render 返回 <img> 标签');
    rep.assert(info.missExists === false, '未注册素材 exists=false');
    rep.assert(info.fbHasId && info.fbHasType, 'fallback 含素材 id 与分类用途文案');
    rep.assert(info.fbNoUndef && info.fbNoImg, 'fallback 无 undefined、无 <img>(不会破图)');
    rep.assert(info.renderFallback, 'render(未注册) 返回占位(无破图、含 id 与用途)');

    // ═══ 真实 fixture 图片: 浏览器加载 naturalWidth/naturalHeight>0 ═══
    const imgCheck = await page.evaluate(async () => {
      const A = window.AssetRegistry;
      function loadImg(html) {
        return new Promise((res) => {
          const d = document.createElement('div'); d.innerHTML = html;
          const img = d.querySelector('img');
          if (!img) { res({ nw: 0, nh: 0, ok: false }); return; }
          document.body.appendChild(img);
          if (img.complete && img.naturalWidth > 0) { res({ nw: img.naturalWidth, nh: img.naturalHeight, ok: true }); return; }
          img.onload = () => res({ nw: img.naturalWidth, nh: img.naturalHeight, ok: true });
          img.onerror = () => res({ nw: img.naturalWidth, nh: img.naturalHeight, ok: false });
        });
      }
      A.splash['R2FIX'] = 'assets/_r2tmp/sample.png';
      const r1 = await loadImg(A.render('splash', 'R2FIX'));
      // 角色子类型 id 分别注册 peipei/kuro, 验证不重名覆盖且均可真实加载
      A.character['peipei:R2FIX'] = 'assets/_r2tmp/peipei_R2FIX.png';
      A.character['kuro:R2FIX'] = 'assets/_r2tmp/kuro_R2FIX.png';
      const r2 = await loadImg(A.render('character', 'peipei:R2FIX'));
      const r3 = await loadImg(A.render('character', 'kuro:R2FIX'));
      return { r1, r2, r3 };
    });
    rep.assert(imgCheck.r1.ok && imgCheck.r1.nw > 0 && imgCheck.r1.nh > 0,
      `已注册素材真实加载 naturalWidth>0 (${imgCheck.r1.nw}x${imgCheck.r1.nh})`);
    rep.assert(imgCheck.r2.ok && imgCheck.r2.nw > 0, `peipei 子类型素材真实加载 naturalWidth>0 (${imgCheck.r2.nw})`);
    rep.assert(imgCheck.r3.ok && imgCheck.r3.nw > 0, `kuro 子类型素材真实加载 naturalWidth>0 (${imgCheck.r3.nw})`);

    // ═══ 物理目录映射 + 角色 id 不重名覆盖 ═══
    const seedCheck = await page.evaluate((BUCKETS) => {
      const A = window.AssetRegistry;
      const out = { allPrefix: true, charSubtyped: true, hasPeipei: false, hasKuro: false, charKeys: [], bad: [] };
      BUCKETS.forEach(b => {
        const o = A[b] || {};
        Object.keys(o).forEach(k => {
          const src = o[k];
          if (typeof src !== 'string' || src.indexOf('assets/') !== 0) out.bad.push(b + '/' + k + '=' + JSON.stringify(src));
          if (src.indexOf('assets/') !== 0) out.allPrefix = false;
          if (b === 'character') {
            out.charKeys.push(k);
            if (k.indexOf(':') < 0) out.charSubtyped = false;
            // 严格的「子类型→物理目录」映射只校验真实 seed 条目; 测试注入的 _r2tmp 临时
            // fixture 仅用于浏览器真实加载, 豁免该子目录约束(其仍以 assets/ 前缀存放)。
            var isTemp = src.indexOf('_r2tmp') >= 0;
            if (k.indexOf('peipei:') === 0) { out.hasPeipei = true; if (!isTemp && src.indexOf('assets/peipei/') !== 0) out.allPrefix = false; }
            if (k.indexOf('kuro:') === 0) { out.hasKuro = true; if (!isTemp && src.indexOf('assets/kuro/') !== 0) out.allPrefix = false; }
          }
        });
      });
      return out;
    }, BUCKETS);
    rep.assert(seedCheck.allPrefix, '所有已注册素材路径均带 assets/ 前缀' + (seedCheck.bad.length ? ' (异常: ' + seedCheck.bad.join(' | ') + ')' : ''));
    rep.assert(seedCheck.charSubtyped && seedCheck.hasPeipei && seedCheck.hasKuro,
      `角色 id 以「子类型:文件名」避免培培/小黑重名覆盖 (${seedCheck.charKeys.join(', ')})`);

    // ═══ 资源加载零失败 ═══
    rep.assert(st.failedRequests.length === 0, `资源加载 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.pageErrors.length === 0, `素材测试全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
