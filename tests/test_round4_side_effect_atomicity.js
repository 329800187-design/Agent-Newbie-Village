// tests/test_round4_side_effect_atomicity.js — R1.2 Round4-P0-R1 精准修复 (文件 3/4):
//   §三 所有完成侧作用移动到提交点之后: 阶段 B 回滚后侧作用绝不残留; 提交点之后
//   侧作用恰好执行一次(重复 Level.done 不再执行)。
//
//   覆盖:
//     A. 非门禁关(ai_camp_1) 阶段 B 回滚(before_save) → 无 level_complete 日志,
//        无 passed=true Artifact, completed=false, commitPointReached=false。
//     B. 非门禁关(ai_camp_1) 合法成功 → 恰好 1 条 level_complete 日志, Artifact.passed=true;
//        再次 Level.done(幂等) → 仍恰好 1 条(不重复执行), Artifact.passed 仍为 true。
//     C. W6(w6_9) 阶段 B 回滚(before_save, 合法 Sim 门禁 + 真实 clearDraft) →
//        草稿 agent_village_w6_sim_draft 不被清除(保留), 无 level_complete, 无 passed Artifact。
//     D. W6(w6_9) 合法成功 → 提交点之后草稿被清除(getItem===null), completed=true,
//        level_complete 日志存在, Artifact.passed=true。
//
// 用法: node tests/test_round4_side_effect_atomicity.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18968;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';
const W6 = 'w6_9';

const W6_DRAFT_KEY = 'agent_village_w6_sim_draft';

(async () => {
  const rep = new TestReport('test_round4_side_effect_atomicity');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const out = await page.evaluate(({ LEVEL, W6, W6_DRAFT_KEY }) => {
      const CT = window.CompletionTransaction;
      const F = window.CompletionTransactionFaults;
      const results = {};

      function countLevelComplete(levelId) {
        let logs = [];
        try { logs = JSON.parse(localStorage.getItem('agent_village_learning_log') || '[]'); } catch (e) {}
        return logs.filter(function (e) { return e.eventName === 'level_complete' && e.levelId === levelId; }).length;
      }
      function artifactPassed(levelId) {
        let store = {};
        try { store = JSON.parse(localStorage.getItem('agent_village_artifacts') || '{}'); } catch (e) {}
        const art = store && store.artifacts ? store.artifacts[levelId] : null;
        return !!(art && art.passed);
      }
      function clearSideEffectStores() {
        localStorage.removeItem('agent_village_learning_log');
        localStorage.removeItem('agent_village_artifacts');
        localStorage.removeItem(W6_DRAFT_KEY);
      }

      function setupNormal(level) {
        F.clearAll(); CT.reset(); CT.clearSubmissionBlockForTest(level);
        clearSideEffectStores();
        if (!State.levels[level]) State.levels[level] = {};
        State.levels[level].completed = false;
        State.levels[level].stars = 0;
        State.levels[level].unlocked = true;
        if (typeof _refreshUnlockedFlags === 'function') _refreshUnlockedFlags();
        State.currentLevel = level;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        Level.current = level; Level.hintN = 0; Level._completing = false;
        try { Level.render(level); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {}
      }

      // A. 非门禁关 阶段 B 回滚
      setupNormal(LEVEL);
      F.arm('before_save');
      let tA = false; let retA;
      try { retA = Level.done(); } catch (e) { tA = true; }
      const csA = CT.getState(LEVEL);
      results.A = {
        thrown: tA,
        ret: retA === false ? 'false' : (retA === true ? 'true' : String(retA)),
        completed: State.levels[LEVEL].completed,
        commitPointReached: csA ? csA.commitPointReached : null,
        status: csA ? csA.status : null,
        levelCompleteCount: countLevelComplete(LEVEL),
        artifactPassed: artifactPassed(LEVEL),
        completing: Level._completing
      };
      F.clearAll(); CT.reset();

      // B. 非门禁关 合法成功 + 幂等重复
      setupNormal(LEVEL);
      let tB = false; let retB;
      try { retB = Level.done(); } catch (e) { tB = true; }
      const csB = CT.getState(LEVEL);
      const lcAfterFirst = countLevelComplete(LEVEL);
      const artAfterFirst = artifactPassed(LEVEL);
      // 幂等重复调用
      let tB2 = false; let retB2;
      try { retB2 = Level.done(); } catch (e) { tB2 = true; }
      const lcAfterSecond = countLevelComplete(LEVEL);
      results.B = {
        thrown: tB,
        ret: retB === false ? 'false' : (retB === true ? 'true' : String(retB)),
        completed: State.levels[LEVEL].completed,
        commitPointReached: csB ? csB.commitPointReached : null,
        status: csB ? csB.status : null,
        lcAfterFirst: lcAfterFirst,
        artAfterFirst: artAfterFirst,
        secondRet: retB2 === false ? 'false' : (retB2 === true ? 'true' : String(retB2)),
        lcAfterSecond: lcAfterSecond,
        artAfterSecond: artifactPassed(LEVEL),
        completing: Level._completing
      };
      F.clearAll(); CT.reset();

      // ── W6 合法 Sim 门禁 stub(镜像 test_round3_engine_gate_submission 的 legit) ──
      function buildLegitSim() {
        const cfg6 = { goal: ['g_read', 'g_out'], input: ['i_list', 'i_pri'], tools: ['t_read', 't_save'], stop: ['s_done'], fallback: ['f_ask'], accept: ['a_list'], riskRules: ['r_list', 'r_mark'], perm: ['p_conf'] };
        Level.builderState['agent_builder'] = { values: cfg6 };
        return {
          state: { configStatus: 'submitted', configRevision: 1, configSnapshot: cfg6, passed: { normal: 1, 'missing-info': 1, 'high-risk': 1 }, failures: {}, builderValues: {}, finalPassedAt: null, totalRuns: {}, runs: {}, history: [] },
          getConfig: function () { return (Level.builderState && Level.builderState['agent_builder'] && Level.builderState['agent_builder'].values) || {}; },
          isCurrentRevisionPassed: function () { var s = this.state, r = s.configRevision; return s.passed.normal === r && s.passed['missing-info'] === r && s.passed['high-risk'] === r; },
          commitConfig: function () {},
          clearDraft: function () { try { localStorage.removeItem(W6_DRAFT_KEY); } catch (e) {} },
          saveDraft: function () {}, renderPanel: function () {}
        };
      }

      const origSim = window.Sim;
      try {
        // C. W6 阶段 B 回滚(草稿应保留)
        setupNormal(W6);
        window.Sim = buildLegitSim();
        localStorage.setItem(W6_DRAFT_KEY, JSON.stringify({ placeholder: 'draft-should-survive' }));
        F.arm('before_save');
        let tC = false; let retC;
        try { retC = Level.done(); } catch (e) { tC = true; }
        const csC = CT.getState(W6);
        let draftC = null;
        try { draftC = localStorage.getItem(W6_DRAFT_KEY); } catch (e) {}
        results.C = {
          thrown: tC,
          ret: retC === false ? 'false' : (retC === true ? 'true' : String(retC)),
          completed: State.levels[W6].completed,
          commitPointReached: csC ? csC.commitPointReached : null,
          status: csC ? csC.status : null,
          draftKept: draftC !== null,
          levelCompleteCount: countLevelComplete(W6),
          artifactPassed: artifactPassed(W6),
          completing: Level._completing
        };
        F.clearAll(); CT.reset();

        // D. W6 合法成功(草稿应被清除)
        setupNormal(W6);
        window.Sim = buildLegitSim();
        localStorage.setItem(W6_DRAFT_KEY, JSON.stringify({ placeholder: 'draft-should-be-cleared' }));
        let tD = false; let retD;
        try { retD = Level.done(); } catch (e) { tD = true; }
        const csD = CT.getState(W6);
        let draftD = null;
        try { draftD = localStorage.getItem(W6_DRAFT_KEY); } catch (e) {}
        results.D = {
          thrown: tD,
          ret: retD === false ? 'false' : (retD === true ? 'true' : String(retD)),
          completed: State.levels[W6].completed,
          commitPointReached: csD ? csD.commitPointReached : null,
          status: csD ? csD.status : null,
          draftCleared: draftD === null,
          levelCompleteCount: countLevelComplete(W6),
          artifactPassed: artifactPassed(W6),
          completing: Level._completing
        };
      } finally {
        window.Sim = origSim;
      }
      F.clearAll(); CT.reset();

      return results;
    }, { LEVEL, W6, W6_DRAFT_KEY });

    // 等待 1400ms 展示阶段跑完, 暴露任何异步异常
    await new Promise(r => setTimeout(r, 1700));

    // A. 回滚无侧作用
    rep.assert(out.A.thrown === false, `A. 回滚未抛异常 (${out.A.thrown})`);
    rep.assert(out.A.ret === 'false', `A. 回滚返回 false (${out.A.ret})`);
    rep.assert(out.A.completed === false, `A. 回滚后 completed === false (${out.A.completed})`);
    rep.assert(out.A.commitPointReached === false, `A. commitPointReached === false (${out.A.commitPointReached})`);
    rep.assert(out.A.status === 'rolled_back', `A. status === 'rolled_back' (${out.A.status})`);
    rep.assert(out.A.levelCompleteCount === 0, `A. 回滚后无 level_complete 日志 (${out.A.levelCompleteCount})`);
    rep.assert(out.A.artifactPassed === false, `A. 回滚后无 passed=true Artifact (${out.A.artifactPassed})`);
    rep.assert(out.A.completing === false, `A. 提交锁已恢复 (${out.A.completing})`);

    // B. 成功恰好一次 + 幂等
    rep.assert(out.B.thrown === false, `B. 成功未抛异常 (${out.B.thrown})`);
    rep.assert(out.B.ret === 'true', `B. 成功返回 true (${out.B.ret})`);
    rep.assert(out.B.completed === true, `B. 成功后 completed === true (${out.B.completed})`);
    rep.assert(out.B.commitPointReached === true, `B. commitPointReached === true (${out.B.commitPointReached})`);
    rep.assert(out.B.lcAfterFirst === 1, `B. 成功后恰好 1 条 level_complete 日志 (${out.B.lcAfterFirst})`);
    rep.assert(out.B.artAfterFirst === true, `B. 成功后 Artifact.passed === true (${out.B.artAfterFirst})`);
    rep.assert(out.B.secondRet === 'true', `B. 幂等重复返回 true (${out.B.secondRet})`);
    rep.assert(out.B.lcAfterSecond === 1, `B. 幂等重复后仍恰好 1 条(未重复执行) (${out.B.lcAfterSecond})`);
    rep.assert(out.B.artAfterSecond === true, `B. 幂等重复后 Artifact.passed 仍为 true (${out.B.artAfterSecond})`);
    rep.assert(out.B.completing === false, `B. 提交锁已恢复 (${out.B.completing})`);

    // C. W6 回滚草稿保留
    rep.assert(out.C.thrown === false, `C. W6 回滚未抛异常 (${out.C.thrown})`);
    rep.assert(out.C.ret === 'false', `C. W6 回滚返回 false (${out.C.ret})`);
    rep.assert(out.C.completed === false, `C. W6 回滚后 completed === false (${out.C.completed})`);
    rep.assert(out.C.commitPointReached === false, `C. W6 commitPointReached === false (${out.C.commitPointReached})`);
    rep.assert(out.C.status === 'rolled_back', `C. W6 status === 'rolled_back' (${out.C.status})`);
    rep.assert(out.C.draftKept === true, `C. W6 回滚后草稿保留未被清除 (${out.C.draftKept})`);
    rep.assert(out.C.levelCompleteCount === 0, `C. W6 回滚后无 level_complete 日志 (${out.C.levelCompleteCount})`);
    rep.assert(out.C.artifactPassed === false, `C. W6 回滚后无 passed Artifact (${out.C.artifactPassed})`);
    rep.assert(out.C.completing === false, `C. W6 提交锁已恢复 (${out.C.completing})`);

    // D. W6 成功草稿清除
    rep.assert(out.D.thrown === false, `D. W6 成功未抛异常 (${out.D.thrown})`);
    rep.assert(out.D.ret === 'true', `D. W6 成功返回 true (${out.D.ret})`);
    rep.assert(out.D.completed === true, `D. W6 成功后 completed === true (${out.D.completed})`);
    rep.assert(out.D.commitPointReached === true, `D. W6 commitPointReached === true (${out.D.commitPointReached})`);
    rep.assert(out.D.draftCleared === true, `D. W6 成功后草稿被清除(提交点之后执行) (${out.D.draftCleared})`);
    rep.assert(out.D.levelCompleteCount === 1, `D. W6 成功后 1 条 level_complete 日志 (${out.D.levelCompleteCount})`);
    rep.assert(out.D.artifactPassed === true, `D. W6 成功后 Artifact.passed === true (${out.D.artifactPassed})`);
    rep.assert(out.D.completing === false, `D. W6 提交锁已恢复 (${out.D.completing})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
