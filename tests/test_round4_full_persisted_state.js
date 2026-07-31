// tests/test_round4_full_persisted_state.js — R1.2 Round4-P0-R1 精准修复 (文件 1/4):
//   §一 提交点必须校验完整持久化状态: 提交点(commit)对内存权威状态与持久化内容做
//   递归深比较(完整结构), 任一权威字段不一致 → commitPointReached=false 并完整回滚。
//
//   覆盖(均通过 CompletionTransactionFaults.arm('after_save', {mode:'corrupt', patch})
//   在 State.save 成功后定向注入不一致, 模拟"持久化被篡改/丢失"):
//     A. 当前关 stars 不一致 (内存 stars=3, 持久化 stars=999) → 不提交, 回滚
//     B. 下一核心关记录缺失 (持久化 levels[NEXT] 被删除) → 不提交, 回滚
//     C. 随机其它关卡记录缺失 (持久化 levels[OTHER] 被删除) → 不提交, 回滚
//
//   每个用例断言: Level.done 不抛异常 / 返回 false; completed=false;
//     commitPointReached=false; status='rolled_back'; 持久化已还原(篡改值不存在);
//     Level._completing=false; 提交锁恢复。
//
// 用法: node tests/test_round4_full_persisted_state.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18966;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_1';

(async () => {
  const rep = new TestReport('test_round4_full_persisted_state');
  const srv = await startServer(PORT);
  const browser = await launch();
  try {
    const st = {};
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    attachCollectors(page, st);
    await page.goto(`http://127.0.0.1:${PORT}/${encodeURIComponent(R4)}?t=${Date.now()}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const cases = await page.evaluate((LEVEL) => {
      const CT = window.CompletionTransaction;
      const F = window.CompletionTransactionFaults;
      const out = [];

      function setup() {
        F.clearAll(); CT.reset();
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        State.levels[LEVEL].completed = false;
        State.levels[LEVEL].stars = 0;
        State.levels[LEVEL].unlocked = true;
        State.currentLevel = LEVEL;
        State.xp = 0; State.totalStars = 0; State.achievements = [];
        Level.current = LEVEL; Level.hintN = 0; Level._completing = false;
        // 计算下一核心关与其它关
        var NEXT = (typeof getNextCoreLevel === 'function') ? getNextCoreLevel(LEVEL) : null;
        if (!NEXT) NEXT = 'ai_camp_2';
        if (!State.levels[NEXT]) State.levels[NEXT] = {};
        State.levels[NEXT].completed = false;
        State.levels[NEXT].stars = 0;
        State.levels[NEXT].unlocked = false;
        var OTHER = Object.keys(State.levels).filter(function (id) { return id !== LEVEL && id !== NEXT; })[0];
        try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {}
        window.__NEXT = NEXT;
        window.__OTHER = OTHER;
      }

      function runCase(name, patch) {
        setup();
        F.arm('after_save', { mode: 'corrupt', patch: patch });
        const persistedBefore = localStorage.getItem('agent_village_d');
        let thrown = false, ret;
        try { ret = Level.done(); } catch (e) { thrown = true; }
        const cs = CT.getState(LEVEL);
        const persistedAfter = localStorage.getItem('agent_village_d');
        let restoredObj = null;
        try { restoredObj = JSON.parse(persistedAfter); } catch (e) {}
        out.push({
          name: name,
          thrown,
          ret: ret === false ? 'false' : (ret === true ? 'true' : String(ret)),
          completed: State.levels[LEVEL].completed,
          status: cs ? cs.status : null,
          commitPointReached: cs ? cs.commitPointReached : null,
          completing: Level._completing,
          NEXT: window.__NEXT,
          OTHER: window.__OTHER,
          restoredObj: restoredObj,
          persistRestored: persistedAfter === persistedBefore
        });
        F.clearAll(); CT.reset();
      }

      // A. 当前关 stars 不一致
      runCase('A_stars_mismatch', function (o) { if (o.levels && o.levels[LEVEL]) o.levels[LEVEL].stars = 999; });
      // B. 下一核心关记录缺失
      runCase('B_next_record_missing', function (o) { if (o.levels && window.__NEXT) delete o.levels[window.__NEXT]; });
      // C. 随机其它关卡记录缺失
      runCase('C_other_record_missing', function (o) { if (o.levels && window.__OTHER) delete o.levels[window.__OTHER]; });

      return out;
    }, LEVEL);

    cases.forEach(c => {
      rep.assert(c.thrown === false, `${c.name}: Level.done 内部捕获故障, 未向调用方抛异常 (thrown=${c.thrown})`);
      rep.assert(c.ret === 'false', `${c.name}: Level.done 返回 false (${c.ret})`);
      rep.assert(c.completed === false, `${c.name}: 回滚后 completed === false (${c.completed})`);
      rep.assert(c.status === 'rolled_back', `${c.name}: 事务终态 status === 'rolled_back' (${c.status})`);
      rep.assert(c.commitPointReached === false, `${c.name}: 提交点未达成 commitPointReached === false (${c.commitPointReached})`);
      rep.assert(c.completing === false, `${c.name}: 提交锁已恢复 _completing === false (${c.completing})`);
      rep.assert(c.persistRestored === true, `${c.name}: 持久化已还原(篡改值未残留) (${c.persistRestored})`);
      // 篡改字段在回滚后必须消失(证明 commit 的完整结构校验生效, 且 rollback 精确还原)
      if (c.name === 'A_stars_mismatch') {
        const stars = c.restoredObj && c.restoredObj.levels && c.restoredObj.levels[LEVEL] ? c.restoredObj.levels[LEVEL].stars : null;
        rep.assert(stars !== 999, `${c.name}: 回滚后 stars 不为 999(篡改已还原, 实际=${stars})`);
      }
      if (c.name === 'B_next_record_missing') {
        const exists = !!(c.restoredObj && c.restoredObj.levels && c.restoredObj.levels[c.NEXT]);
        rep.assert(exists === true, `${c.name}: 回滚后下一关记录恢复存在 (${exists})`);
      }
      if (c.name === 'C_other_record_missing') {
        const exists = !!(c.restoredObj && c.restoredObj.levels && c.restoredObj.levels[c.OTHER]);
        rep.assert(exists === true, `${c.name}: 回滚后其它关记录恢复存在 (${exists})`);
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
