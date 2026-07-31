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

SRC = os.path.join(BASE, "completion_transaction.js")
BUILD_HTML = os.path.join(BASE, "Agent新手村_R1.2-round4-p0.html")
REFACTOR = os.path.join(BASE, "apply_round4.py")
R3 = os.path.join(BASE, "round3_features.js")


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

    return rep.finish()


if __name__ == "__main__":
    sys.exit(main())
