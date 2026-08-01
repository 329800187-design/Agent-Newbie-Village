// tests/test_round4_rollback_memory_verification.js — R1.2 Round4-P0-R2 精准修复 (文件 2/4):
//   §二 内存回滚必须完整验证后才能报告成功: 恢复任意字段失败或验证不一致 →
//   memoryRestored=false / status=rollback_failed / success=false / 禁止误报成功。
//
//   直接驱动 CompletionTransaction 公共 API (begin → snapshot → 模拟完成写入 → rollback),
//   精确注入"恢复阶段"故障, 验证内存深比较验证真正生效(而非"执行过就成功")。
//
//   覆盖:
//     A. State.xp 恢复赋值抛错         → memoryRestored=false / rollback_failed / 残留值 10 未被还原
//     B. State.achievements 恢复赋值抛错 → memoryRestored=false / rollback_failed / 残留值 ['w6_complete']
//     C. 下一关 State.levels[NEXT] 恢复赋值抛错 → memoryRestored=false / rollback_failed / 残留 completed=true
//     D. _refreshUnlockedFlags 抛错     → derivedStateRefreshed=false / rollback_failed (内存已还原, 派生失败)
//
//   每例另断言 rollbackVerification 中 expected/actual 哈希: A/B/C 不一致(内存未还原),
//   D 内存哈希一致但 derivedStateRefreshed=false; 均不得 success=true。
//
// 用法: node tests/test_round4_rollback_memory_verification.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18972;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';
const NEXT = 'ai_camp_2';
const SAVE_KEY = 'agent_village_d';

(async () => {
  const rep = new TestReport('test_round4_rollback_memory_verification');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const out = await page.evaluate(({ LEVEL, NEXT, SAVE_KEY }) => {
      const CT = window.CompletionTransaction;
      const R3D = window.Round3Diagnostics;
      const origRefresh = window._refreshUnlockedFlags;
      const results = {};

      function baseSetup() {
        CT.reset();
        if (R3D && R3D.clear) R3D.clear();
        localStorage.removeItem(SAVE_KEY);
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        if (!State.levels[NEXT]) State.levels[NEXT] = {};
        State.levels[LEVEL].completed = false; State.levels[LEVEL].stars = 0; State.levels[LEVEL].unlocked = true;
        State.levels[NEXT].completed = false; State.levels[NEXT].stars = 0; State.levels[NEXT].unlocked = false;
        State.currentLevel = LEVEL;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        if (window._refreshUnlockedFlags) window._refreshUnlockedFlags = origRefresh;
        try { State.save(); } catch (e) {}
      }

      function runCase(key, mode) {
        baseSetup();
        CT.begin(LEVEL);
        CT.snapshot(LEVEL);
        // 模拟完成阶段 B 的权威写入(与快照不一致)
        State.xp = 10; State.totalStars = 3; State.achievements = ['w6_complete'];
        State.levels[LEVEL].completed = true;
        State.levels[NEXT].completed = true; State.levels[NEXT].unlocked = true;
        State.currentLevel = NEXT;

        // 在"恢复阶段"注入故障(快照已捕获 xp=0/ach=[]/next.completed=false)
        if (mode === 'xp') {
          Object.defineProperty(State, 'xp', { value: State.xp, writable: false, configurable: true });
        } else if (mode === 'achievements') {
          Object.defineProperty(State, 'achievements', { value: State.achievements, writable: false, configurable: true });
        } else if (mode === 'next') {
          Object.defineProperty(State.levels, NEXT, { value: State.levels[NEXT], writable: false, configurable: true });
        } else if (mode === 'refresh') {
          window._refreshUnlockedFlags = function () { throw new Error('injected _refreshUnlockedFlags'); };
        }

        const res = CT.rollback(LEVEL, new Error('test memory rollback'));
        const cs = CT.getState(LEVEL);

        // 还原(便于下一用例)
        if (mode === 'xp') Object.defineProperty(State, 'xp', { writable: true, configurable: true });
        else if (mode === 'achievements') Object.defineProperty(State, 'achievements', { writable: true, configurable: true });
        else if (mode === 'next') Object.defineProperty(State.levels, NEXT, { writable: true, configurable: true });
        else if (mode === 'refresh') window._refreshUnlockedFlags = origRefresh;

        results[key] = {
          mode: mode,
          memoryRestored: res.memoryRestored,
          persistenceRestored: res.persistenceRestored,
          derivedStateRefreshed: res.derivedStateRefreshed,
          success: res.success,
          status: cs ? cs.status : null,
          phase: cs ? cs.phase : null,
          rv: cs ? cs.rollbackVerification : null,
          residualXp: State.xp,
          residualAch: JSON.stringify(State.achievements),
          residualNextCompleted: State.levels[NEXT].completed
        };
        CT.reset();
      }

      runCase('xp', 'xp');
      runCase('achievements', 'achievements');
      runCase('next', 'next');
      runCase('refresh', 'refresh');

      if (window._refreshUnlockedFlags) window._refreshUnlockedFlags = origRefresh;
      return results;
    }, { LEVEL, NEXT, SAVE_KEY });

    // ── A. xp 恢复失败 ──
    const A = out.xp;
    rep.assert(A.memoryRestored === false, `A. xp: memoryRestored === false (恢复赋值抛错) (${A.memoryRestored})`);
    rep.assert(A.persistenceRestored === true, `A. xp: 持久化恢复仍成功 (${A.persistenceRestored})`);
    rep.assert(A.success === false, `A. xp: success === false (${A.success})`);
    rep.assert(A.status === 'rollback_failed', `A. xp: status === 'rollback_failed' (${A.status})`);
    rep.assert(A.phase === 'rolled_back', `A. xp: phase === 'rolled_back' (${A.phase})`);
    rep.assert(A.rv && A.rv.memoryExpectedHash !== A.rv.memoryActualHash,
      `A. xp: rollbackVerification 内存 expected/actual 哈希不一致(残留被识别) (${A.rv && A.rv.memoryExpectedHash} vs ${A.rv && A.rv.memoryActualHash})`);
    rep.assert(A.residualXp === 10, `A. xp: 实际残留值 xp=10 未被误报还原 (${A.residualXp})`);

    // ── B. achievements 恢复失败 ──
    const B = out.achievements;
    rep.assert(B.memoryRestored === false, `B. achievements: memoryRestored === false (${B.memoryRestored})`);
    rep.assert(B.success === false, `B. achievements: success === false (${B.success})`);
    rep.assert(B.status === 'rollback_failed', `B. achievements: status === 'rollback_failed' (${B.status})`);
    rep.assert(B.rv && B.rv.memoryExpectedHash !== B.rv.memoryActualHash,
      `B. achievements: 内存 expected/actual 哈希不一致 (${B.rv && B.rv.memoryExpectedHash} vs ${B.rv && B.rv.memoryActualHash})`);
    rep.assert(B.residualAch === JSON.stringify(['w6_complete']), `B. achievements: 残留值 ['w6_complete'] 未被还原 (${B.residualAch})`);

    // ── C. 下一关状态恢复失败 ──
    const C = out.next;
    rep.assert(C.memoryRestored === false, `C. 下一关: memoryRestored === false (${C.memoryRestored})`);
    rep.assert(C.success === false, `C. 下一关: success === false (${C.success})`);
    rep.assert(C.status === 'rollback_failed', `C. 下一关: status === 'rollback_failed' (${C.status})`);
    rep.assert(C.rv && C.rv.memoryExpectedHash !== C.rv.memoryActualHash,
      `C. 下一关: 内存 expected/actual 哈希不一致 (${C.rv && C.rv.memoryExpectedHash} vs ${C.rv && C.rv.memoryActualHash})`);
    rep.assert(C.residualNextCompleted === true, `C. 下一关: 残留 completed=true 未被还原 (${C.residualNextCompleted})`);

    // ── D. _refreshUnlockedFlags 抛错 ──
    const D = out.refresh;
    rep.assert(D.memoryRestored === true, `D. refresh: 内存已成功还原 (memoryRestored=true) (${D.memoryRestored})`);
    rep.assert(D.derivedStateRefreshed === false, `D. refresh: derivedStateRefreshed === false (派生刷新抛错) (${D.derivedStateRefreshed})`);
    rep.assert(D.persistenceRestored === true, `D. refresh: 持久化恢复成功 (${D.persistenceRestored})`);
    rep.assert(D.success === false, `D. refresh: success === false (${D.success})`);
    rep.assert(D.status === 'rollback_failed', `D. refresh: status === 'rollback_failed' (派生失败, 非 persist_failed) (${D.status})`);
    rep.assert(D.residualXp === 0, `D. refresh: 内存已还原 xp=0 (${D.residualXp})`);
    rep.assert(D.rv && D.rv.memoryExpectedHash === D.rv.memoryActualHash,
      `D. refresh: 内存哈希一致(故障在派生层, 非内存) (${D.rv && D.rv.memoryExpectedHash})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
