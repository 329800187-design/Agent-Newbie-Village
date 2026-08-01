# -*- coding: utf-8 -*-
"""tests/test_round4_transaction_static.py — R1.2 Round4-P0 验收 (文件 6/6):
   静态门禁扫描 (不依赖 Chromium)。对完成事务组件源码与构建产物做 12 项结构断言,
   确保事务边界 / 唯一提交点 / 阶段 B 回滚 / 阶段 C 不回滚 / 提交锁恢复 /
   不修改 LevelData / 不改动 Round3 门禁 / 不得伪造 completed 等属性。

用法: python tests/test_round4_transaction_static.py
"""
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resolve_source(name):
    """§十一: 同时支持仓库结构(completion_transaction.js 在 BASE 根)
    与审阅包结构(source/completion_transaction.js), 优先仓库根, 回退 source/。"""
    candidates = [
        os.path.join(BASE, name),
        os.path.join(BASE, "source", name),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    raise FileNotFoundError(name)


SRC = resolve_source("completion_transaction.js")
BUILD_HTML = resolve_source("Agent新手村_R1.2-round4-p0.html")
REFACTOR = resolve_source("apply_round4.py")
R3 = resolve_source("round3_features.js")


class Report:
    def __init__(self, name):
        self.name = name
        self.passed = 0
        self.failed = 0

    def ok(self, msg):
        self.passed += 1
        print("  [PASS] " + msg)

    def fail(self, msg):
        self.failed += 1
        print("  [FAIL] " + msg)

    def assert_(self, cond, msg):
        self.ok(msg) if cond else self.fail(msg)

    def finish(self):
        verdict = "ALL PASS" if self.failed == 0 else ("%d FAILED" % self.failed)
        print("\n== %s: %d pass / %d fail — %s ==" % (self.name, self.passed, self.failed, verdict))
        return 0 if self.failed == 0 else 1


def main():
    rep = Report("test_round4_transaction_static")
    try:
        with open(SRC, "r", encoding="utf-8") as f:
            src = f.read()
    except IOError as e:
        print("[FATAL] 无法读取源码: %s" % e)
        return 1

    with open(REFACTOR, "r", encoding="utf-8") as f:
        refactor = f.read()

    html = ""
    if os.path.exists(BUILD_HTML):
        with open(BUILD_HTML, "r", encoding="utf-8") as f:
            html = f.read()

    r3 = ""
    if os.path.exists(R3):
        with open(R3, "r", encoding="utf-8") as f:
            r3 = f.read()

    # 1) CompletionTransaction 状态机已定义
    rep.assert_("var CompletionTransaction = {" in src,
                "1. CompletionTransaction 状态机在 completion_transaction.js 中定义")

    # 2) snapshot / commit / rollback 三个核心函数存在
    rep.assert_("snapshot: function" in src, "2a. snapshot 函数存在")
    rep.assert_("commit: function" in src, "2b. commit 函数存在")
    rep.assert_("rollback: function" in src, "2c. rollback 函数存在")

    # 3) 新 Level.done (编排器) 在权威写入前先快照: snapshot 调用早于 _commit(id)
    i_snap = src.find("CompletionTransaction.snapshot(id)")
    i_commit_call = src.find("_commit(id);")
    rep.assert_(i_snap >= 0 and i_commit_call >= 0 and i_snap < i_commit_call,
                "3. 编排器先调用 snapshot 再进入阶段B权威写入 (_commit)  [%d < %d]" % (i_snap, i_commit_call))

    # 4) 唯一成功提交点在持久化 + 重读一致之后: commit(id) 晚于 _commit(id), 且置位 commitPointReached
    i_commit = src.find("var committed = CompletionTransaction.commit(id);")
    rep.assert_(i_commit_call >= 0 and i_commit >= 0 and i_commit > i_commit_call,
                "4a. commit(重读校验) 在 _commit(持久化) 之后调用  [%d > %d]" % (i_commit, i_commit_call))
    rep.assert_("st.commitPointReached = true;" in src,
                "4b. commit() 内部在全部校验通过后置位 commitPointReached (唯一成功提交点)")

    # 5) 展示(阶段C) 在提交点之后: _show(meta) 晚于 commit, 且存在 !committed 守卫
    i_show = src.find("_show(meta);")
    i_guard = src.find("if (!committed)")
    rep.assert_(i_commit >= 0 and i_show >= 0 and i_show > i_commit,
                "5a. 展示 _show(meta) 在 commit 之后 (提交点之后才展示)  [%d > %d]" % (i_show, i_commit))
    rep.assert_(i_guard >= 0 and i_guard < i_show,
                "5b. 提交失败 (!committed) 时直接返回, 不进入展示阶段")

    # 6) 阶段 B 异常 → 调用 rollback
    rep.assert_("CompletionTransaction.rollback(id, e);" in src,
                "6. 阶段B 捕获块显式调用 CompletionTransaction.rollback(id, e)")

    # 7) 阶段 C 异常 → 不回滚, 标记 post_commit_error (而非 rollback)
    pc_catch = "catch (e) { CompletionTransaction.markPostCommitError(id, e); }"
    rep.assert_(pc_catch in src,
                "7a. 阶段C 捕获块调用 markPostCommitError (不回滚)")
    # 精确界定阶段C 捕获块(从 try { _show(meta); } 到该 catch 块结束), 不得含 rollback
    i_try_show = src.find("try { _show(meta); }")
    i_pc = src.find(pc_catch)
    if i_try_show >= 0 and i_pc >= 0 and i_pc > i_try_show:
        region_c = src[i_try_show:i_pc + len(pc_catch)]
        rep.assert_("CompletionTransaction.rollback" not in region_c,
                    "7b. 阶段C 捕获块(精确界定) 不含 rollback 调用")
        rep.assert_("markPostCommitError" in region_c,
                    "7c. 阶段C 捕获块包含 markPostCommitError 标记")
    else:
        rep.fail("7b/7c. 未能精确定位阶段C 捕获块")

    # 8) 所有出口恢复提交锁 _completing=false (finally 块)
    rep.assert_("finally {" in src and "this._completing = false;" in src,
                "8. 编排器存在 finally 块统一恢复 Level._completing = false (所有出口)")

    # 9) 无空 catch (事务路径不得静默吞错)
    empty_catch = re.search(r"catch\s*\([^)]*\)\s*\{\s*\}", src)
    rep.assert_(empty_catch is None, "9. completion_transaction.js 不存在空 catch (catch(e){})")

    # 10) 不修改 LevelData (仅读取)
    writes = re.findall(r"LevelData\[[^\]]*\]\s*=", src)
    rep.assert_(len(writes) == 0, "10. completion_transaction.js 不对 LevelData 做任何写入 (仅读取), 命中写入数=%d" % len(writes))
    # apply_round4 重排块也不得写 LevelData
    refactor_writes = re.findall(r"LevelData\[[^\]]*\]\s*=", refactor)
    rep.assert_(len(refactor_writes) == 0, "10b. apply_round4 重排块不写 LevelData, 命中写入数=%d" % len(refactor_writes))

    # 11) 不改 Round3 fail-closed 门禁 (保留 w6_9/w7_7 门禁判断 + IP.fail)
    rep.assert_("id === 'w6_9' || id === 'w7_7'" in src, "11a. 编排器保留 W6/W7 门禁判定分支")
    rep.assert_("g.passed !== true" in src, "11b. 编排器保留 g.passed !== true 阻断条件")
    rep.assert_("IP.fail" in src, "11c. 编排器保留 IP.fail (门禁失败反馈)")
    rep.assert_("Round3Levels" in src, "11d. 编排器仍按 Round3 关卡集合判定门禁适用性")
    # Round3 源文件未被改动 (门禁逻辑仍在)
    rep.assert_("readGate" in r3, "11e. round3_features.js 门禁核心 (readGate) 仍存在 (未被 Round4 修改)")

    # 12) 不得允许测试伪造 completed=true 绕过事务 (编排器不写 completed; 仅存在幂等读取守卫)
    rep.assert_(".completed = true" not in src, "12a. 编排器不含任何 completed = true 赋值 (completed 仅由 _commitCompletion 权威写入)")
    rep.assert_("State.levels[id].completed === true" in src, "12b. 保留幂等守卫: 已完成关再次调用直接返回 true, 不伪造提交")

    # 14) §一 finish() 不得覆盖 post_commit_error 粘性终态
    rep.assert_("if (st.status === 'post_commit_error') {" in src,
                "14a. finish() 含 post_commit_error 粘性守卫(不覆盖已提交但失败的事实)")
    rep.assert_("st.phase = 'post_commit_error';" in src,
                "14b. 粘性分支将 phase 保持为 post_commit_error (不得回退到 committed/rendering)")

    # 15) §二 rollback 最后一步执行内存深比较验证(而非"执行过即成功")
    rep.assert_("memoryOk = verifyMemoryAgainstSnapshot(levelId, snap);" in src,
                "15. rollback 最后执行 verifyMemoryAgainstSnapshot 递归深比较完整内存状态")

    # 16) §三 rollback 最后一步执行持久化写后重读验证
    rep.assert_("var persistOk = verifyPersistenceRestored(snap);" in src,
                "16. rollback 执行 verifyPersistenceRestored (写后重读 localStorage 校验一致性)")

    # 17) §二 memoryRestored 主恢复路径不得提前置 true(只能由深比较结果 memoryOk 决定)
    #     注: 无快照早返回(!st.snapshot) 属"无可恢复内容"的平凡成功, 允许 memoryRestored=true,
    #         但其位置必须早于主路径的 `= memoryOk` 赋值(即在早返回分支内, 而非恢复中途)。
    i_mem_true = src.find("result.memoryRestored = true")
    i_mem_ok = src.find("result.memoryRestored = memoryOk;")
    rep.assert_(i_mem_true >= 0 and i_mem_ok > i_mem_true,
                "17. memoryRestored=true 仅出现在无快照早返回(主恢复路径由 memoryOk 决定, 索引 %d < %d)" % (i_mem_true, i_mem_ok))

    # 18) §三 persistenceRestored 主恢复路径不得仅因 setItem 无异常就置 true(只能由重读校验 persistOk 决定)
    i_per_true = src.find("result.persistenceRestored = true")
    i_per_ok = src.find("result.persistenceRestored = persistOk;")
    rep.assert_(i_per_true >= 0 and i_per_ok > i_per_true,
                "18. persistenceRestored=true 仅出现在无快照早返回(主恢复路径由 persistOk 决定, 索引 %d < %d)" % (i_per_true, i_per_ok))

    # 19) §五 nextCoreOf catch 必须 record + throw(不得静默吞异常)
    rep.assert_("R3D.record('CompletionTransaction.nextCoreOf', e);" in src,
                "19a. nextCoreOf catch 记录 diagnostics (CompletionTransaction.nextCoreOf)")
    i_nc = src.find("R3D.record('CompletionTransaction.nextCoreOf', e);")
    rep.assert_(i_nc >= 0 and src[i_nc:i_nc + 80].find("throw e;") >= 0,
                "19b. nextCoreOf catch 紧接着 throw e (上抛, 不静默返回 null)")

    # 20) §六 getState 返回 rollbackVerification(不可变证据); 深拷贝防止外部污染
    rep.assert_("rollbackVerification: st.rollbackVerification" in src,
                "20a. getState 返回 rollbackVerification 哈希证据")
    rep.assert_("return deepClone({" in src,
                "20b. getState 返回深拷贝(外部修改不得污染内部事务状态)")

    # 13) 构建产物包含注入标记 (源码→构建 关联)
    if html:
        rep.assert_("window.CompletionTransaction = CompletionTransaction" in html,
                    "13a. 构建产物包含 CompletionTransaction 全局暴露")
        rep.assert_("_commitCompletion: function" in html, "13b. 构建产物包含阶段B 重排 (_commitCompletion)")
        rep.assert_("_showCompletion: function" in html, "13c. 构建产物包含阶段C 重排 (_showCompletion)")
    else:
        rep.fail("13. 构建产物 Agent新手村_R1.2-round4-p0.html 不存在, 跳过注入标记校验")

    # 21) §二 快照必须记录全量派生解锁基线 captureDerivedUnlockedState + snap.derivedUnlockedState
    rep.assert_("function captureDerivedUnlockedState" in src,
                "21a. captureDerivedUnlockedState 函数已定义(遍历 LevelData 捕获全量派生 unlocked)")
    rep.assert_("derivedUnlockedState: captureDerivedUnlockedState()" in src,
                "21b. 快照写入 snap.derivedUnlockedState(全量派生基线)")
    rep.assert_("snapshotFields = ['currentLevelState', 'affectedNextLevelState', 'affectedGlobalFields', 'persistedSave', 'derivedUnlockedState']" in src,
                "21c. snapshotFields 含 derivedUnlockedState")

    # 22) §三 派生状态必须经结果验证
    rep.assert_("function verifyDerivedUnlockedState" in src,
                "22a. verifyDerivedUnlockedState 函数已定义")
    rep.assert_("result.derivedStateRefreshed = verifyDerivedUnlockedState(snap);" in src,
                "22b. 回滚在 _refreshUnlockedFlags 后必须与快照深比较, 一致才 derivedStateRefreshed=true")
    rep.assert_("CompletionTransaction.rollback.derived_verify" in src,
                "22c. 派生静默失败记录诊断(仅 expected/actual 哈希 + mismatched ids, 不记录完整存档)")

    # 23) §四 回滚证据增加派生哈希
    rep.assert_("derivedExpectedHash" in src and "derivedActualHash" in src and "derivedMismatchedLevelIds" in src,
                "23. rollbackVerification 含派生哈希(derivedExpectedHash/derivedActualHash/derivedMismatchedLevelIds)")
    rep.assert_("derivedMismatchedLevelIds: dv.mismatchedIds" in src,
                "23b. getState 经 rollbackVerification 暴露 derivedMismatchedLevelIds(供测试断言 w1_p1)")

    # 24) §五 不可覆盖的 unsafe 提交锁
    rep.assert_("var unsafeLevels = {};" in src,
                "24a. 定义独立 unsafeLevels 生产安全锁(与普通 states 分离)")
    rep.assert_("isSubmissionBlocked: function" in src,
                "24b. 公共方法 isSubmissionBlocked 已定义")
    rep.assert_("getSubmissionBlock: function" in src,
                "24c. 公共方法 getSubmissionBlock 已定义(深拷贝返回)")
    i_unsafe_write = src.find("unsafeLevels[levelId] = { blocked: true")
    rep.assert_(i_unsafe_write >= 0, "24d. rollback 在 rollback_failed/persist_failed 时写入 unsafeLevels 安全锁")
    if i_unsafe_write >= 0:
        cond_region = src[i_unsafe_write - 140:i_unsafe_write]
        rep.assert_("rollback_failed' || st.status === 'rollback_persist_failed" in cond_region,
                    "24e. 写入条件覆盖 rollback_failed 与 rollback_persist_failed 两种失败")

    # 25) §五 Level.done 在提交前检查安全锁
    rep.assert_("CompletionTransaction.isSubmissionBlocked(id)" in src,
                "25a. Level.done 在门禁/begin/snapshot/权威写入前检查 isSubmissionBlocked")
    rep.assert_("上一次提交未完整恢复，请重新加载页面后再试" in src,
                "25b. 被阻止时提示重新加载页面(Game.toast)")

    # 26) §六 reset 不得清除生产安全锁; begin 亦不得清除; 仅 clearSubmissionBlockForTest 清除
    i_reset = src.find("reset: function (levelId) {")
    i_isblock = src.find("isSubmissionBlocked: function")
    rep.assert_(i_reset >= 0 and i_isblock > i_reset, "26a. 定位 reset 函数块(位于 isSubmissionBlocked 之前)")
    if i_reset >= 0 and i_isblock > i_reset:
        reset_region = src[i_reset:i_isblock]
        rep.assert_("unsafeLevels[" not in reset_region and "unsafeLevels =" not in reset_region,
                    "26b. reset() 函数体内不得清除/覆盖 unsafeLevels 生产安全锁(无 delete/赋值操作)")
    i_begin = src.find("begin: function (levelId) {")
    i_snap_fn = src.find("snapshot: function (levelId) {")
    if i_begin >= 0 and i_snap_fn > i_begin:
        begin_region = src[i_begin:i_snap_fn]
        rep.assert_("unsafeLevels[" not in begin_region and "unsafeLevels =" not in begin_region,
                    "26c. begin() 函数体内不得清除/覆盖 unsafeLevels 安全锁")
    rep.assert_("clearSubmissionBlockForTest: function (levelId) {" in src,
                "26d. 仅测试显式调用 clearSubmissionBlockForTest 清除安全锁(生产/TEST_MODE=false 不自动清理)")

    # 27) §八 Round3 后处理统一走 post-commit 安全包装
    rep.assert_("safePostCommit(id, 'round3.ip_complete.'" in src,
                "27a. IP.complete 走 safePostCommit 包装(scope round3.ip_complete.<step>)")
    rep.assert_("safePostCommit(id, 'round3.clearFailure'" in src,
                "27b. IP.clearFailure 走 safePostCommit 包装(scope round3.clearFailure)")
    rep.assert_("safePostCommit(id, 'round3.refreshGate'" in src,
                "27c. IP._refreshGate 走 safePostCommit 包装(scope round3.refreshGate)")
    rep.assert_("safePostCommit(id, 'round3.errorFeedbackClear'" in src,
                "27d. EF.clear 走 safePostCommit 包装(scope round3.errorFeedbackClear)")

    return rep.finish()


if __name__ == "__main__":
    sys.exit(main())
