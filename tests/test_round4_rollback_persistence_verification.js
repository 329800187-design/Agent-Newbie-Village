// tests/test_round4_rollback_persistence_verification.js — R1.2 Round4-P0-R2 精准修复 (文件 3/4):
//   §三 持久化回滚必须写后重读验证: setItem/removeItem 后重读 localStorage 校验一致性;
//   不一致 → persistenceRestored=false / status=rollback_persist_failed / success=false /
//   禁止误报 rolled_back; diagnostics 记录持久化恢复作用域。
//
//   直接驱动 CompletionTransaction 公共 API, 覆盖(均不得报告 persistenceRestored=true):
//     A. setItem 抛异常
//     B. setItem 静默不写(重读仍为故障前内容 ≠ 基线)
//     C. setItem 写入错误内容(重读 ≠ 基线)
//     D. removeItem 静默失败(存档不存在场景, key 仍存在)
//     E. removeItem 后 key 仍存在(同 D, 显式断言 key 残留)
//
// 用法: node tests/test_round4_rollback_persistence_verification.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18973;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';
const NEXT = 'ai_camp_2';
const SAVE_KEY = 'agent_village_d';

(async () => {
  const rep = new TestReport('test_round4_rollback_persistence_verification');
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
      const results = {};

      function setNormalState() {
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        if (!State.levels[NEXT]) State.levels[NEXT] = {};
        State.levels[LEVEL].completed = false; State.levels[LEVEL].stars = 0; State.levels[LEVEL].unlocked = true;
        State.levels[NEXT].completed = false; State.levels[NEXT].stars = 0; State.levels[NEXT].unlocked = false;
        State.currentLevel = LEVEL;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
      }

      function runCase(key, kind) {
        CT.reset();
        if (R3D && R3D.clear) R3D.clear();
        const origSet = localStorage.setItem.bind(localStorage);
        const origRemove = localStorage.removeItem.bind(localStorage);

        if (kind === 'remove_silent' || kind === 'remove_key_remains') {
          // 存档不存在场景
          localStorage.removeItem(SAVE_KEY);
          setNormalState();
          CT.begin(LEVEL);
          CT.snapshot(LEVEL);   // persistedSaveExists=false
          origSet(SAVE_KEY, 'SOMETHING_LEFT_OVER');  // 注入一个残留 key
          localStorage.removeItem = function () {};   // 静默失败
        } else {
          // 存档存在场景
          localStorage.removeItem(SAVE_KEY);
          setNormalState();
          try { State.save(); } catch (e) {}
          CT.begin(LEVEL);
          CT.snapshot(LEVEL);   // persistedSaveExists=true, persistedSave=S0
          const s0 = localStorage.getItem(SAVE_KEY);
          origSet(SAVE_KEY, 'S1_DIFFERENT_FROM_BASELINE');  // 故障前内容(重读基线应为 S0)
          if (kind === 'set_throw') {
            localStorage.setItem = function () { throw new Error('injected setItem throw'); };
          } else if (kind === 'set_silent') {
            localStorage.setItem = function () {};   // 静默不写
          } else if (kind === 'set_wrong') {
            localStorage.setItem = function () { origSet(SAVE_KEY, 'WRONG_CONTENT_WRITTEN'); };
          }
        }

        const res = CT.rollback(LEVEL, new Error('test persistence rollback'));
        const cs = CT.getState(LEVEL);

        // 还原
        localStorage.setItem = origSet;
        localStorage.removeItem = origRemove;

        const diagHit = (R3D && R3D.errors)
          ? R3D.errors.some(function (e) { return (e.scope || '').indexOf('CompletionTransaction.rollback.persist') === 0; })
          : false;
        const actualNow = localStorage.getItem(SAVE_KEY);

        results[key] = {
          kind: kind,
          memoryRestored: res.memoryRestored,
          persistenceRestored: res.persistenceRestored,
          derivedStateRefreshed: res.derivedStateRefreshed,
          success: res.success,
          status: cs ? cs.status : null,
          phase: cs ? cs.phase : null,
          rv: cs ? cs.rollbackVerification : null,
          diagHit: diagHit,
          actualNow: actualNow
        };
        CT.reset();
      }

      runCase('set_throw', 'set_throw');
      runCase('set_silent', 'set_silent');
      runCase('set_wrong', 'set_wrong');
      runCase('remove_silent', 'remove_silent');
      runCase('remove_key_remains', 'remove_key_remains');

      return results;
    }, { LEVEL, NEXT, SAVE_KEY });

    function assertPersistFail(key) {
      const o = out[key];
      rep.assert(o.memoryRestored === true, `【${key}】内存恢复成功 (memoryRestored=true) (${o.memoryRestored})`);
      rep.assert(o.persistenceRestored === false, `【${key}】persistenceRestored === false (${o.persistenceRestored})`);
      rep.assert(o.derivedStateRefreshed === true, `【${key}】派生刷新成功 (derivedStateRefreshed=true) (${o.derivedStateRefreshed})`);
      rep.assert(o.success === false, `【${key}】success === false (${o.success})`);
      rep.assert(o.status === 'rollback_persist_failed', `【${key}】status === 'rollback_persist_failed' (非 rolled_back) (${o.status})`);
      rep.assert(o.phase === 'rolled_back', `【${key}】phase === 'rolled_back' (${o.phase})`);
      rep.assert(o.rv && o.rv.persistenceExpectedHash !== o.rv.persistenceActualHash,
        `【${key}】rollbackVerification 持久化 expected/actual 哈希不一致(重读≠基线) (${o.rv && o.rv.persistenceExpectedHash} vs ${o.rv && o.rv.persistenceActualHash})`);
      rep.assert(o.diagHit === true, `【${key}】diagnostics 含持久化恢复作用域 (${o.diagHit})`);
    }

    assertPersistFail('set_throw');
    assertPersistFail('set_silent');
    assertPersistFail('set_wrong');
    assertPersistFail('remove_silent');
    assertPersistFail('remove_key_remains');

    // 显式断言"重读数据与被恢复基线不一致" / "removeItem 后 key 仍存在"
    rep.assert(out.set_silent.actualNow === 'S1_DIFFERENT_FROM_BASELINE',
      `set_silent: 重读仍为故障前内容(≠基线 S0), 证明未静默误报成功 (${out.set_silent.actualNow})`);
    rep.assert(out.remove_silent.actualNow === 'SOMETHING_LEFT_OVER',
      `remove_silent: removeItem 静默失败 → key 仍存在(未被清除) (${out.remove_silent.actualNow})`);
    rep.assert(out.remove_key_remains.actualNow === 'SOMETHING_LEFT_OVER',
      `remove_key_remains: removeItem 后 key 仍存在 (${out.remove_key_remains.actualNow})`);

    rep.assert(st.pageErrors.length === 0, `全程 pageerror = 0 (${st.pageErrors.slice(0, 3).join(' | ') || '0'})`);
    rep.assert(st.failedRequests.length === 0, `全程 requestfailed = 0 (${st.failedRequests.slice(0, 3).join(' | ') || '0'})`);

    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(rep.finish());
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
