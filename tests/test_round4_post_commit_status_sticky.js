// tests/test_round4_post_commit_status_sticky.js — R1.2 Round4-P0-R2 精准修复 (文件 1/4):
//   §一 post_commit_error 必须是粘性终态: 阶段 C (提交点之后) 任一完成侧作用抛错 →
//   不回滚已提交事务, 标记 post_commit_error, 且该状态不得被 finish() 或展示回调覆盖。
//
//   覆盖 4 个 safePostCommit 作用域(每个独立抛错, 验证其它相互独立动作继续执行):
//     A. clearDraft   (W6 / Sim.clearDraft 抛错)
//     B. learningLog  (LearningLog.log 抛错)
//     C. artifact     (Artifact.saveLevel 抛错)
//     D. starBurst    (Game.starBurst 抛错)
//
//   每个用例断言(分两次 evaluate, 中间等待 >=1900ms 验证粘性):
//     completed === true; commitPointReached === true;
//     立即 status === 'post_commit_error' 且 phase === 'post_commit_error';
//     其它独立侧作用继续执行(其余 scope 的副作用已落地: learning_log / artifact / starBurst 计数);
//     Level._completing === false;
//     等待 >=1900ms 后 status 仍为 'post_commit_error'(粘性终态不被覆盖);
//     CompletionTransaction.finish(id) 返回 true 且不得把 status 改成 'committed';
//     diagnostics 含具体作用域 (CompletionTransaction.post_commit.<scope>)。
//
// 用法: node tests/test_round4_post_commit_status_sticky.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18971;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';
const W6 = 'w6_9';
const W6_DRAFT_KEY = 'agent_village_w6_sim_draft';

// 每个用例: { key, level, scope, victim: (level)=>()=>void 还原覆写 }
const CASES = [
  {
    key: 'A.clearDraft', level: W6, scope: 'clearDraft',
    victim: function () {
      const origSim = window.Sim;
      const cfg6 = { goal: ['g_read', 'g_out'], input: ['i_list', 'i_pri'], tools: ['t_read', 't_save'], stop: ['s_done'], fallback: ['f_ask'], accept: ['a_list'], riskRules: ['r_list', 'r_mark'], perm: ['p_conf'] };
      Level.builderState['agent_builder'] = { values: cfg6 };
      const sim = {
        state: { configStatus: 'submitted', configRevision: 1, configSnapshot: cfg6, passed: { normal: 1, 'missing-info': 1, 'high-risk': 1 }, failures: {}, builderValues: {}, finalPassedAt: null, totalRuns: {}, runs: {}, history: [] },
        getConfig: function () { return (Level.builderState && Level.builderState['agent_builder'] && Level.builderState['agent_builder'].values) || {}; },
        isCurrentRevisionPassed: function () { var s = this.state, r = s.configRevision; return s.passed.normal === r && s.passed['missing-info'] === r && s.passed['high-risk'] === r; },
        commitConfig: function () {},
        clearDraft: function () { throw new Error('injected clearDraft'); },
        saveDraft: function () {}, renderPanel: function () {}
      };
      window.Sim = sim;
      return function () { window.Sim = origSim; };
    }
  },
  {
    key: 'B.learningLog', level: LEVEL, scope: 'learningLog',
    victim: function () {
      const orig = (typeof LearningLog !== 'undefined' && LearningLog) ? LearningLog.log : undefined;
      if (typeof LearningLog !== 'undefined' && LearningLog) LearningLog.log = function () { throw new Error('injected learningLog'); };
      return function () { if (typeof LearningLog !== 'undefined' && LearningLog) LearningLog.log = orig; };
    }
  },
  {
    key: 'C.artifact', level: LEVEL, scope: 'artifact',
    victim: function () {
      const orig = (typeof Artifact !== 'undefined' && Artifact) ? Artifact.saveLevel : undefined;
      if (typeof Artifact !== 'undefined' && Artifact) Artifact.saveLevel = function () { throw new Error('injected artifact'); };
      return function () { if (typeof Artifact !== 'undefined' && Artifact) Artifact.saveLevel = orig; };
    }
  },
  {
    key: 'D.starBurst', level: LEVEL, scope: 'starBurst',
    victim: function () {
      const orig = (typeof Game !== 'undefined' && Game) ? Game.starBurst : undefined;
      if (typeof Game !== 'undefined' && Game) Game.starBurst = function () { throw new Error('injected starBurst'); };
      return function () { if (typeof Game !== 'undefined' && Game) Game.starBurst = orig; };
    }
  }
];

(async () => {
  const rep = new TestReport('test_round4_post_commit_status_sticky');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    for (const c of CASES) {
      // 1) 设置 + 注入故障 + 运行 + 立即捕获(不 reset, 使状态可跨等待观察)
      const imm = await page.evaluate(({ level, scope, victimSrc, W6_DRAFT_KEY }) => {
        const CT = window.CompletionTransaction;
        const F = window.CompletionTransactionFaults;
        const R3D = window.Round3Diagnostics;
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
        F.clearAll(); CT.reset();
        if (R3D && R3D.clear) R3D.clear();
        clearSideEffectStores();
        if (!State.levels[level]) State.levels[level] = {};
        State.levels[level].completed = false;
        State.levels[level].stars = 0;
        State.levels[level].unlocked = true;
        State.currentLevel = level;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        Level.current = level; Level.hintN = 0; Level._completing = false;
        try { Level.render(level); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {}

        let starBurstCalls = 0;
        const origStarBurst = (typeof Game !== 'undefined' && Game) ? Game.starBurst : undefined;
        if (typeof Game !== 'undefined' && Game) Game.starBurst = function () { starBurstCalls++; };

        // 应用受害覆写
        const restore = (new Function('level', 'W6_DRAFT_KEY', 'return (' + victimSrc + ')(level, W6_DRAFT_KEY);'))(level, W6_DRAFT_KEY);

        let thrown = false;
        try { Level.done(); } catch (e) { thrown = true; }
        const cs = CT.getState(level);
        const diagHit = (R3D && R3D.errors)
          ? R3D.errors.some(function (e) { return (e.scope || '').indexOf('CompletionTransaction.post_commit.' + scope) >= 0; })
          : false;
        // 还原覆写(故障已发生, 不影响已标记状态)
        restore();
        if (typeof Game !== 'undefined' && Game) Game.starBurst = origStarBurst;

        return {
          scope, level,
          thrown: thrown,
          completed: State.levels[level].completed,
          commitPointReached: cs ? cs.commitPointReached : null,
          status: cs ? cs.status : null,
          phase: cs ? cs.phase : null,
          starBurstCalls: starBurstCalls,
          learningLogCount: countLevelComplete(level),
          artifactPassed: artifactPassed(level),
          completing: Level._completing,
          diagHit: diagHit
        };
      }, { level: c.level, scope: c.scope, victimSrc: c.victim.toString(), W6_DRAFT_KEY });

      // 2) 等待 >=1900ms 暴露任何异步覆盖尝试(状态保留, 不 reset)
      await new Promise(r => setTimeout(r, 1950));

      // 3) 最终读取 + finish() + 清理
      const fin = await page.evaluate((level) => {
        const CT = window.CompletionTransaction;
        const cs = CT.getState(level);
        const preStatus = cs ? cs.status : null;
        const prePhase = cs ? cs.phase : null;
        const ret = CT.finish(level);
        const cs2 = CT.getState(level);
        CT.reset();
        return { preStatus, prePhase, finishRet: ret, finishStatus: cs2 ? cs2.status : null };
      }, c.level);

      rep.assert(imm.thrown === false, `${c.key}: Level.done 未向调用方抛异常 (${imm.thrown})`);
      rep.assert(imm.completed === true, `${c.key}: 已提交事务保持 completed === true (${imm.completed})`);
      rep.assert(imm.commitPointReached === true, `${c.key}: commitPointReached === true (${imm.commitPointReached})`);
      rep.assert(imm.status === 'post_commit_error', `${c.key}: 立即 status === 'post_commit_error' (${imm.status})`);
      rep.assert(imm.phase === 'post_commit_error', `${c.key}: 立即 phase === 'post_commit_error' (${imm.phase})`);
      if (c.scope === 'clearDraft') {
        rep.assert(imm.learningLogCount === 1, `${c.key}: 其它动作 learningLog 继续执行 (${imm.learningLogCount})`);
        rep.assert(imm.artifactPassed === true, `${c.key}: 其它动作 artifact 继续执行 (passed=${imm.artifactPassed})`);
      } else if (c.scope === 'learningLog') {
        rep.assert(imm.artifactPassed === true, `${c.key}: 其它动作 artifact 继续执行 (passed=${imm.artifactPassed})`);
      }
      if (c.scope !== 'starBurst') {
        rep.assert(imm.starBurstCalls >= 1, `${c.key}: 其它动作 starBurst 继续执行 (${imm.starBurstCalls})`);
      }
      rep.assert(imm.completing === false, `${c.key}: 提交锁已恢复 (${imm.completing})`);
      rep.assert(imm.diagHit === true, `${c.key}: diagnostics 含作用域 post_commit.${c.scope} (${imm.diagHit})`);

      rep.assert(fin.preStatus === 'post_commit_error', `${c.key}: 等待1950ms后 status 仍为 post_commit_error (${fin.preStatus})`);
      rep.assert(fin.prePhase === 'post_commit_error', `${c.key}: 等待1950ms后 phase 仍为 post_commit_error (${fin.prePhase})`);
      rep.assert(fin.finishRet === true, `${c.key}: finish() 返回 true(已提交) (${fin.finishRet})`);
      rep.assert(fin.finishStatus === 'post_commit_error', `${c.key}: finish() 后仍为 post_commit_error(未被覆盖为 committed) (${fin.finishStatus})`);
    }

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
