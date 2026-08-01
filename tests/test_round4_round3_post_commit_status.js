// tests/test_round4_round3_post_commit_status.js — R1.2 Round4-P0-R3 精准修复 (文件 3/4):
//   §八 Round3 成功后续处理统一走 post-commit 安全包装: 任一失败 → 粘性 post_commit_error,
//   不回滚已提交事务, 其余相互独立后处理继续执行。
//
//   覆盖(§九.3): 对 ai_camp_11(含 4 个 interactionSteps)分别让
//     IP.complete / IP.clearFailure / IP._refreshGate / EF.clear 抛错
//   每种断言:
//     completed === true; commitPointReached === true;
//     立即 status === 'post_commit_error' 且 phase === 'post_commit_error';
//     等待 1800ms 后仍为 post_commit_error(粘性终态不被覆盖);
//     diagnostics 含对应 post_commit scope
//       IP.complete   → CompletionTransaction.post_commit.round3.ip_complete.*
//       clearFailure  → CompletionTransaction.post_commit.round3.clearFailure
//       _refreshGate  → CompletionTransaction.post_commit.round3.refreshGate
//       EF.clear      → CompletionTransaction.post_commit.round3.errorFeedbackClear
//
// 用法: node tests/test_round4_round3_post_commit_status.js
const { ROOT, startServer, launch, attachCollectors, TestReport } = require('./_pw');

const PORT = 18983;
const R4 = 'Agent新手村_R1.2-round4-p0.html';
const LEVEL = 'ai_camp_11';

const CASES = [
  { key: 'A.IP.complete', scope: 'round3.ip_complete' },
  { key: 'B.IP.clearFailure', scope: 'round3.clearFailure' },
  { key: 'C.IP._refreshGate', scope: 'round3.refreshGate' },
  { key: 'D.EF.clear', scope: 'round3.errorFeedbackClear' }
];

(async () => {
  const rep = new TestReport('test_round4_round3_post_commit_status');
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
      const imm = await page.evaluate(({ LEVEL, scope }) => {
        const CT = window.CompletionTransaction;
        const F = window.CompletionTransactionFaults;
        const R3D = window.Round3Diagnostics;
        F.clearAll(); CT.reset(); CT.clearSubmissionBlockForTest(LEVEL);
        if (R3D && R3D.clear) R3D.clear();
        if (!State.levels[LEVEL]) State.levels[LEVEL] = {};
        State.levels[LEVEL].completed = false; State.levels[LEVEL].stars = 0; State.levels[LEVEL].unlocked = true;
        State.currentLevel = LEVEL; State.xp = 0; State.totalStars = 0; State.achievements = [];
        Level.current = LEVEL; Level.hintN = 0; Level._completing = false;
        try { Level.render(LEVEL); if (typeof Game !== 'undefined' && Game && Game.switch) Game.switch('level-page'); } catch (e) {}
        try { State.save(); } catch (e) {}

        // 注入: 让对应 Round3 后处理函数抛错
        let restore = function () {};
        if (scope === 'round3.ip_complete') {
          const IP = window.InteractionProgress; const orig = IP.complete;
          IP.complete = function () { throw new Error('injected IP.complete'); };
          restore = function () { IP.complete = orig; };
        } else if (scope === 'round3.clearFailure') {
          const IP = window.InteractionProgress; const orig = IP.clearFailure;
          IP.clearFailure = function () { throw new Error('injected IP.clearFailure'); };
          restore = function () { IP.clearFailure = orig; };
        } else if (scope === 'round3.refreshGate') {
          const IP = window.InteractionProgress; const orig = IP._refreshGate;
          IP._refreshGate = function () { throw new Error('injected IP._refreshGate'); };
          restore = function () { IP._refreshGate = orig; };
        } else if (scope === 'round3.errorFeedbackClear') {
          const EF = window.ErrorFeedback; const orig = EF.clear;
          EF.clear = function () { throw new Error('injected EF.clear'); };
          restore = function () { EF.clear = orig; };
        }

        let thrown = false;
        try { Level.done(); } catch (e) { thrown = true; }
        const cs = CT.getState(LEVEL);
        const diagHit = (R3D && R3D.errors)
          ? R3D.errors.some(function (e) { return (e.scope || '').indexOf('CompletionTransaction.post_commit.' + scope) >= 0; })
          : false;
        restore();
        return {
          scope, thrown,
          completed: State.levels[LEVEL].completed,
          commitPointReached: cs ? cs.commitPointReached : null,
          status: cs ? cs.status : null,
          phase: cs ? cs.phase : null,
          completing: Level._completing,
          diagHit: diagHit
        };
      }, { LEVEL, scope: c.scope });

      // 2) 等待 1800ms 暴露任何异步覆盖尝试
      await new Promise(r => setTimeout(r, 1850));

      // 3) 最终读取 + finish() + 清理
      const fin = await page.evaluate((LEVEL) => {
        const CT = window.CompletionTransaction;
        const cs = CT.getState(LEVEL);
        const preStatus = cs ? cs.status : null;
        const prePhase = cs ? cs.phase : null;
        const ret = CT.finish(LEVEL);
        const cs2 = CT.getState(LEVEL);
        CT.clearSubmissionBlockForTest(LEVEL);
        CT.reset();
        return { preStatus, prePhase, finishRet: ret, finishStatus: cs2 ? cs2.status : null };
      }, LEVEL);

      rep.assert(imm.thrown === false, `${c.key}: Level.done 未向调用方抛异常 (${imm.thrown})`);
      rep.assert(imm.completed === true, `${c.key}: 已提交事务保持 completed === true (${imm.completed})`);
      rep.assert(imm.commitPointReached === true, `${c.key}: commitPointReached === true (${imm.commitPointReached})`);
      rep.assert(imm.status === 'post_commit_error', `${c.key}: 立即 status === 'post_commit_error' (${imm.status})`);
      rep.assert(imm.phase === 'post_commit_error', `${c.key}: 立即 phase === 'post_commit_error' (${imm.phase})`);
      rep.assert(imm.completing === false, `${c.key}: 提交锁已恢复 (${imm.completing})`);
      rep.assert(imm.diagHit === true, `${c.key}: diagnostics 含 post_commit.${c.scope} (${imm.diagHit})`);
      rep.assert(fin.preStatus === 'post_commit_error', `${c.key}: 等待1850ms后 status 仍为 post_commit_error (${fin.preStatus})`);
      rep.assert(fin.prePhase === 'post_commit_error', `${c.key}: 等待1850ms后 phase 仍为 post_commit_error (${fin.prePhase})`);
      rep.assert(fin.finishRet === true, `${c.key}: finish() 返回 true(已提交) (${fin.finishRet})`);
      rep.assert(fin.finishStatus === 'post_commit_error', `${c.key}: finish() 后仍为 post_commit_error(未被覆盖) (${fin.finishStatus})`);
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
