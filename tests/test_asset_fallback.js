// tests/test_asset_fallback.js — R1.2 Round2 验收:
//   AssetRegistry 素材注册 + 降级占位(get/exists/fallback/render),
//   缺失素材显示占位(含 id 与用途), 不出现破图(<img onerror) / undefined。
// 用法: node tests/test_asset_fallback.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18933;
const REL2 = 'Agent新手村_R1.2-round2-dev.html';
const BUCKETS = ['splash', 'onboard', 'character', 'node', 'done', 'background', 'boss', 'certificate', 'ui'];

(async () => {
  const rep = new TestReport('test_asset_fallback');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, {});
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL2)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const info = await page.evaluate((BUCKETS) => {
      const A = window.AssetRegistry;
      const out = {
        exists: !!A,
        hasBuckets: BUCKETS.every(b => A && Object.prototype.hasOwnProperty.call(A, b)),
        methods: ['get', 'exists', 'fallback', 'render'].every(m => A && typeof A[m] === 'function')
      };
      // 找一个已注册素材
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
      // 未注册素材 → fallback
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
    rep.assert(info.hasBuckets, 'AssetRegistry 含 9 个素材分类桶(splash/onboard/character/node/done/background/boss/certificate/ui)');
    rep.assert(info.methods, 'AssetRegistry 含 get/exists/fallback/render 方法');
    rep.assert(info.reg && info.getOk, `已注册素材 get 返回 ok+src (${info.reg ? info.reg.type + '/' + info.reg.id : '无'})`);
    rep.assert(info.reg && info.renderImg, '已注册素材 render 返回 <img> 标签');
    rep.assert(info.missExists === false, '未注册素材 exists=false');
    rep.assert(info.fbHasId && info.fbHasType, 'fallback 含素材 id 与分类用途文案');
    rep.assert(info.fbNoUndef && info.fbNoImg, 'fallback 无 undefined、无 <img>(不会破图)');
    rep.assert(info.renderFallback, 'render(未注册) 返回占位(无破图、含 id 与用途)');

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
