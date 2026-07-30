// tests/test_round3_engine_gate_submission.js — R1.2 Round3-R3 验收:
//   真实引擎提交门禁(Level.done 路径)全链路验证:
//     W6 三类缺失(undefined / null / stateNull) → 真实 Level.done 被阻断, 不抛错, completed=false
//     W7 三类缺失(undefined / null / stateNull) → 真实 Level.done 被阻断, 不抛错, completed=false
//     正常但未通过(门禁对象存在但 configStatus!=='submitted') → Level.done 后 completed=false
//     合法通过(W6/W7 真实条件全部满足) → Level.done 后 completed=true, 关卡未被锁死
//   一致性要求: gate.passed / submitAllowed / Level.done 真实完成结果 三者一致。
//   不修改 LevelData / 课程哈希 / Alpha2 / Round2-R2 交付件。
// 用法: node tests/test_round3_engine_gate_submission.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18948;
const REL3 = 'Agent新手村_R1.2-round3-dev.html';

(async () => {
  const rep = new TestReport('test_round3_engine_gate_submission');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(REL3)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    rep.assert(await page.evaluate(() =>
      typeof window.InteractionProgress === 'object' &&
      typeof window.Level !== 'undefined' && typeof window.Level.done === 'function'),
      'window.InteractionProgress 与 Level.done 全局可用');

    const results = await page.evaluate(() => {
      const IP = window.InteractionProgress;
      const out = [];

      function setupLevel(level) {
        if (!State.levels[level]) State.levels[level] = {};
        State.levels[level].completed = false;
        State.levels[level].stars = State.levels[level].stars || 0;
        State.levels[level].unlocked = true;
        Level._completing = false;
        Level.current = level;
        // 渲染关卡确保 level-content 存在(避免 ErrorFeedback 渲染诊断噪声)
        try { Level.render(level); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
      }

      function runCase(spec) {
        const origSim = window.Sim;
        const origWf = window.WfSim;
        let thrown = false;
        try {
          setupLevel(spec.level);

          if (spec.kind === 'missing') {
            // 六种门禁缺失之一
            if (spec.mode === 'undefined') window[spec.obj] = undefined;
            else if (spec.mode === 'null') window[spec.obj] = null;
            else window[spec.obj] = { state: null, isCurrentRevisionPassed: function () { return true; } };
          } else if (spec.kind === 'normalNotPassed') {
            // 门禁对象存在, 但未提交(configStatus!=='submitted')
            if (spec.obj === 'Sim') {
              window.Sim = { state: { configStatus: 'draft', configRevision: 0, configSnapshot: {}, passed: {}, failures: {}, builderValues: {}, finalPassedAt: null, totalRuns: {}, runs: {}, history: [] }, getConfig: function () { return (Level.builderState && Level.builderState['agent_builder'] && Level.builderState['agent_builder'].values) || {}; }, isCurrentRevisionPassed: function () { var s = this.state, r = s.configRevision; return s.passed.normal === r && s.passed['missing-info'] === r && s.passed['high-risk'] === r; }, commitConfig: function () {}, clearDraft: function () {}, saveDraft: function () {}, renderPanel: function () {} };
            } else {
              window.WfSim = { state: { configStatus: 'draft', configRevision: 0, configSnapshot: {}, passed: {}, failures: {}, builderValues: {}, finalPassedAt: null, sequencePassed: false, sequenceOrder: [], totalRuns: {}, runs: {}, history: [] }, getConfig: function () { return (Level.builderState && Level.builderState['workflow_builder'] && Level.builderState['workflow_builder'].values) || {}; }, isCurrentRevisionPassed: function () { var s = this.state, r = s.configRevision; return s.passed.normal === r && s.passed['high-amount'] === r && s.passed['tool-fail'] === r; }, commitConfig: function () {}, clearDraft: function () {}, saveDraft: function () {}, renderPanel: function () {} };
            }
          } else if (spec.kind === 'legit') {
            // 真实门禁条件全部满足
            if (spec.obj === 'Sim') {
              var cfg6 = { goal: ['g_read', 'g_out'], input: ['i_list', 'i_pri'], tools: ['t_read', 't_save'], stop: ['s_done'], fallback: ['f_ask'], accept: ['a_list'], riskRules: ['r_list', 'r_mark'], perm: ['p_conf'] };
              Level.builderState['agent_builder'] = { values: cfg6 };
              window.Sim = { state: { configStatus: 'submitted', configRevision: 1, configSnapshot: cfg6, passed: { normal: 1, 'missing-info': 1, 'high-risk': 1 }, failures: {}, builderValues: {}, finalPassedAt: null, totalRuns: {}, runs: {}, history: [] }, getConfig: function () { return (Level.builderState && Level.builderState['agent_builder'] && Level.builderState['agent_builder'].values) || {}; }, isCurrentRevisionPassed: function () { var s = this.state, r = s.configRevision; return s.passed.normal === r && s.passed['missing-info'] === r && s.passed['high-risk'] === r; }, commitConfig: function () {}, clearDraft: function () {}, saveDraft: function () {}, renderPanel: function () {} };
            } else {
              var cfg7 = { io: ['in_data', 'out_advice', 'out_log'], exec: ['e_script', 'e_ai', 'e_agent', 'e_human'], fail: ['f_retry', 'f_stop', 'f_log'], confirm: ['c_500'], accept: ['a_evi', 'a_check', 'a_noauto', 'a_log'] };
              Level.builderState['workflow_builder'] = { values: cfg7 };
              Level.interactionPassed = Level.interactionPassed || {};
              Level.interactionPassed.workflow_sequence = true;
              Level.interactionPassed.workflow_builder = true;
              window.WfSim = { state: { configStatus: 'submitted', configRevision: 1, configSnapshot: cfg7, passed: { normal: 1, 'high-amount': 1, 'tool-fail': 1 }, failures: {}, builderValues: {}, finalPassedAt: null, sequencePassed: true, sequenceOrder: [], totalRuns: {}, runs: {}, history: [] }, getConfig: function () { return (Level.builderState && Level.builderState['workflow_builder'] && Level.builderState['workflow_builder'].values) || {}; }, isCurrentRevisionPassed: function () { var s = this.state, r = s.configRevision; var ok = s.passed.normal === r && s.passed['high-amount'] === r && s.passed['tool-fail'] === r; if (ok && !s.finalPassedAt) s.finalPassedAt = Date.now(); return ok; }, commitConfig: function () {}, clearDraft: function () {}, saveDraft: function () {}, renderPanel: function () {} };
            }
          }

          window.Round3Diagnostics.clear();
          IP.reset(spec.level);
          try { Level.done(); } catch (e) { thrown = true; }

          const stt = IP.getState(spec.level);
          const g = stt ? stt.gate : null;
          out.push({
            name: spec.name,
            thrown,
            completed: State.levels[spec.level].completed,
            completing: Level._completing,
            gatePassed: g ? g.passed : null,
            gateStatus: g ? g.status : null,
            submitAllowed: stt ? stt.submitAllowed : null,
            errCount: window.Round3Diagnostics.errors.length,
          });
        } finally {
          window.Sim = origSim;
          window.WfSim = origWf;
        }
      }

      const cases = [
        { name: 'W6 Sim undefined', level: 'w6_9', obj: 'Sim', kind: 'missing', mode: 'undefined' },
        { name: 'W6 Sim null', level: 'w6_9', obj: 'Sim', kind: 'missing', mode: 'null' },
        { name: 'W6 Sim.state null', level: 'w6_9', obj: 'Sim', kind: 'missing', mode: 'stateNull' },
        { name: 'W7 WfSim undefined', level: 'w7_7', obj: 'WfSim', kind: 'missing', mode: 'undefined' },
        { name: 'W7 WfSim null', level: 'w7_7', obj: 'WfSim', kind: 'missing', mode: 'null' },
        { name: 'W7 WfSim.state null', level: 'w7_7', obj: 'WfSim', kind: 'missing', mode: 'stateNull' },
        { name: 'W6 正常未通过', level: 'w6_9', obj: 'Sim', kind: 'normalNotPassed' },
        { name: 'W6 合法通过', level: 'w6_9', obj: 'Sim', kind: 'legit' },
        { name: 'W7 合法通过', level: 'w7_7', obj: 'WfSim', kind: 'legit' },
      ];
      cases.forEach(runCase);
      return out;
    });

    // 让引擎完成流程里的 setTimeout(1400) 跑完, 暴露任何异步异常
    await new Promise(r => setTimeout(r, 1700));

    results.forEach(r => {
      if (r.name.indexOf('合法通过') >= 0) {
        rep.assert(r.completed === true, `${r.name}: Level.done 后 completed === true (${r.completed})`);
        rep.assert(r.gatePassed === true, `${r.name}: gate.passed === true(与 completed 一致) (${r.gatePassed})`);
        rep.assert(r.submitAllowed === true, `${r.name}: submitAllowed === true(与 completed 一致) (${r.submitAllowed})`);
        rep.assert(r.thrown === false, `${r.name}: Level.done 未抛异常 (thrown=${r.thrown})`);
      } else {
        rep.assert(r.thrown === false, `${r.name}: Level.done 未抛异常 (thrown=${r.thrown})`);
        rep.assert(r.completed === false, `${r.name}: Level.done 后 completed === false(门禁缺失/未通过被阻断) (${r.completed})`);
        rep.assert(r.completing === false, `${r.name}: Level._completing === false(未遗留提交锁) (${r.completing})`);
        rep.assert(r.gatePassed === false, `${r.name}: gate.passed === false (${r.gatePassed})`);
        rep.assert(r.submitAllowed === false, `${r.name}: submitAllowed === false (${r.submitAllowed})`);
        // 缺失状态(非"正常未通过")必须记录诊断且 status='error'
        if (r.name.indexOf('正常未通过') < 0) {
          rep.assert(r.gateStatus === 'error', `${r.name}: gate.status === 'error' (${r.gateStatus})`);
          rep.assert(r.errCount >= 1, `${r.name}: Round3Diagnostics 记录 >=1 (${r.errCount})`);
        } else {
          rep.assert(r.errCount >= 0, `${r.name}: 正常未通过不要求 error 级诊断(errCount=${r.errCount})`);
        }
      }
    });

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
