// tests/test_round2_representative_levels.js — R1.2 Round2 验收:
//   7 个代表关卡接入统一体验模板 + 完成反馈; W6/W7 门禁不被 Round2 改动;
//   渲染全程 0 错误。
// 注意: 直接调用 Level.render(id)(避开 TEST_MODE=false 的解锁门禁) 以注入体验面板。
// 用法: node tests/test_round2_representative_levels.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18934;
const REL2 = 'Agent新手村_R1.2-round2-dev.html';
const IDS = ['ai_camp_1', 'w1_1', 'w3_13', 'w4_4', 'w4_7', 'w6_9', 'w7_7'];

(async () => {
  const rep = new TestReport('test_round2_representative_levels');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL2)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    // ═══ 逐关渲染 + 注入面板校验 ═══
    for (const id of IDS) {
      const r = await page.evaluate(async (id) => {
        const out = {
          inLD: Object.prototype.hasOwnProperty.call(LevelData, id),
          inReg: !!(window.LevelExperienceRegistry && window.LevelExperienceRegistry[id])
        };
        try { Level.render(id); } catch (e) { out.renderErr = String(e && e.message || e); }
        await new Promise(r => setTimeout(r, 120));
        const panel = document.getElementById('r2-lev-exp');
        out.panel = !!panel;
        const html = panel ? panel.innerHTML : '';
        out.hasTask = html.indexOf('当前任务') >= 0;
        out.hasWhy = html.indexOf('为什么要做') >= 0;
        out.hasCriteria = html.indexOf('完成标准') >= 0;
        out.hasHeipeng = html.indexOf('小黑提示') >= 0;
        out.hasOpzone = html.indexOf('当前操作区') >= 0;
        if (id === 'w3_13') out.spec = ['阅读顺序', '变量变化', '分支/循环', '最终输出'].every(k => html.indexOf(k) >= 0);
        if (id === 'w4_4') out.spec = ['程序在哪运行', '环境包含什么', '为何环境不同'].every(k => html.indexOf(k) >= 0);
        if (id === 'w4_7') out.spec = ['看到的错误', '可能原因', '排查顺序', '修复动作', '修复后验证'].every(k => html.indexOf(k) >= 0);
        return out;
      }, id);
      rep.assert(r.inLD, `${id} 在 LevelData 中(未被 Round2 改动)`);
      rep.assert(r.inReg, `${id} 在 LevelExperienceRegistry 中`);
      rep.assert(r.panel, `${id} 渲染后注入体验面板 #r2-lev-exp`);
      rep.assert(r.hasTask && r.hasWhy && r.hasCriteria && r.hasHeipeng && r.hasOpzone,
        `${id} 面板含 当前任务/为什么要做/完成标准/小黑提示/当前操作区`);
      if (['w3_13', 'w4_4', 'w4_7'].indexOf(id) >= 0) rep.assert(r.spec, `${id} 专属高亮模块已呈现`);
    }

    // ═══ 完成反馈接入(wiring): ai_camp_1 调用 done() → 统一弹窗 ═══
    const comp = await page.evaluate(async () => {
      Level.render('ai_camp_1');
      await new Promise(r => setTimeout(r, 120));
      Level.done();
      await new Promise(r => setTimeout(r, 1700));
      const m = document.getElementById('r2-comp-modal');
      const active = !!(m && m.classList.contains('active'));
      const tier = m ? m.getAttribute('data-tier') : null;
      const title = document.getElementById('r2-comp-title').textContent;
      window.Completion.hide();
      return { active, tier, title };
    });
    rep.assert(comp.active, 'ai_camp_1 done() 触发统一完成弹窗');
    rep.assert(comp.tier === 'normal', `ai_camp_1 完成弹窗 tier=normal (${comp.tier})`);
    rep.assert(comp.title.indexOf('完成') >= 0, `ai_camp_1 完成弹窗标题正确 (${comp.title})`);

    // ═══ 门禁保留: w6_9 / w7_7 未完成验收 → done() 不弹出完成弹窗 ═══
    const gate = await page.evaluate(async () => {
      // --- w6_9 ---
      Level.render('w6_9');
      await new Promise(r => setTimeout(r, 150));
      if (typeof Sim !== 'undefined' && Sim) {
        if (!Sim.state) Sim.state = {};
        Sim.state.configStatus = 'draft';
        Sim.state.configSnapshot = '{}';
        if (typeof Sim.getConfig !== 'function') Sim.getConfig = function () { return {}; };
        if (typeof Sim.isCurrentRevisionPassed !== 'function') Sim.isCurrentRevisionPassed = function () { return false; };
        if (typeof Sim.clearDraft !== 'function') Sim.clearDraft = function () {};
      }
      window.Completion.hide();
      Level.done();
      await new Promise(r => setTimeout(r, 200));
      const w6active = !!(document.getElementById('r2-comp-modal') && document.getElementById('r2-comp-modal').classList.contains('active'));

      // --- w7_7 ---
      Level.render('w7_7');
      await new Promise(r => setTimeout(r, 150));
      if (typeof WfSim !== 'undefined' && WfSim) {
        if (!WfSim.state) WfSim.state = {};
        WfSim.state.configStatus = 'draft';
        WfSim.state.configSnapshot = '{}';
        if (typeof WfSim.getConfig !== 'function') WfSim.getConfig = function () { return {}; };
        if (typeof WfSim.isCurrentRevisionPassed !== 'function') WfSim.isCurrentRevisionPassed = function () { return false; };
        if (typeof WfSim.clearDraft !== 'function') WfSim.clearDraft = function () {};
      }
      window.Completion.hide();
      Level.done();
      await new Promise(r => setTimeout(r, 200));
      const w7active = !!(document.getElementById('r2-comp-modal') && document.getElementById('r2-comp-modal').classList.contains('active'));

      const html = document.documentElement.outerHTML;
      return {
        w6active, w7active,
        hasGate: html.indexOf("id==='w6_9'&&typeof Sim") >= 0,
        hasGate7: html.indexOf("id==='w7_7'") >= 0,
        keepGate: window.LevelExperienceRegistry.w6_9.keepGate === true && window.LevelExperienceRegistry.w7_7.keepGate === true
      };
    });
    rep.assert(!gate.w6active, 'w6_9 未通过验收时 done() 不弹出完成弹窗(门禁保留)');
    rep.assert(!gate.w7active, 'w7_7 未通过验收时 done() 不弹出完成弹窗(门禁保留)');
    rep.assert(gate.hasGate && gate.hasGate7, '原始 w6_9 / w7_7 门禁代码未被 Round2 改动');
    rep.assert(gate.keepGate, 'w6_9 / w7_7 keepGate 标记保留');

    // ═══ 不变性: 渲染代表关全程 0 错误 ═══
    rep.assert(st.pageErrors.length === 0, `渲染 7 代表关 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `渲染 7 代表关 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
