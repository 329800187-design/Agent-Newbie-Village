// tests/test_runtime_assets.js — 骨架验收: 浏览器实测运行时资源
// 检查: 74关全渲染 / manifest required 图片全部可加载(naturalWidth>0) /
//       requestfailed=0 / pageerror=0 / K01-K03 / W3-W7 Boss 备用标签 / 初始仅 ai_camp_1 解锁
// 用法: node tests/test_runtime_assets.js
const fs = require('fs');
const path = require('path');
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18921;
const DEV = 'Agent新手村_开发测试版.html';   // TEST_MODE=true: 允许 startLevel 遍历
const REL = 'Agent新手村_v1.0_发布候选版.html'; // TEST_MODE=false: 用户真实面

(async () => {
  const rep = new TestReport('test_runtime_assets');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    // ═══ A. 开发测试版: 74 关全渲染 + 收集错误 ═══
    let st = {};
    let ctx = await browser.newContext();
    let page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(DEV)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    const ids = await page.evaluate(() => Object.keys(LevelData));
    rep.assert(ids.length === 74, `LevelData 共 74 关 (实际 ${ids.length})`);

    const renderResults = await page.evaluate(async (ids) => {
      const out = [];
      for (const id of ids) {
        try {
          Game.startLevel(id);
          await new Promise(r => setTimeout(r, 60));
          const el = document.getElementById('level-content');
          const title = document.getElementById('level-title');
          out.push({ id, ok: !!(el && el.innerHTML.length > 200 && title && title.textContent.length > 0), len: el ? el.innerHTML.length : 0 });
        } catch (e) {
          out.push({ id, ok: false, err: String(e && e.message || e) });
        }
      }
      return out;
    }, ids);
    const badRender = renderResults.filter(r => !r.ok);
    rep.assert(badRender.length === 0, `74 关全部渲染成功 (失败 ${badRender.length}: ${badRender.slice(0, 5).map(b => b.id + (b.err ? ':' + b.err : ':len=' + b.len)).join(', ') || '无'})`);
    await page.waitForTimeout(1200); // 等待关卡内图片请求收尾

    // ═══ B. manifest required 资源逐个真实加载 ═══
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'asset_manifest.json'), 'utf-8'));
    const required = manifest.assets.filter(a => a.required).map(a => a.path);
    const loadRes = await page.evaluate(async (paths) => {
      const bad = [];
      const loadOne = (p) => new Promise((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => resolve({ p, ok: false, why: 'timeout' }), 8000);
        img.onload = () => { clearTimeout(timer); resolve({ p, ok: img.naturalWidth > 0 && img.naturalHeight > 0, why: 'nw=' + img.naturalWidth }); };
        img.onerror = () => { clearTimeout(timer); resolve({ p, ok: false, why: 'onerror' }); };
        img.src = p + '?t=' + Date.now();
      });
      for (let i = 0; i < paths.length; i += 10) {
        const batch = await Promise.all(paths.slice(i, i + 10).map(loadOne));
        for (const b of batch) if (!b.ok) bad.push(b.p + '(' + b.why + ')');
      }
      return { total: paths.length, bad };
    }, required);
    rep.assert(loadRes.bad.length === 0, `required 资源 ${loadRes.total} 项全部自然宽高>0 (失败: ${loadRes.bad.slice(0, 5).join(', ') || '无'})`);

    // ═══ C. K01/K02/K03 在入村流程真实渲染加载 ═══
    const kRes = await page.evaluate(async () => {
      const out = {};
      const steps = [['gate', 'K01'], ['mode', 'K02'], ['basis', 'K03']];
      Onboard.state = { retest: false, step: null, mode: 'standard', basis: null, qIdx: 0, answers: [] };
      document.getElementById('onboard').classList.add('show');
      for (const [step, k] of steps) {
        Onboard._go(step);
        await new Promise(r => setTimeout(r, 500));
        const img = document.querySelector('#ob-inner .ob-illu img');
        out[k] = !!(img && img.complete && img.naturalWidth > 0 && img.src.indexOf(k) >= 0);
      }
      Onboard.hide();
      return out;
    });
    for (const k of ['K01', 'K02', 'K03']) rep.assert(kRes[k] === true, `入村插画 ${k} 浏览器加载成功`);

    // ═══ D. W3-W7 Boss 备用标签 (InfoCard) ═══
    const bossRes = await page.evaluate(() => {
      const cases = [['w3_13', 'D04'], ['w4_8', 'D05'], ['w5_8', 'D06'], ['w6_9', 'D07'], ['w7_7', 'D08']];
      const out = [];
      Game.backToMap();
      for (const [id, tag] of cases) {
        InfoCard.show(id);
        const card = document.getElementById('info-card');
        const html = card ? card.innerHTML : '';
        out.push({ id, tag, hasTag: html.indexOf(tag) >= 0, hasUndef: html.indexOf('D0undefined') >= 0 });
      }
      return out;
    });
    for (const b of bossRes) {
      rep.assert(b.hasTag && !b.hasUndef, `Boss 备用标签 ${b.id} → ${b.tag} (undefined残留: ${b.hasUndef})`);
    }
    const anyUndef = await page.evaluate(() => document.body.innerHTML.indexOf('D0undefined') >= 0);
    rep.assert(!anyUndef, '页面无 D0undefined');

    // ═══ E. 错误面板 (开发测试版全程) ═══
    rep.assert(st.pageErrors.length === 0, `pageerror = 0 (实际 ${st.pageErrors.length}: ${st.pageErrors.slice(0, 3).join(' | ') || '无'})`);
    rep.assert(st.failedRequests.length === 0, `requestfailed = 0 (实际 ${st.failedRequests.length}: ${st.failedRequests.slice(0, 3).join(' | ') || '无'})`);
    await ctx.close();

    // ═══ F. 发布候选版: 初始仅 ai_camp_1 解锁 + 0 错误 ═══
    const st2 = {};
    ctx = await browser.newContext();
    page = await ctx.newPage();
    attachCollectors(page, st2);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    const relInfo = await page.evaluate(() => ({
      testMode: typeof TEST_MODE !== 'undefined' ? TEST_MODE : null,
      realUnlocked: Object.keys(LevelData).filter(id => _realUnlocked(id)),
      trialsEnabled: typeof WORLD_TRIALS_ENABLED !== 'undefined' ? WORLD_TRIALS_ENABLED : null,
    }));
    rep.assert(relInfo.testMode === false, `发布候选版 TEST_MODE=false (${relInfo.testMode})`);
    rep.assert(relInfo.trialsEnabled === false, `WORLD_TRIALS_ENABLED=false (${relInfo.trialsEnabled})`);
    rep.assert(JSON.stringify(relInfo.realUnlocked) === JSON.stringify(['ai_camp_1']), `初始仅 ai_camp_1 解锁 (实际 ${JSON.stringify(relInfo.realUnlocked)})`);
    rep.assert(st2.pageErrors.length === 0, `发布候选版 pageerror = 0 (${st2.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st2.failedRequests.length === 0, `发布候选版 requestfailed = 0 (${st2.failedRequests.slice(0, 3).join(' | ') || '0'})`);
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
