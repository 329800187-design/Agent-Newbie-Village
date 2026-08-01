// tests/test_round4_snapshot_failure.js — R1.2 Round4-P0-R1 精准修复 (文件 4/4):
//   §四 快照阶段统一捕获: 事务开始 → 提交前的快照/故障注入阶段失败必须被统一捕获,
//   不得向调用方抛异常, 进入明确终态(preflight_failed), 且不得残留 phase=validating/idle。
//
//   覆盖:
//     A. before_snapshot 注入抛错 → 捕获 → abortBeforeMutation → Level.done 返回 false;
//        completed=false; _completing=false; commitPointReached=false;
//        status='preflight_failed'; phase 非 validating/idle(终态明确); 诊断已记录。
//     B. 快照阶段 localStorage 读取异常(覆盖式注入 getItem 抛错) → 不得逃逸到调用方;
//        Level.done 返回 false; 同上明确终态; 诊断已记录。
//
// 用法: node tests/test_round4_snapshot_failure.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18969;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';

(async () => {
  const rep = new TestReport('test_round4_snapshot_failure');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const results = await page.evaluate((LEVEL) => {
      const CT = window.CompletionTransaction;
      const F = window.CompletionTransactionFaults;
      const out = {};

      function setup() {
        F.clearAll(); CT.reset();
        if (window.Round3Diagnostics && window.Round3Diagnostics.clear) window.Round3Diagnostics.clear();
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        State.levels[LEVEL].completed = false;
        State.levels[LEVEL].stars = 0;
        State.levels[LEVEL].unlocked = true;
        State.currentLevel = LEVEL;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        Level.current = LEVEL; Level.hintN = 0; Level._completing = false;
        try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {}
      }

      // A. before_snapshot 抛错
      setup();
      F.arm('before_snapshot');
      let tA = false; let retA;
      try { retA = Level.done(); } catch (e) { tA = true; }
      const csA = CT.getState(LEVEL);
      const diagA = (window.Round3Diagnostics && window.Round3Diagnostics.errors) ? window.Round3Diagnostics.errors.length : 0;
      out.A = {
        thrown: tA,
        ret: retA === false ? 'false' : (retA === true ? 'true' : String(retA)),
        completed: State.levels[LEVEL].completed,
        commitPointReached: csA ? csA.commitPointReached : null,
        status: csA ? csA.status : null,
        phase: csA ? csA.phase : null,
        completing: Level._completing,
        diagCount: diagA
      };
      F.clearAll(); CT.reset();

      // B. 快照 localStorage 读取异常
      setup();
      const origGet = window.localStorage.getItem.bind(window.localStorage);
      window.localStorage.getItem = function (k) {
        if (k === 'agent_village_d') throw new Error('injected localStorage read failure');
        return origGet(k);
      };
      let tB = false; let retB;
      try { retB = Level.done(); } catch (e) { tB = true; }
      const csB = CT.getState(LEVEL);
      const diagB = (window.Round3Diagnostics && window.Round3Diagnostics.errors) ? window.Round3Diagnostics.errors.length : 0;
      // 还原 getItem, 避免影响后续
      window.localStorage.getItem = origGet;
      out.B = {
        thrown: tB,
        ret: retB === false ? 'false' : (retB === true ? 'true' : String(retB)),
        completed: State.levels[LEVEL].completed,
        commitPointReached: csB ? csB.commitPointReached : null,
        status: csB ? csB.status : null,
        phase: csB ? csB.phase : null,
        completing: Level._completing,
        diagCount: diagB
      };
      F.clearAll(); CT.reset();

      return out;
    }, LEVEL);

    // A. before_snapshot
    rep.assert(results.A.thrown === false, `A. before_snapshot 异常未逃逸到调用方 (thrown=${results.A.thrown})`);
    rep.assert(results.A.ret === 'false', `A. Level.done 返回 false (${results.A.ret})`);
    rep.assert(results.A.completed === false, `A. completed 保持 false (${results.A.completed})`);
    rep.assert(results.A.commitPointReached === false, `A. commitPointReached === false (${results.A.commitPointReached})`);
    rep.assert(results.A.status === 'preflight_failed', `A. status === 'preflight_failed'(明确终态) (${results.A.status})`);
    rep.assert(results.A.phase !== 'validating' && results.A.phase !== 'idle', `A. phase 非 validating/idle(=${results.A.phase})`);
    rep.assert(results.A.completing === false, `A. 提交锁已恢复 (${results.A.completing})`);
    rep.assert(results.A.diagCount >= 1, `A. 诊断已记录 (${results.A.diagCount})`);

    // B. 快照读取异常
    rep.assert(results.B.thrown === false, `B. 快照读取异常未逃逸到调用方 (thrown=${results.B.thrown})`);
    rep.assert(results.B.ret === 'false', `B. Level.done 返回 false (${results.B.ret})`);
    rep.assert(results.B.completed === false, `B. completed 保持 false (${results.B.completed})`);
    rep.assert(results.B.commitPointReached === false, `B. commitPointReached === false (${results.B.commitPointReached})`);
    rep.assert(results.B.status === 'preflight_failed', `B. status === 'preflight_failed'(明确终态) (${results.B.status})`);
    rep.assert(results.B.phase !== 'validating' && results.B.phase !== 'idle', `B. phase 非 validating/idle(=${results.B.phase})`);
    rep.assert(results.B.completing === false, `B. 提交锁已恢复 (${results.B.completing})`);
    rep.assert(results.B.diagCount >= 1, `B. 诊断已记录 (${results.B.diagCount})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
