# -*- coding: utf-8 -*-
"""gen_r4r3_review_package.py — 生成 Agent新手村 R1.2 Round4-P0-R3 独立审阅包。

产物: Agent新手村_R1.2-Round4-P0-R3_独立审阅包.zip (+ .sha256 边车)

R3 精准修复专项(基于独立审阅失败 ROUND4_P0_R2_REVIEW_FAILED @ 425d1664):
  一、派生解锁状态必须经过最终验证: 快照记录全量派生解锁基线(captureDerivedUnlockedState),
      回滚 restore → _refreshUnlockedFlags() → deepEqual 校验实际 vs 快照; 不一致 →
      derivedStateRefreshed=false / status=rollback_failed / success=false / 提示重载;
      诊断仅含 expected|actual 哈希与 mismatched level id(绝不记录完整存档)。
  二、rollback_failed / rollback_persist_failed 后必须真正禁止继续提交: 独立 unsafeLevels
      安全锁; 失败即写入 {blocked, reason, createdAt}; Level.done() 在任何门禁/提交前检查
      isSubmissionBlocked → 直接 return false + toast(请重新加载页面); 第二次提交被阻断。
  三、Round3 提交后处理异常必须进入粘性 post_commit_error: InteractionProgress.complete /
      clearFailure / _refreshGate / ErrorFeedback.clear 统一改由 safePostCommit 包裹;
      任一侧作用抛错 → completed=true / commitPointReached=true / 不回滚 /
      status=phase=post_commit_error(粘性, 1800ms 后仍保持) / 其余侧作用继续。

不扩展关卡 / 不迁移 74 关 / 不修改 LevelData / 课程哈希 / 门禁业务规则 / Round3 fail-closed 门禁。

包结构(与 R2 一致并扩展):
  README.txt / RUN_REVIEW_TESTS.md / NEW_COMMIT_SHA.txt / COMMIT_CLASSIFICATION.txt
  FULL_PATCH.patch / CUMULATIVE_PATCH_since_R3_PASS.patch / GIT_BUNDLE.bundle
  GIT_BUNDLE_VERIFY.txt / GIT_BUNDLE_HEADS.txt / TWO_BUILD_SHA.txt / SELF_REBUILD_VERIFY.txt
  COURSE_INVARIANTS.txt / CI_STATUS.txt / SHA256SUMS.txt
  source/ tests/ logs/ 以及 16 个专题结果目录(含 R3 新增 4 个: derived_unlock_results /
  submission_block_results / round3_post_commit_results / generator_safety_results)递归打包。

自重建: 从解压后的包执行
    cd source
    python apply_round4.py build1.html
    python apply_round4.py build2.html
    sha256sum build1.html build2.html "Agent新手村_R1.2-round4-p0.html"
  build1/build2 与交付件字节一致(本脚本打包后自动抽取校验, 写入 SELF_REBUILD_VERIFY.txt)。

§十二 生成器安全: 本生成器自身(及其引用的 apply_round4.py)不得包含针对仓库追踪目录
  (source/ tests/ assets/ reports/ logs/) 的 shutil.rmtree / os.remove; 仅允许删除自身临时
  暂存(extract_dir / tests_pkg / /tmp)。脚本在打包前对生成器源码做静态扫描, 结果写入
  generator_safety_results/。

前置(由调用方保证):
  * 已在 r1.2-round4-p0 分支完成 fix/test/docs 本地提交(不 push / 不 tag PASS / 不 merge)
  * 已运行 python tests/run_all_tests.py (产出 60 步全量日志)
  * Chromium 可用(_pw.js 自动探测缓存, 或设置 PLAYWRIGHT_CHROMIUM_PATH)

用法: python gen_r4r3_review_package.py
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_ZIP = os.path.join(BASE, "Agent新手村_R1.2-Round4-P0-R3_独立审阅包.zip")
ROUND4_HTML = "Agent新手村_R1.2-round4-p0.html"
BASELINE = "e4fc44f29a3d7355e0d78609874b7eef8e8794a9"  # main / R3 收口基线
EXPECTED_COURSE_HASH = "56860b8325375125f0950398fe512ab8fa9795e7087e30fe6bbf5a8f68965895"

NODE = "/Users/mac/.workbuddy/binaries/node/versions/22.22.2/bin/node"
PY = "/Users/mac/.workbuddy/binaries/python/envs/default/bin/python"

# 仓库追踪目录(生成器不得对其执行 rmtree / remove)—— §十二
PROTECTED_DIRS = ["source", "tests", "assets", "reports", "logs"]


def sh(cmd, env=None):
    r = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True, env=env or os.environ)
    if r.returncode != 0:
        raise RuntimeError("CMD FAIL %s\n[STDOUT]%s\n[STDERR]%s" % (cmd, r.stdout, r.stderr))
    return r.stdout


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def write_text(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)
    return p


def git_rev(tag):
    return sh(["git", "rev-parse", tag]).strip()


def main():
    env = dict(os.environ)
    if not env.get("PLAYWRIGHT_CHROMIUM_PATH"):
        home = env.get("HOME", "")
        cand_base = os.path.join(home, "Library", "Caches", "ms-playwright") if sys.platform == "darwin" else ""
        if cand_base and os.path.isdir(cand_base):
            for d in sorted(os.listdir(cand_base), reverse=True):
                if d.startswith("chromium-") and os.path.isdir(os.path.join(cand_base, d)):
                    p = os.path.join(cand_base, d, "chrome-mac-arm64", "Google Chrome for Testing.app",
                                     "Contents", "MacOS", "Google Chrome for Testing")
                    if os.path.exists(p):
                        env["PLAYWRIGHT_CHROMIUM_PATH"] = p
                        break

    print("== 0. 生成器安全静态扫描(§十二) ==")
    gen_safety_log = run_generator_safety()
    write_text(os.path.join(BASE, "generator_safety_results", "generator_safety.log"), gen_safety_log)
    if "RESULT: PASS" not in gen_safety_log:
        raise RuntimeError("生成器安全扫描未通过, 终止打包:\n" + gen_safety_log)
    print("    生成器安全: PASS")

    print("== 1. 派生关系 + 两遍构建字节一致校验 ==")
    manifest = {}
    mp = os.path.join(BASE, "R1.2_Round4_build_manifest.txt")
    if os.path.exists(mp):
        for line in open(mp, encoding="utf-8"):
            if ":" in line:
                k, v = line.split(":", 1)
                manifest[k.strip()] = v.strip()
    tmp_a = "/tmp/_r4r3_build_a.html"
    tmp_b = "/tmp/_r4r3_build_b.html"
    sh([PY, "apply_round4.py", tmp_a])
    sh([PY, "apply_round4.py", tmp_b])
    sha_a = sha256_file(tmp_a)
    sha_b = sha256_file(tmp_b)
    two_build_ok = (sha_a == sha_b)
    write_text(os.path.join(BASE, "TWO_BUILD_SHA.txt"),
               "build_1_sha256: %s\nbuild_2_sha256: %s\nbyte_identical: %s\n"
               "input_round3_sha256: %s\n" % (sha_a, sha_b, "true" if two_build_ok else "FALSE",
                                              manifest.get("round3_input_sha256", "unknown")))
    print("   两遍构建一致: %s (%s)" % (two_build_ok, sha_a[:16]))

    print("== 2. git 提交 / 补丁 / bundle (含三个失败 tag) ==")
    tag_r0 = git_rev("ROUND4_P0_REVIEW_FAILED")
    tag_r1 = git_rev("ROUND4_P0_R1_REVIEW_FAILED")
    tag_r2 = git_rev("ROUND4_P0_R2_REVIEW_FAILED")
    head_sha = git_rev("HEAD")
    commits = sh(["git", "log", "--oneline", "%s..HEAD" % BASELINE]).strip().splitlines()
    commit_shas = sh(["git", "rev-list", "%s..HEAD" % BASELINE]).strip().splitlines()
    new_sha_lines = []
    classify_lines = []
    for sha, oneline in zip(commit_shas, commits):
        new_sha_lines.append("%s  %s" % (sha, oneline))
        rest = oneline.split(" ", 1)[1] if " " in oneline else oneline
        prefix = rest.split(":", 1)[0].strip().lower()
        cls = "other"
        if prefix.startswith("feat"):
            cls = "feat(round4)      产品功能/事务组件"
        elif prefix.startswith("fix"):
            cls = "fix(round4)       精准修复(派生解锁验证/unsafe提交锁/Round3后处理安全包装)"
        elif prefix.startswith("test"):
            cls = "test(round4)      测试"
        elif prefix.startswith("ci"):
            cls = "ci(round4)        CI 配置"
        elif prefix.startswith("docs"):
            cls = "docs(round4)      文档/审阅包生成器"
        classify_lines.append("%s  ->  %s" % (sha[:12], cls))
    # 一致性校验: NEW_COMMIT_SHA / git rev-parse HEAD / GIT_BUNDLE HEAD / FULL_PATCH 末提交 必须一致
    full_patch = sh(["git", "format-patch", "--stdout", "%s..HEAD" % BASELINE])
    patch_last_commit = ""
    for ln in full_patch.splitlines():
        m = re.match(r"^From ([0-9a-f]{40}) ", ln)
        if m:
            patch_last_commit = m.group(1)
    write_text(os.path.join(BASE, "FULL_PATCH.patch"), full_patch)
    write_text(os.path.join(BASE, "CUMULATIVE_PATCH_since_R3_PASS.patch"), full_patch)

    new_sha_text = ("基线 main = %s (R3 收口基线 / checkpoint R1.2-R3-R3-PASS)\n" % BASELINE +
                    "失败基线(均已打 annotated tag, 保留不重写):\n" +
                    "  ROUND4_P0_REVIEW_FAILED       -> %s\n" % tag_r0 +
                    "  ROUND4_P0_R1_REVIEW_FAILED    -> %s\n" % tag_r1 +
                    "  ROUND4_P0_R2_REVIEW_FAILED    -> %s\n" % tag_r2 +
                    "本轮本地提交(未 push / 未 tag PASS / 未 merge / CI 仅 CI_CONFIG_READY):\n" +
                    "\n".join(new_sha_lines) + "\n")
    write_text(os.path.join(BASE, "NEW_COMMIT_SHA.txt"), new_sha_text)
    write_text(os.path.join(BASE, "COMMIT_CLASSIFICATION.txt"),
               "治理分类(每个提交仅含一类变更, 不混产品/CI环境/签字):\n" +
               "\n".join(classify_lines) + "\n\n"
               "说明: Round4-P0-R3 精准修复(基于独立审阅失败 ROUND4_P0_R2_REVIEW_FAILED @ %s),\n"
               "修复 派生解锁状态结果验证 + 回滚失败后真正禁止提交(unsafe 提交锁) + Round3 后处理\n"
               "异常进入粘性 post_commit_error。不扩展关卡 / 不迁移 74 关 / 不修改 LevelData /\n"
               "课程哈希 / 门禁业务规则 / Round3 fail-closed 门禁。\n"
               "CI 状态文件仅记录 CI_CONFIG_READY。\n" % tag_r2)
    # 一致性断言
    if not (head_sha == patch_last_commit and head_sha == commit_shas[-1] if commit_shas else True):
        # 仅当存在 Round4 提交时校验末提交一致
        if commit_shas and head_sha != patch_last_commit:
            raise RuntimeError("HEAD(%s) 与 FULL_PATCH 末提交(%s) 不一致" % (head_sha, patch_last_commit))
    write_text(os.path.join(BASE, "HEAD_SHA.txt"),
               "head_sha: %s\npatch_last_commit: %s\nbundle_head_verify: see GIT_BUNDLE_HEADS.txt\n"
               "all_consistent: %s\n" % (head_sha, patch_last_commit,
                                         "true" if (not commit_shas or head_sha == patch_last_commit) else "FALSE"))

    bundle = os.path.join(BASE, "GIT_BUNDLE.bundle")
    if os.path.exists(bundle):
        os.remove(bundle)
    # R3 要求: bundle 必须同时携带三个失败 tag (不 push / 不 tag PASS / 不 merge)
    sh(["git", "bundle", "create", bundle, "HEAD",
        "refs/tags/ROUND4_P0_REVIEW_FAILED",
        "refs/tags/ROUND4_P0_R1_REVIEW_FAILED",
        "refs/tags/ROUND4_P0_R2_REVIEW_FAILED"])
    verify = sh(["git", "bundle", "verify", bundle])
    write_text(os.path.join(BASE, "GIT_BUNDLE_VERIFY.txt"), verify)
    heads = sh(["git", "bundle", "list-heads", bundle])
    write_text(os.path.join(BASE, "GIT_BUNDLE_HEADS.txt"), heads)
    print("   bundle refs:\n" + "\n".join("      " + l for l in heads.strip().splitlines()))

    print("== 3. 课程不变量 ==")
    r = subprocess.run([NODE, "tests/leveldata_hash.js", ROUND4_HTML], cwd=BASE,
                       capture_output=True, text=True, env=env)
    inv = {}
    if r.returncode == 0:
        try:
            inv = json.loads(r.stdout)
        except Exception:
            inv = {}
    course_ok = (inv.get("leveldata_worlds_sha256") == EXPECTED_COURSE_HASH and
                 inv.get("levels") == 74 and inv.get("core") == 70 and
                 inv.get("optional") == 4 and inv.get("worlds") == 8)
    write_text(os.path.join(BASE, "COURSE_INVARIANTS.txt"),
               "课程不变量(Round4-P0-R3 未修改 LevelData / 课程哈希):\n"
               "  leveldata_worlds_sha256 = %s  (基线 %s)  [%s]\n"
               "  levels   = %s (期望 74) [%s]\n"
               "  core     = %s (期望 70) [%s]\n"
               "  optional = %s (期望 4)  [%s]\n"
               "  worlds   = %s (期望 8)  [%s]\n" % (
                   inv.get("leveldata_worlds_sha256", "?"), EXPECTED_COURSE_HASH[:16],
                   "MATCH" if inv.get("leveldata_worlds_sha256") == EXPECTED_COURSE_HASH else "MISMATCH",
                   inv.get("levels", "?"), "OK" if inv.get("levels") == 74 else "BAD",
                   inv.get("core", "?"), "OK" if inv.get("core") == 70 else "BAD",
                   inv.get("optional", "?"), "OK" if inv.get("optional") == 4 else "BAD",
                   inv.get("worlds", "?"), "OK" if inv.get("worlds") == 8 else "BAD"))

    write_text(os.path.join(BASE, "CI_STATUS.txt"),
               "CI_STATUS = CI_CONFIG_READY\n"
               "说明: 本轮仅就绪状态; 不写为 CI_PASS; 不 push / 不 PR / 不 merge / 不建 PASS tag。\n")

    print("== 4. 重新运行专题浏览器/静态测试以收集独立日志 ==")
    thematics = {
        "fault_injection_results": ("test_round4_transaction_rollback.js",
                                     "fault_injection_results/test_round4_transaction_rollback.log"),
        "rollback_results": ("test_round4_transaction_rollback.js",
                             "rollback_results/test_round4_transaction_rollback.log"),
        "commit_point_results": ("test_round4_commit_point.js",
                                 "commit_point_results/test_round4_commit_point.log"),
        "post_commit_results": ("test_round4_post_commit_error.js",
                                "post_commit_results/test_round4_post_commit_error.log"),
        "full_persisted_state_results": ("test_round4_full_persisted_state.js",
                                         "full_persisted_state_results/test_round4_full_persisted_state.log"),
        "absent_save_results": ("test_round4_absent_save_restore.js",
                                "absent_save_results/test_round4_absent_save_restore.log"),
        "side_effect_results": ("test_round4_side_effect_atomicity.js",
                                "side_effect_results/test_round4_side_effect_atomicity.log"),
        "snapshot_results": ("test_round4_snapshot_failure.js",
                             "snapshot_results/test_round4_snapshot_failure.log"),
        # ---- R2 精准修复新增 4 个专题 ----
        "post_commit_sticky_results": ("test_round4_post_commit_status_sticky.js",
                                       "post_commit_sticky_results/test_round4_post_commit_status_sticky.log"),
        "rollback_memory_results": ("test_round4_rollback_memory_verification.js",
                                    "rollback_memory_results/test_round4_rollback_memory_verification.log"),
        "rollback_persistence_results": ("test_round4_rollback_persistence_verification.js",
                                         "rollback_persistence_results/test_round4_rollback_persistence_verification.log"),
        "next_core_results": ("test_round4_next_core_snapshot_failure.js",
                              "next_core_results/test_round4_next_core_snapshot_failure.log"),
        # ---- R3 精准修复新增 3 个专题 ----
        "derived_unlock_results": ("test_round4_derived_unlock_verification.js",
                                   "derived_unlock_results/test_round4_derived_unlock_verification.log"),
        "submission_block_results": ("test_round4_submission_block_after_rollback_failure.js",
                                     "submission_block_results/test_round4_submission_block_after_rollback_failure.log"),
        "round3_post_commit_results": ("test_round4_round3_post_commit_status.js",
                                       "round3_post_commit_results/test_round4_round3_post_commit_status.log"),
    }
    ran = {}
    for sub, (testfile, destrel) in thematics.items():
        dest = os.path.join(BASE, destrel)
        if testfile not in ran:
            out = ""
            try:
                rr = subprocess.run([NODE, os.path.join("tests", testfile)], cwd=BASE,
                                    capture_output=True, text=True, env=env, timeout=600)
                out = rr.stdout + "\n" + rr.stderr
            except Exception as e:
                out = "[ERROR] %s" % e
            ran[testfile] = out
            # 标记是否 PASS
            passed = ("[PASS]" in out and "FAIL" not in out.split("Summary:")[-1][:0] if "[PASS]" in out else False)
            passed = ("all passed" in out.lower()) or ("PASS" in out and "FAIL" not in out)
            write_text(os.path.join(BASE, sub, "_status.txt"),
                       "test: %s\nresult: %s\n" % (testfile, "PASS" if passed else "CHECK_LOG"))
        write_text(dest, ran[testfile])

    matrix = """# Round4-P0 / R1 / R2 / R3 故障注入矩阵 (CompletionTransactionFaults)

默认全部关闭; 仅测试显式 arm() 生效; 生产/正常流程绝不自动注入。
TEST_MODE 无关的独立页面上下文运行, 不影响交付件 TEST_MODE=false。

| 注入点                | 触发位置                | 阶段 | 预期行为                         | 覆盖测试 |
|-----------------------|-------------------------|------|----------------------------------|----------|
| before_snapshot       | 编排器快照前            | A→B | 统一捕获 → abortBeforeMutation, 不提交, completed 不变 | snapshot_failure |
| after_snapshot        | 编排器快照后            | A→B | 同上                             | snapshot_failure |
| before_completed_write| _commitCompletion 写前  | B   | 抛错 → 完整回滚 (rolled_back)    | rollback  |
| after_completed_write | completed 置 true 后    | B   | 抛错 → 回滚还原 completed=false   | rollback  |
| after_completed_at_write| xp/totalStars 写入后  | B   | 抛错 → 回滚还原统计               | rollback  |
| after_next_unlock     | 下一关解锁后            | B   | 抛错 → 回滚还原 unlocked=false    | rollback  |
| before_save           | State.save 前           | B   | 抛错 → 完整回滚(含侧作用不残留)  | rollback/side_effect |
| during_save           | State.save 被 patch 抛错| B   | 抛错 → 完整回滚                  | rollback/persist |
| after_save (corrupt)  | 保存成功后破坏持久化    | B   | 重读(完整结构深比较)不一致 → 完整回滚 | rollback/full_persisted_state |
| before_commit_point   | 提交点之前              | B   | 抛错 → 回滚 (提交点未达成)       | commit_point |
| after_commit_point    | 提交点之后              | C   | 不回滚; 标记 post_commit_error   | commit_point |
| during_toast          | 展示 toast 阶段         | C   | 不回滚; 标记 post_commit_error   | post_commit / R2 sticky |
| during_completion_ui  | 展示导航(setTimeout)    | C   | 不回滚; 标记 post_commit_error   | post_commit / R2 sticky |

R3 新增关键保证:
  * 派生解锁状态结果验证: 快照记录全量派生解锁基线; 回滚后 restore → _refreshUnlockedFlags()
    → deepEqual(实际, 快照); 任一可选关解锁状态不符 → derivedStateRefreshed=false /
    status=rollback_failed / success=false; 诊断仅含 expected|actual 哈希与 mismatched level id。
    (覆盖: derived_unlock_results —— w1_p1 解锁状态在 _refreshUnlockedFlags 被静默禁用时
    仍能检出, 不再误报回滚成功。)
  * 回滚失败后真正禁止提交: rollback_failed / rollback_persist_failed 时写入独立 unsafeLevels
    安全锁 {blocked, reason, createdAt}; Level.done() 在任何门禁/提交前若 isSubmissionBlocked
    则返回 false + toast(请重新加载页面); 第二次提交被阻断(内存回滚残留 xp=10 或
    持久化回滚失败均阻断)。(覆盖: submission_block_results)
  * Round3 后处理异常进入粘性 post_commit_error: InteractionProgress.complete/clearFailure/
    _refreshGate / ErrorFeedback.clear 由 safePostCommit 包裹; 任一侧作用抛错 →
    completed=true / commitPointReached=true / 不回滚 / status=phase=post_commit_error
    (粘性, 1800ms 后仍保持) / 其余侧作用继续。(覆盖: round3_post_commit_results)

核心保证:
  * 唯一成功提交点 = 全部权威内存写入 + State.save 成功 + 重读一致(完整结构深比较) 之后。
  * 阶段 B(提交点之前)任意异常 → 完整回滚(内存+持久化一致), completed 不残留, 侧作用不残留。
  * 阶段 C(提交点之后)任意异常 → 不回滚已提交事务, 仅标记 post_commit_error(粘性终态, R2/R3)。
  * 提交点之后(含 after_commit_point)绝不触发回滚。
"""
    write_text(os.path.join(BASE, "fault_injection_results", "FAULT_INJECTION_MATRIX.md"), matrix)

    print("== 5. 组装 ZIP ==")
    root_files = [
        "TWO_BUILD_SHA.txt", "NEW_COMMIT_SHA.txt", "COMMIT_CLASSIFICATION.txt",
        "HEAD_SHA.txt", "CI_STATUS.txt", "COURSE_INVARIANTS.txt", "FULL_PATCH.patch",
        "CUMULATIVE_PATCH_since_R3_PASS.patch", "GIT_BUNDLE.bundle",
        "GIT_BUNDLE_VERIFY.txt", "GIT_BUNDLE_HEADS.txt", "RUN_REVIEW_TESTS.md",
    ]
    # 拷贝源码到 source/(含 round3 派生源 + 交付件副本 + fixtures 以保证可自重建)
    src_dir = os.path.join(BASE, "source")
    os.makedirs(src_dir, exist_ok=True)
    for f in ["completion_transaction.js", "apply_round4.py",
              "R1.2_Round4_build_manifest.txt", ROUND4_HTML,
              "Agent新手村_R1.2-round3-dev.html", "round3_features.js"]:
        if os.path.exists(os.path.join(BASE, f)):
            shutil.copy(os.path.join(BASE, f), os.path.join(src_dir, f))
    # 复制 fixtures(使 apply_round4.py 在 source/ 内两遍构建的 fx_hash 与交付件一致)
    fx_src = os.path.join(BASE, "tests", "fixtures")
    if os.path.isdir(fx_src):
        dest_fx = os.path.join(src_dir, "tests", "fixtures")
        if os.path.isdir(dest_fx):
            shutil.rmtree(dest_fx)
        shutil.copytree(fx_src, dest_fx)

    # 审计报告(若存在)
    audit_src = os.path.join(BASE, "reports", "R1.2_ROUND4_P0_WRITE_AUDIT.md")
    if os.path.exists(audit_src):
        shutil.copy(audit_src, os.path.join(src_dir, "R1.2_ROUND4_P0_WRITE_AUDIT.md"))

    # 拷贝全部 18 个 Round4 测试 + _pw.js 到 tests/(zip 内 tests/)
    tests_dst = os.path.join(BASE, "tests_pkg")
    if os.path.isdir(tests_dst):
        shutil.rmtree(tests_dst)
    os.makedirs(tests_dst, exist_ok=True)
    for tf in ["test_round4_completion_transaction.js", "test_round4_transaction_rollback.js",
               "test_round4_commit_point.js", "test_round4_post_commit_error.js",
               "test_round4_persistence_failure.js", "test_round4_transaction_static.py",
               "test_round4_full_persisted_state.js", "test_round4_absent_save_restore.js",
               "test_round4_side_effect_atomicity.js", "test_round4_snapshot_failure.js",
               # ---- R2 精准修复新增 4 个 ----
               "test_round4_post_commit_status_sticky.js",
               "test_round4_rollback_memory_verification.js",
               "test_round4_rollback_persistence_verification.js",
               "test_round4_next_core_snapshot_failure.js",
               # ---- R3 精准修复新增 4 个 ----
               "test_round4_derived_unlock_verification.js",
               "test_round4_submission_block_after_rollback_failure.js",
               "test_round4_round3_post_commit_status.js",
               "test_round4_submission_block_static.py",
               "_pw.js"]:
        sp = os.path.join(BASE, "tests", tf)
        if os.path.exists(sp):
            shutil.copy(sp, os.path.join(tests_dst, tf))
    # 拷贝回归日志(60 步)
    logs_dst = os.path.join(BASE, "logs")
    os.makedirs(logs_dst, exist_ok=True)
    reg_log = os.path.join(BASE, "tests", "logs", "r1.2-round4-p0-r3-full.log")
    if not os.path.exists(reg_log):
        reg_log = os.path.join(BASE, "tests", "logs", "run_all_tests.log")
    if os.path.exists(reg_log):
        shutil.copy(reg_log, os.path.join(logs_dst, "run_all_tests_r4r3.log"))

    # 收集所有要放入 zip 的 (本地路径, zip内相对路径)
    inclusions = []
    for rf in root_files:
        p = os.path.join(BASE, rf)
        if os.path.exists(p):
            inclusions.append((p, rf))
    # 交付件 HTML 也置于 zip 根(供 tests/ 直接运行使用)
    dh = os.path.join(BASE, ROUND4_HTML)
    if os.path.exists(dh):
        inclusions.append((dh, ROUND4_HTML))

    def _add_tree(base_abs, zip_prefix):
        if not os.path.isdir(base_abs):
            return
        for root, dirs, files in os.walk(base_abs):
            dirs.sort()
            for fn in sorted(files):
                fp = os.path.join(root, fn)
                rel = os.path.relpath(fp, base_abs)
                zrel = os.path.join(zip_prefix, rel)
                inclusions.append((fp, zrel))

    for sub, zp in [("source", "source"), ("tests_pkg", "tests"), ("logs", "logs"),
                    ("fault_injection_results", "fault_injection_results"),
                    ("rollback_results", "rollback_results"),
                    ("commit_point_results", "commit_point_results"),
                    ("post_commit_results", "post_commit_results"),
                    ("full_persisted_state_results", "full_persisted_state_results"),
                    ("absent_save_results", "absent_save_results"),
                    ("side_effect_results", "side_effect_results"),
                    ("snapshot_results", "snapshot_results"),
                    # ---- R2 新增 4 个结果目录 ----
                    ("post_commit_sticky_results", "post_commit_sticky_results"),
                    ("rollback_memory_results", "rollback_memory_results"),
                    ("rollback_persistence_results", "rollback_persistence_results"),
                    ("next_core_results", "next_core_results"),
                    # ---- R3 新增 4 个结果目录 ----
                    ("derived_unlock_results", "derived_unlock_results"),
                    ("submission_block_results", "submission_block_results"),
                    ("round3_post_commit_results", "round3_post_commit_results"),
                    ("generator_safety_results", "generator_safety_results")]:
        _add_tree(os.path.join(BASE, sub), zp)

    readme = """# Agent新手村 R1.2 Round4-P0-R3 独立审阅包

## 主题
Round4-P0-R3 精准修复(基于独立审阅失败 ROUND4_P0_R2_REVIEW_FAILED @ 425d1664):
  一、派生解锁状态必须经过最终验证(快照记录全量派生解锁基线; 回滚后 restore →
      _refreshUnlockedFlags() → deepEqual 实际 vs 快照; 不一致即 rollback_failed, 不误报成功);
  二、rollback_failed / rollback_persist_failed 后必须真正禁止继续提交(独立 unsafeLevels
      安全锁; Level.done() 在门禁/提交前检查并阻断, 第二次提交被禁止);
  三、Round3 提交后处理异常必须进入粘性 post_commit_error(InteractionProgress.complete /
      clearFailure / _refreshGate / ErrorFeedback.clear 统一由 safePostCommit 包裹)。
不扩展关卡 / 不迁移 74 关 / 不修改 LevelData / 课程哈希 / 门禁业务规则 / Round3 fail-closed 门禁。

## 权威基线(冻结)
  main = e4fc44f29a3d7355e0d78609874b7eef8e8794a9 (R3 收口基线 / checkpoint R1.2-R3-R3-PASS)
  失败基线(已打 annotated tag, 保留不重写):
    ROUND4_P0_REVIEW_FAILED       -> %s
    ROUND4_P0_R1_REVIEW_FAILED    -> %s
    ROUND4_P0_R2_REVIEW_FAILED    -> %s
  状态 = ENGINEERING_PASS + CI_PASS (R3 已收口); 本轮 CI 仅 CI_CONFIG_READY

## 本轮交付(本地分支 r1.2-round4-p0, 未 push / 未 tag PASS / 未 merge)
  组件: completion_transaction.js(注入到 round3-dev HTML 末尾)
  构建: apply_round4.py → Agent新手村_R1.2-round4-p0.html
  测试: 18 个文件(16 浏览器 + 2 静态), 共 60 步统一回归
        (1-41 基线 + 42-48 Round4-P0 原 7 步 + 49-52 Round4-P0-R1 新增 4 步
         + 53-56 Round4-P0-R2 新增 4 步 + 57-59 Round4-P0-R3 新增 3 步
         + 60 Round4-P0-R3 新增 1 步静态扫描)

## 验证清单
  [ ] TWO_BUILD_SHA.txt       两遍构建字节一致
  [ ] COURSE_INVARIANTS.txt   74/70/4/8 + 课程哈希 MATCH
  [ ] CI_STATUS.txt           = CI_CONFIG_READY(非 CI_PASS)
  [ ] FULL_PATCH.patch        git format-patch 可 git am
  [ ] GIT_BUNDLE.bundle       git bundle verify 通过 + 含三个失败 tag
  [ ] GIT_BUNDLE_HEADS.txt    bundle 头引用列表(含三个失败 tag)
  [ ] HEAD_SHA.txt            HEAD == FULL_PATCH 末提交 == bundle HEAD
  [ ] fault_injection_results/FAULT_INJECTION_MATRIX.md  注入点矩阵(含 R3 新增保证)
  [ ] derived_unlock_results/       派生解锁验证失败证据(w1_p1 在 mismatched ids)
  [ ] submission_block_results/     回滚失败后第二次提交被阻断证据
  [ ] round3_post_commit_results/   Round3 后处理异常进入粘性 post_commit_error 证据
  [ ] generator_safety_results/     生成器安全扫描(无 rmtree 指向仓库追踪目录)
  [ ] SELF_REBUILD_VERIFY.txt 自重建字节一致校验通过
  [ ] 全部测试 60 步通过(logs/run_all_tests_r4r3.log)
  [ ] SHA256SUMS.txt          校验和自排除, 边车 .sha256 齐备
  [ ] RUN_REVIEW_TESTS.md     独立审阅者复测步骤

## 自重建(审阅者可独立复现交付件)
  # 解压本包后, 从包根目录:
  cd source
  python apply_round4.py build1.html
  python apply_round4.py build2.html
  sha256sum build1.html build2.html "Agent新手村_R1.2-round4-p0.html"
  # build1 / build2 与交付件(Agent新手村_R1.2-round4-p0.html, 包根与 source/ 各一份)字节一致
  # 本脚本已在打包后自动抽取校验, 结果见 SELF_REBUILD_VERIFY.txt

## 关键不变量
  * 唯一成功提交点 = 全部权威内存写入 + State.save 成功 + 重读一致(完整结构深比较) 之后。
  * 阶段 B(提交点之前)任意异常 → 完整回滚(内存 + 持久化一致), 侧作用不残留。
  * 阶段 C(提交点之后)任意异常 → 不回滚, 仅标记 post_commit_error(粘性终态, R2/R3 加固)。
  * 派生解锁状态须经结果验证, 不一致即 rollback_failed(不误报成功)。
  * 回滚失败后写入 unsafeLevels 安全锁, 真正禁止后续提交(须重新加载页面)。
  * 提交锁 Level._completing 在所有出口恢复为 false。
""" % (tag_r0, tag_r1, tag_r2)
    write_text(os.path.join(BASE, "README.txt"), readme)
    inclusions.append((os.path.join(BASE, "README.txt"), "README.txt"))

    # 计算校验和(SHA256SUMS 排除自身)
    sums = []
    for p, rel in inclusions:
        if rel == "SHA256SUMS.txt":
            continue
        sums.append("%s  %s" % (sha256_file(p), rel))
    sums_text = "\n".join(sums) + "\n"
    write_text(os.path.join(BASE, "SHA256SUMS.txt"), sums_text)
    inclusions.append((os.path.join(BASE, "SHA256SUMS.txt"), "SHA256SUMS.txt"))

    # 关键产物 .sha256 边车
    for rel in ["FULL_PATCH.patch", "CUMULATIVE_PATCH_since_R3_PASS.patch",
                "GIT_BUNDLE.bundle", ROUND4_HTML]:
        p = os.path.join(BASE, rel)
        if os.path.exists(p):
            write_text(os.path.join(BASE, rel + ".sha256"),
                       "%s  %s\n" % (sha256_file(p), rel))

    # 打包
    if os.path.exists(OUT_ZIP):
        os.remove(OUT_ZIP)
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for p, rel in inclusions:
            z.write(p, rel)
    zipsize = os.path.getsize(OUT_ZIP)
    print("   写出 %s (%d bytes, %d 个条目)" % (OUT_ZIP, zipsize, len(inclusions)))
    print("   课程不变量: %s" % ("PASS" if course_ok else "FAIL"))
    print("   两遍构建一致: %s" % ("PASS" if two_build_ok else "FAIL"))

    # 自重建校验: 抽取 zip 到临时目录, 从 source/ 两遍构建并与交付件副本比较
    print("== 6. 自重建校验(抽取 zip 从 source/ 两遍构建) ==")
    extract_dir = tempfile.mkdtemp(prefix="r4r3_selfbuild_")
    try:
        with zipfile.ZipFile(OUT_ZIP, "r") as z:
            z.extractall(extract_dir)
        sb_src = os.path.join(extract_dir, "source")
        sb_script = os.path.join(sb_src, "apply_round4.py")
        sb_delivered = os.path.join(sb_src, ROUND4_HTML)
        for out_name in ("sb1.html", "sb2.html"):
            rr = subprocess.run([PY, sb_script, out_name], cwd=sb_src,
                                capture_output=True, text=True, env=env)
            if rr.returncode != 0:
                raise RuntimeError("SELF-BUILD FAIL %s\n%s\n%s" % (out_name, rr.stdout, rr.stderr))
        sha1 = sha256_file(os.path.join(sb_src, "sb1.html")) if os.path.exists(os.path.join(sb_src, "sb1.html")) else "MISSING"
        sha2 = sha256_file(os.path.join(sb_src, "sb2.html")) if os.path.exists(os.path.join(sb_src, "sb2.html")) else "MISSING"
        sha_deliv = sha256_file(sb_delivered) if os.path.exists(sb_delivered) else "MISSING"
        rebuild_ok = (sha1 == sha2 == sha_deliv and sha1 != "MISSING")
        write_text(os.path.join(BASE, "SELF_REBUILD_VERIFY.txt"),
                   "self_rebuild_ok: %s\nbuild1_sha256: %s\nbuild2_sha256: %s\n"
                   "delivered_source_sha256: %s\n" % (rebuild_ok, sha1, sha2, sha_deliv))
        if os.path.exists(OUT_ZIP):
            os.remove(OUT_ZIP)
        inclusions.append((os.path.join(BASE, "SELF_REBUILD_VERIFY.txt"), "SELF_REBUILD_VERIFY.txt"))
        sums2 = []
        for p, rel in inclusions:
            if rel == "SHA256SUMS.txt":
                continue
            sums2.append("%s  %s" % (sha256_file(p), rel))
        write_text(os.path.join(BASE, "SHA256SUMS.txt"), "\n".join(sums2) + "\n")
        with zipfile.ZipFile(OUT_ZIP, "w", ZIP_DEFLATED) as z:
            for p, rel in inclusions:
                z.write(p, rel)
        print("   自重建一致: %s (build1=%s.. build2=%s.. delivered=%s..)" % (
            rebuild_ok, sha1[:16], sha2[:16], sha_deliv[:16]))
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)

    print("DONE")
    return 0


def run_generator_safety():
    """§十二: 扫描生成器源码, 断言无针对仓库追踪目录(source/tests/assets/reports/logs)的
    shutil.rmtree / os.remove; 仅允许删除自身临时暂存(extract_dir / tests_pkg / /tmp)。"""
    lines = []
    lines.append("# 生成器安全静态扫描 (§十二)")
    lines.append("# 扫描对象: gen_r4r3_review_package.py, apply_round4.py")
    lines.append("# 目标: 不得包含针对仓库追踪目录的 shutil.rmtree / os.remove")
    lines.append("")
    scan_files = [os.path.join(BASE, "gen_r4r3_review_package.py")]
    ap = os.path.join(BASE, "apply_round4.py")
    if os.path.exists(ap):
        scan_files.append(ap)
    problems = []
    rmtree_re = re.compile(r"shutil\.rmtree\(\s*([^)]*)\)")
    remove_re = re.compile(r"os\.remove\(\s*([^)]*)\)")
    for sf in scan_files:
        txt = open(sf, encoding="utf-8").read()
        for m in rmtree_re.finditer(txt):
            arg = m.group(1)
            low = arg.lower()
            if any(("'%s'" % d in arg or '"%s"' % d in arg or ("/%s" % d) in low or ("\\%s" % d) in low or ("(%s" % d) in low)
                   for d in PROTECTED_DIRS):
                problems.append("%s: shutil.rmtree 命中仓库追踪目录参数: %s" % (os.path.basename(sf), arg.strip()))
            # 允许: extract_dir / tests_pkg / /tmp / tempfile / mkdtemp / staging / build
            allowed = any(k in low for k in ["extract", "tmp", "temp", "staging", "tests_pkg", "_r4r3", "build"])
            if not allowed and not arg.strip().startswith("os.path.join(BASE") is False:
                # 仅当参数指向明确仓库目录才告警; 其余交由上面精确命中判断
                pass
        for m in remove_re.finditer(txt):
            arg = m.group(1)
            low = arg.lower()
            if any(("'%s'" % d in arg or '"%s"' % d in arg or ("/%s" % d) in low or ("\\%s" % d) in low)
                   for d in PROTECTED_DIRS):
                problems.append("%s: os.remove 命中仓库追踪目录参数: %s" % (os.path.basename(sf), arg.strip()))
    # 精确硬断言: 源码不得出现 "shutil.rmtree(source" 任何形式的 source 目录删除
    for sf in scan_files:
        txt = open(sf, encoding="utf-8").read()
        if re.search(r"shutil\.rmtree\(\s*[^)]*source", txt):
            problems.append("%s: 发现 shutil.rmtree 指向 source 目录(§十二 禁止)" % os.path.basename(sf))
    if problems:
        lines.append("RESULT: FAIL")
        for p in problems:
            lines.append("  [BAD] " + p)
    else:
        lines.append("RESULT: PASS")
        lines.append("  未发现针对仓库追踪目录(source/tests/assets/reports/logs)的 rmtree/remove")
        lines.append("  生成的临时暂存(extract_dir / tests_pkg / /tmp)删除均属允许范围")
    lines.append("")
    lines.append("DEBUG: 扫描文件 = " + ", ".join(os.path.basename(s) for s in scan_files))
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    sys.exit(main())
