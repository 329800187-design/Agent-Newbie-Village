// tests/test_round4_derived_unlock_verification.js — R1.2 Round4-P0-R3 精准修复 (文件 1/4):
//   §二/§三 派生解锁状态必须经过结果验证: 快照必须记录全量派生 unlocked 基线;
//   回滚时 _refreshUnlockedFlags 之后必须与快照深比较, 一致才能 derivedStateRefreshed=true。
//
//   覆盖(§九.1): 派生静默失败
//     LEVEL = w1_3, NEXT = w1_4, OPTIONAL = w1_p1
//     提交前 w1_p1.unlocked = false
//     完成后 w1_p1.unlocked = true(派生状态被错误变更)
//     回滚时 _refreshUnlockedFlags 静默 no-op(不重算)
//     必须断言:
//       w1_p1.unlocked 仍为 true(派生未被恢复)
//       derivedStateRefreshed === false
//       success === false
//       status === 'rollback_failed'(不得误报 rolled_back)
//       rollbackVerification 派生哈希不一致(derivedExpectedHash !== derivedActualHash)
//       derivedMismatchedLevelIds 包含 w1_p1
//
// 用法: node tests/test_round4_derived_unlock_verification.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18981;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'w1_3';
const NEXT = 'w1_4';
const OPTIONAL = 'w1_p1';
const SAVE_KEY = 'agent_village_d';

(async () => {
  const rep = new TestReport('test_round4_derived_unlock_verification');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const out = await page.evaluate(({ LEVEL, NEXT, OPTIONAL, SAVE_KEY }) => {
      const CT = window.CompletionTransaction;
      const R3D = window.Round3Diagnostics;
      const origRefresh = window._refreshUnlockedFlags;
      const results = {};

      function baseSetup() {
        CT.reset();
        CT.clearSubmissionBlockForTest(LEVEL);
        if (R3D && R3D.clear) R3D.clear();
        localStorage.removeItem(SAVE_KEY);
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        if (!State.levels[NEXT]) State.levels[NEXT] = {};
        if (!State.levels[OPTIONAL]) State.levels[OPTIONAL] = {};
        State.levels[LEVEL].completed = false; State.levels[LEVEL].stars = 0; State.levels[LEVEL].unlocked = true;
        State.levels[NEXT].completed = false; State.levels[NEXT].stars = 0; State.levels[NEXT].unlocked = false;
        State.levels[OPTIONAL].completed = false; State.levels[OPTIONAL].stars = 0; State.levels[OPTIONAL].unlocked = false;
        State.currentLevel = LEVEL;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        if (window._refreshUnlockedFlags) window._refreshUnlockedFlags = origRefresh;
        try { State.save(); } catch (e) {}
      }

      baseSetup();
      CT.begin(LEVEL);
      CT.snapshot(LEVEL);

      // 模拟提交阶段 B 的权威写入(与快照不一致) + 派生解锁被错误变更
      State.levels[LEVEL].completed = true; State.levels[LEVEL].stars = 3;
      State.xp = 100; State.totalStars = 3; State.achievements = ['w1_3_complete'];
      State.levels[NEXT].completed = true; State.levels[NEXT].unlocked = true;
      State.currentLevel = NEXT;
      State.levels[OPTIONAL].unlocked = true; // 派生状态被错误变更(提交前为 false)

      // 回滚时 _refreshUnlockedFlags 静默 no-op(不重算派生解锁)
      window._refreshUnlockedFlags = function () {};

      const res = CT.rollback(LEVEL, new Error('derived unlock silent failure'));
      const cs = CT.getState(LEVEL);
      const rv = cs ? cs.rollbackVerification : null;

      // 还原刷新函数
      window._refreshUnlockedFlags = origRefresh;

      results.case = {
        derivedStateRefreshed: res.derivedStateRefreshed,
        memoryRestored: res.memoryRestored,
        persistenceRestored: res.persistenceRestored,
        success: res.success,
        status: cs ? cs.status : null,
        phase: cs ? cs.phase : null,
        rvDerivedExpectedHash: rv ? rv.derivedExpectedHash : null,
        rvDerivedActualHash: rv ? rv.derivedActualHash : null,
        rvDerivedMismatched: rv ? rv.derivedMismatchedLevelIds : null,
        optionalUnlocked: State.levels[OPTIONAL].unlocked,
        xp: State.xp
      };

      CT.clearSubmissionBlockForTest(LEVEL);
      CT.reset();
      return results;
    }, { LEVEL, NEXT, OPTIONAL, SAVE_KEY });

    const c = out.case;
    rep.assert(c.optionalUnlocked === true, `派生解锁未被恢复: w1_p1.unlocked 仍为 true(静默 no-op 未还原) (${c.optionalUnlocked})`);
    rep.assert(c.derivedStateRefreshed === false, `derivedStateRefreshed === false(刷新后与快照不一致) (${c.derivedStateRefreshed})`);
    rep.assert(c.memoryRestored === true, `内存已恢复 memoryRestored === true (${c.memoryRestored})`);
    rep.assert(c.persistenceRestored === true, `持久化已恢复 persistenceRestored === true (${c.persistenceRestored})`);
    rep.assert(c.success === false, `success === false(派生验证失败不得报告成功) (${c.success})`);
    rep.assert(c.status === 'rollback_failed', `status === 'rollback_failed'(不得误报 rolled_back) (${c.status})`);
    rep.assert(c.phase === 'rolled_back', `phase === 'rolled_back' (${c.phase})`);
    rep.assert(c.rvDerivedExpectedHash !== null && c.rvDerivedExpectedHash !== c.rvDerivedActualHash,
      `rollbackVerification 派生哈希不一致(expected=${c.rvDerivedExpectedHash} vs actual=${c.rvDerivedActualHash})`);
    rep.assert(Array.isArray(c.rvDerivedMismatched) && c.rvDerivedMismatched.indexOf('w1_p1') >= 0,
      `derivedMismatchedLevelIds 包含 w1_p1 (${JSON.stringify(c.rvDerivedMismatched)})`);
    rep.assert(c.xp === 0, `内存已还原 xp=0(非残留 100) (${c.xp})`);

    // 诊断记录: CompletionTransaction.rollback.derived_verify(含 expected/actual 哈希 + mismatched)
    const diagOk = await page.evaluate((LEVEL) => {
      const CT = window.CompletionTransaction;
      const R3D = window.Round3Diagnostics;
      CT.reset();
      if (R3D && R3D.clear) R3D.clear();
      localStorage.removeItem('agent_village_d');
      if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
      if (!State.levels['w1_4']) State.levels['w1_4'] = {};
      if (!State.levels['w1_p1']) State.levels['w1_p1'] = {};
      State.levels[LEVEL].completed = false; State.levels[LEVEL].stars = 0; State.levels[LEVEL].unlocked = true;
      State.levels['w1_4'].completed = false; State.levels['w1_4'].stars = 0; State.levels['w1_4'].unlocked = false;
      State.levels['w1_p1'].completed = false; State.levels['w1_p1'].stars = 0; State.levels['w1_p1'].unlocked = false;
      State.currentLevel = LEVEL; State.xp = 0; State.totalStars = 0; State.achievements = [];
      try { State.save(); } catch (e) {}
      CT.begin(LEVEL); CT.snapshot(LEVEL);
      State.levels[LEVEL].completed = true; State.xp = 100;
      State.levels['w1_p1'].unlocked = true;
      window._refreshUnlockedFlags = function () {};
      CT.rollback(LEVEL, new Error('diag'));
      window._refreshUnlockedFlags = (typeof _refreshUnlockedFlags !== 'undefined') ? _refreshUnlockedFlags : null;
      const hit = (R3D && R3D.errors) ? R3D.errors.some(function (e) {
        return (e.scope || '').indexOf('CompletionTransaction.rollback.derived_verify') >= 0;
      }) : false;
      CT.clearSubmissionBlockForTest(LEVEL);
      CT.reset();
      return hit;
    }, LEVEL);
    rep.assert(diagOk === true, `diagnostics 含 CompletionTransaction.rollback.derived_verify(expected/actual 哈希 + mismatched 仅, 不记录完整存档)`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
