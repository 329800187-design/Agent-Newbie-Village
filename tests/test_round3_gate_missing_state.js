// tests/test_round3_gate_missing_state.js — R1.2 Round3-R2 验收:
//   独立验证 W6/W7 门禁"对象或状态缺失"六种情形均 fail-closed:
//     1. Sim undefined   2. Sim = null   3. Sim.state = null
//     4. WfSim undefined 5. WfSim = null 6. WfSim.state = null
//   每种必须:
//     gate.passed === false / gate.status === 'error' / submitAllowed === false
//     标签含 'W6' 或 'W7' 且不含 '无门禁'
//     Round3Diagnostics.errors.length >= 1
//   测试结束后恢复原对象(避免污染后续测试 / 同文件内后续用例)。
//   不修改 LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件。
// 用法: node tests/test_round3_gate_missing_state.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18946;
const REL3 = 'Agent新手村_R1.2-round3-dev.html';

(async () => {
  const rep = new TestReport('test_round3_gate_missing_state');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL3)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    rep.assert(await page.evaluate(() => typeof window.Round3Diagnostics === 'object'),
      'window.Round3Diagnostics 全局对象存在');
    rep.assert(await page.evaluate(() => typeof window.InteractionProgress === 'object'),
      'window.InteractionProgress 全局对象存在');

    // ═══ 六种门禁缺失情形 ═══
    const cases = await page.evaluate(() => {
      const IP = window.InteractionProgress;
      const out = [];

      // 每种情形的设定方式: kind=全局名, mode=缺失模式
      const plan = [
        { level: 'w6_9', kind: 'Sim', mode: 'undefined' },
        { level: 'w6_9', kind: 'Sim', mode: 'null' },
        { level: 'w6_9', kind: 'Sim', mode: 'stateNull' },
        { level: 'w7_7', kind: 'WfSim', mode: 'undefined' },
        { level: 'w7_7', kind: 'WfSim', mode: 'null' },
        { level: 'w7_7', kind: 'WfSim', mode: 'stateNull' },
      ];

      plan.forEach((c, idx) => {
        const orig = window[c.kind]; // 保存原对象以便还原
        try {
          if (c.mode === 'undefined') {
            window[c.kind] = undefined;
          } else if (c.mode === 'null') {
            window[c.kind] = null;
          } else { // stateNull
            window[c.kind] = { state: null, isCurrentRevisionPassed: function () { return true; } };
          }

          window.Round3Diagnostics.clear();
          IP.reset(c.level);
          // 直接经 ensure → readGate 触发门禁缺失分支(fail-closed, 不经引擎 Level.render)
          IP.ensure(c.level, window.LevelExperienceRegistry[c.level].interactionSteps);
          // 即便步骤全部完成, 门禁缺失也必须阻止提交
          window.LevelExperienceRegistry[c.level].interactionSteps.forEach(s => IP.complete(c.level, s.id));
          const g = IP.getState(c.level).gate;
          const submitAllowed = IP.getState(c.level).submitAllowed;
          const errs = window.Round3Diagnostics.errors;
          out.push({
            idx,
            level: c.level,
            mode: c.mode,
            passed: g ? g.passed : null,
            status: g ? g.status : null,
            label: g ? g.label : '',
            submitAllowed: submitAllowed,
            errCount: errs.length,
            hasScope: errs.length > 0 && typeof errs[0].scope === 'string' && errs[0].scope.indexOf('readGate') === 0,
          });
        } finally {
          window[c.kind] = orig; // 还原, 避免污染后续用例
        }
      });
      return out;
    });

    // 断言六种情况
    const expect = [
      { level: 'w6_9', mode: 'undefined' },
      { level: 'w6_9', mode: 'null' },
      { level: 'w6_9', mode: 'stateNull' },
      { level: 'w7_7', mode: 'undefined' },
      { level: 'w7_7', mode: 'null' },
      { level: 'w7_7', mode: 'stateNull' },
    ];
    cases.forEach((r, i) => {
      const tag = `情形#${i + 1} (${r.level}/${r.mode})`;
      rep.assert(r.passed === false, `${tag}: gate.passed === false (${r.passed})`);
      rep.assert(r.status === 'error', `${tag}: gate.status === 'error' (${r.status})`);
      rep.assert(r.submitAllowed === false, `${tag}: submitAllowed === false (${r.submitAllowed})`);
      rep.assert((r.label.indexOf('W6') >= 0 || r.label.indexOf('W7') >= 0), `${tag}: 标签含 W6/W7 (${r.label})`);
      rep.assert(r.label.indexOf('无门禁') < 0, `${tag}: 标签不含"无门禁" (${r.label})`);
      rep.assert(r.errCount >= 1, `${tag}: Round3Diagnostics 记录 >=1 (${r.errCount})`);
      rep.assert(r.hasScope, `${tag}: 诊断 scope 以 readGate 开头`);
    });

    // ═══ 还原校验: 原对象恢复后, 正常读取不应再报错(门禁对象存在) ═══
    const restored = await page.evaluate(() => {
      const IP = window.InteractionProgress;
      window.Round3Diagnostics.clear();
      IP.reset('w6_9');
      try {
        if (typeof Sim !== 'undefined' && Sim) {
          Sim.state = { configStatus: 'draft', configRevision: 0, passed: {}, configSnapshot: {}, failures: {} };
        }
      } catch (e) {}
      IP.ensure('w6_9', window.LevelExperienceRegistry['w6_9'].interactionSteps);
      const g = IP.getState('w6_9').gate;
      return { label: g.label, passed: g.passed, errs: window.Round3Diagnostics.errors.length };
    });
    rep.assert(restored.label.indexOf('W6') >= 0, `还原后 W6 门禁标签正常 (${restored.label})`);
    rep.assert(restored.errs === 0, `还原后正常读取不再记录诊断 (${restored.errs})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
