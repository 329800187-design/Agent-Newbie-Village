# -*- coding: utf-8 -*-
"""tests/test_round4_submission_block_static.py — R1.2 Round4-P0-R3 精准修复 (文件 4/4, 静态):
   聚焦 §五/§六/§七 的"不可覆盖 unsafe 提交锁"结构断言(不依赖 Chromium)。

   §十一: 通过 resolve_source 同时支持仓库结构与审阅包 source/ 结构。

用法: python tests/test_round4_submission_block_static.py
"""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resolve_source(name):
    candidates = [
        os.path.join(BASE, name),
        os.path.join(BASE, "source", name),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    raise FileNotFoundError(name)


SRC = resolve_source("completion_transaction.js")


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
    rep = Report("test_round4_submission_block_static")
    try:
        with open(SRC, "r", encoding="utf-8") as f:
            src = f.read()
    except IOError as e:
        print("[FATAL] 无法读取源码: %s" % e)
        return 1

    # 1) 独立 unsafeLevels 安全锁定义(与生产 states 分离)
    rep.assert_("var unsafeLevels = {};" in src,
                "1. 定义独立 unsafeLevels 生产安全锁(与普通 states 分离)")

    # 2) 公共查询/读取方法
    rep.assert_("isSubmissionBlocked: function" in src, "2a. 公共方法 isSubmissionBlocked 已定义")
    rep.assert_("getSubmissionBlock: function" in src, "2b. 公共方法 getSubmissionBlock 已定义(深拷贝返回)")

    # 3) rollback 在失败时写入安全锁(覆盖两种失败)
    i_w = src.find("unsafeLevels[levelId] = { blocked: true")
    rep.assert_(i_w >= 0, "3a. rollback 在失败分支写入 unsafeLevels[levelId] = { blocked: true, ... }")
    if i_w >= 0:
        region = src[i_w - 160:i_w]
        rep.assert_("rollback_failed' || st.status === 'rollback_persist_failed" in region,
                    "3b. 写入条件覆盖 rollback_failed 与 rollback_persist_failed")

    # 4) Level.done 在提交前(门禁/begin/snapshot/权威写入)检查安全锁
    rep.assert_("CompletionTransaction.isSubmissionBlocked(id)" in src,
                "4a. Level.done 提交前检查 isSubmissionBlocked(id)")
    rep.assert_("检测到未恢复的事务失败，必须重新加载页面" in src,
                "4b. 被阻止时 R3D 记录 submission_blocked")
    rep.assert_("上一次提交未完整恢复，请重新加载页面后再试" in src,
                "4c. 被阻止时 Game.toast 提示重新加载页面")

    # 5) reset() 不得清除生产安全锁(§六)
    i_reset = src.find("reset: function (levelId) {")
    i_isblock = src.find("isSubmissionBlocked: function")
    rep.assert_(i_reset >= 0 and i_isblock > i_reset, "5a. 定位 reset 函数块")
    if i_reset >= 0 and i_isblock > i_reset:
        reset_region = src[i_reset:i_isblock]
        rep.assert_("unsafeLevels[" not in reset_region and "unsafeLevels =" not in reset_region,
                    "5b. reset() 不得清除/覆盖 unsafeLevels(无 delete/赋值操作)")

    # 6) begin() 不得清除/覆盖安全锁
    i_begin = src.find("begin: function (levelId) {")
    i_snap = src.find("snapshot: function (levelId) {")
    rep.assert_(i_begin >= 0 and i_snap > i_begin, "6a. 定位 begin 函数块")
    if i_begin >= 0 and i_snap > i_begin:
        begin_region = src[i_begin:i_snap]
        rep.assert_("unsafeLevels[" not in begin_region and "unsafeLevels =" not in begin_region,
                    "6b. begin() 不得清除/覆盖 unsafeLevels 安全锁")

    # 7) 仅 clearSubmissionBlockForTest 显式清除(仅供测试)
    rep.assert_("clearSubmissionBlockForTest: function (levelId) {" in src,
                "7. 仅 clearSubmissionBlockForTest 清除安全锁(生产/TEST_MODE=false 不自动清理)")

    # 8) §八 Round3 后处理统一走 post-commit 安全包装(失败进入粘性 post_commit_error)
    rep.assert_("safePostCommit(id, 'round3.ip_complete.'" in src, "8a. IP.complete 走 safePostCommit(scope round3.ip_complete.*)")
    rep.assert_("safePostCommit(id, 'round3.clearFailure'" in src, "8b. IP.clearFailure 走 safePostCommit(scope round3.clearFailure)")
    rep.assert_("safePostCommit(id, 'round3.refreshGate'" in src, "8c. IP._refreshGate 走 safePostCommit(scope round3.refreshGate)")
    rep.assert_("safePostCommit(id, 'round3.errorFeedbackClear'" in src, "8d. EF.clear 走 safePostCommit(scope round3.errorFeedbackClear)")

    return rep.finish()


if __name__ == "__main__":
    sys_exit = __import__("sys").exit
    sys_exit(main())
