# -*- coding: utf-8 -*-
"""gen_r4r2_review_package.py — 生成 Agent新手村 R1.2 Round4-P0-R2 独立审阅包。

产物: Agent新手村_R1.2-Round4-P0-R2_独立审阅包.zip (+ .sha256 边车)

R2 精准修复专项(基于独立审阅失败 ROUND4_P0_R1_REVIEW_FAILED @ 1aebf616):
  一、post_commit_error 必须是粘性终态: finish() 不得用 committed 覆盖 post_commit_error;
      markPostCommitError 使用 status=phase='post_commit_error'(绝不 rendering);
      clearDraft/LearningLog/Artifact/starBurst 任一侧作用抛错 → 已完成 committed 状态保持,
      其他侧作用继续, 立即 post_commit_error, 1800ms 后仍为 post_commit_error, finish() 不覆盖, 诊断含 scope。
  二、内存回滚必须完整验证: rollback() 不得提前置 memoryRestored=true; 恢复后递归深比较
      当前关/下一关/State.currentLevel/totalStars/xp/achievements; 任一不符 →
      memoryRestored=false / status=rollback_failed / success=false / 提示重载。
  三、持久化回滚必须写后重读验证: 恢复后重读 localStorage; 不一致 → persistenceRestored=false /
      status=rollback_persist_failed / success=false / 禁止提交 / 提示重载 / 诊断 expected|actual。
  四、派生状态刷新单独统计: result.success = memoryRestored && persistenceRestored && derivedStateRefreshed。
  五、nextCoreOf 不得静默吞异常: catch(e){ R3D.record(...); throw e; }; 若 getNextCoreLevel 抛错 →
      快照失败 → status=preflight_failed / completed=false / 无权威写入 / Level._completing=false。
  六、增加回滚不可变证据: rollbackVerification{ memoryExpectedHash, memoryActualHash,
      persistenceExpectedHash, persistenceActualHash }(仅诊断哈希, 不记录完整用户存档内容)。

不扩展关卡 / 不迁移 74 关 / 不修改 LevelData / 课程哈希 / 门禁业务规则 / Round3 fail-closed 门禁。

包结构(与 R1 一致并扩展):
  README.txt / RUN_REVIEW_TESTS.md / NEW_COMMIT_SHA.txt / COMMIT_CLASSIFICATION.txt
  FULL_PATCH.patch / CUMULATIVE_PATCH_since_R3_PASS.patch / GIT_BUNDLE.bundle
  GIT_BUNDLE_VERIFY.txt / GIT_BUNDLE_HEADS.txt / TWO_BUILD_SHA.txt / SELF_REBUILD_VERIFY.txt
  COURSE_INVARIANTS.txt / CI_STATUS.txt / SHA256SUMS.txt
  source/ tests/ logs/ 以及 12 个专题结果目录(含 R2 新增 4 个)递归打包。

自重建: 从解压后的包执行
    cd source
    python apply_round4.py build1.html
    python apply_round4.py build2.html
    sha256sum build1.html build2.html "Agent新手村_R1.2-round4-p0.html"
  build1/build2 与交付件字节一致(本脚本打包后自动抽取校验, 写入 SELF_REBUILD_VERIFY.txt)。

前置(由调用方保证):
  * 已在 r1.2-round4-p0 分支完成 fix/test/docs 本地提交(不 push / 不 tag PASS / 不 merge)
  * 已运行 python tests/run_all_tests.py (产出 56 步全量日志)
  * Chromium 可用(_pw.js 自动探测缓存, 或设置 PLAYWRIGHT_CHROMIUM_PATH)

用法: python gen_r4r2_review_package.py
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_ZIP = os.path.join(BASE, "Agent新手村_R1.2-Round4-P0-R2_独立审阅包.zip")
ROUND4_HTML = "Agent新手村_R1.2-round4-p0.html"
BASELINE = "e4fc44f29a3d7355e0d78609874b7eef8e8794a9"  # main / R3 收口基线
EXPECTED_COURSE_HASH = "56860b8325375125f0950398fe512ab8fa9795e7087e30fe6bbf5a8f68965895"

NODE = "/Users/mac/.workbuddy/binaries/node/versions/22.22.2/bin/node"
PY = "/Users/mac/.workbuddy/binaries/python/envs/default/bin/python"


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

    print("== 1. 派生关系 + 两遍构建字节一致校验 ==")
    manifest = {}
    mp = os.path.join(BASE, "R1.2_Round4_build_manifest.txt")
    if os.path.exists(mp):
        for line in open(mp, encoding="utf-8"):
            if ":" in line:
                k, v = line.split(":", 1)
                manifest[k.strip()] = v.strip()
    tmp_a = "/tmp/_r4r2_build_a.html"
    tmp_b = "/tmp/_r4r2_build_b.html"
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

    print("== 2. git 提交 / 补丁 / bundle (含两个失败 tag) ==")
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
            cls = "fix(round4)       精准修复(事务终态/回滚验证/nextCoreOf/不可变证据)"
        elif prefix.startswith("test"):
            cls = "test(round4)      测试"
        elif prefix.startswith("ci"):
            cls = "ci(round4)        CI 配置"
        elif prefix.startswith("docs"):
            cls = "docs(round4)      文档/审阅包生成器"
        classify_lines.append("%s  ->  %s" % (sha[:12], cls))
    write_text(os.path.join(BASE, "NEW_COMMIT_SHA.txt"),
               "基线 main = %s (R3 收口基线 / checkpoint R1.2-R3-R3-PASS)\n" % BASELINE +
               "失败基线(打 tag):\n" +
               "  ROUND4_P0_REVIEW_FAILED       -> 08c63715f40dc98f1b30fc82f9037be6ec573dec\n" +
               "  ROUND4_P0_R1_REVIEW_FAILED    -> 1aebf616405712ff55b2a09648a9c3d92ab89d34\n" +
               "本轮本地提交(未 push / 未 tag PASS / 未 merge / CI 仅 CI_CONFIG_READY):\n" +
               "\n".join(new_sha_lines) + "\n")
    write_text(os.path.join(BASE, "COMMIT_CLASSIFICATION.txt"),
               "治理分类(每个提交仅含一类变更, 不混产品/CI环境/签字):\n" +
               "\n".join(classify_lines) + "\n\n"
               "说明: Round4-P0-R2 精准修复(基于独立审阅失败 ROUND4_P0_R1_REVIEW_FAILED @ 1aebf61),\n"
               "修复 post_commit_error 粘性终态 + 内存回滚完整验证 + 持久化写后重读验证 + 派生状态刷新\n"
               "单独统计 + nextCoreOf 不静默吞异常 + 回滚不可变证据。不扩展关卡 / 不迁移 74 关 /\n"
               "不修改 LevelData / 课程哈希 / 门禁业务规则 / Round3 fail-closed 门禁。\n"
               "CI 状态文件仅记录 CI_CONFIG_READY。\n")

    full_patch = sh(["git", "format-patch", "--stdout", "%s..HEAD" % BASELINE])
    write_text(os.path.join(BASE, "FULL_PATCH.patch"), full_patch)
    write_text(os.path.join(BASE, "CUMULATIVE_PATCH_since_R3_PASS.patch"), full_patch)

    bundle = os.path.join(BASE, "GIT_BUNDLE.bundle")
    if os.path.exists(bundle):
        os.remove(bundle)
    # R2 要求: bundle 必须同时携带两个失败 tag (不 push / 不 tag PASS / 不 merge)
    sh(["git", "bundle", "create", bundle, "HEAD",
        "refs/tags/ROUND4_P0_REVIEW_FAILED",
        "refs/tags/ROUND4_P0_R1_REVIEW_FAILED"])
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
               "课程不变量(Round4-P0-R2 未修改 LevelData / 课程哈希):\n"
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

    print("== 4. 重新运行 12 个专题浏览器测试以收集独立日志(含 R2 新增 4 个) ==")
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
        write_text(dest, ran[testfile])

    matrix = """# Round4-P0 / R1 / R2 故障注入矩阵 (CompletionTransactionFaults)

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

核心保证:
  * 唯一成功提交点 = 全部权威内存写入 + State.save 成功 + 重读一致(完整结构深比较) 之后。
  * 阶段 B(提交点之前)任意异常 → 完整回滚(内存+持久化一致), completed 不残留, 侧作用不残留。
  * 阶段 C(提交点之后)任意异常 → 不回滚已提交事务, 仅标记 post_commit_error(粘性终态, R2)。
  * 提交点之后(含 after_commit_point)绝不触发回滚。
  * 提交点校验覆盖: 当前关 completed/stars、下一关记录存在性与 unlocked、全部 levels 记录、
    currentLevel/xp/totalStars/achievements/peipeiFound/learnerProfile/schemaVersion。
  * R2 新增: 内存回滚递归深比较(含 xp/achievements/next 完整状态) + 持久化写后重读验证 +
    派生状态刷新单独统计 + nextCoreOf 不静默吞异常(抛错进入 preflight_failed) +
    回滚不可变证据哈希(memoryExpectedHash/memoryActualHash/persistenceExpectedHash/persistenceActualHash)。
"""
    write_text(os.path.join(BASE, "fault_injection_results", "FAULT_INJECTION_MATRIX.md"), matrix)

    print("== 5. 组装 ZIP ==")
    root_files = [
        "TWO_BUILD_SHA.txt", "NEW_COMMIT_SHA.txt", "COMMIT_CLASSIFICATION.txt",
        "CI_STATUS.txt", "COURSE_INVARIANTS.txt", "FULL_PATCH.patch",
        "CUMULATIVE_PATCH_since_R3_PASS.patch", "GIT_BUNDLE.bundle",
        "GIT_BUNDLE_VERIFY.txt", "GIT_BUNDLE_HEADS.txt", "RUN_REVIEW_TESTS.md",
    ]
    # 拷贝源码到 source/(含 round3 派生源 + 交付件副本 + fixtures 以保证可自重建)
    src_dir = os.path.join(BASE, "source")
    if os.path.isdir(src_dir):
        shutil.rmtree(src_dir)
    os.makedirs(src_dir, exist_ok=True)
    for f in ["completion_transaction.js", "apply_round4.py",
              "R1.2_Round4_build_manifest.txt", ROUND4_HTML,
              "Agent新手村_R1.2-round3-dev.html", "round3_features.js"]:
        if os.path.exists(os.path.join(BASE, f)):
            shutil.copy(os.path.join(BASE, f), os.path.join(src_dir, f))
    # 复制 fixtures(使 apply_round4.py 在 source/ 内两遍构建的 fx_hash 与交付件一致)
    fx_src = os.path.join(BASE, "tests", "fixtures")
    if os.path.isdir(fx_src):
        shutil.copytree(fx_src, os.path.join(src_dir, "tests", "fixtures"))

    # 审计报告(若存在)
    audit_src = os.path.join(BASE, "reports", "R1.2_ROUND4_P0_WRITE_AUDIT.md")
    if os.path.exists(audit_src):
        shutil.copy(audit_src, os.path.join(src_dir, "R1.2_ROUND4_P0_WRITE_AUDIT.md"))

    # 拷贝全部 14 个 Round4 测试 + _pw.js 到 tests/(zip 内 tests/)
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
               "_pw.js"]:
        sp = os.path.join(BASE, "tests", tf)
        if os.path.exists(sp):
            shutil.copy(sp, os.path.join(tests_dst, tf))
    # 拷贝回归日志(56 步)
    logs_dst = os.path.join(BASE, "logs")
    os.makedirs(logs_dst, exist_ok=True)
    reg_log = os.path.join(BASE, "tests", "logs", "r1.2-round4-p0-r2-full.log")
    if not os.path.exists(reg_log):
        reg_log = os.path.join(BASE, "tests", "logs", "run_all_tests.log")
    if os.path.exists(reg_log):
        shutil.copy(reg_log, os.path.join(logs_dst, "run_all_tests_r4r2.log"))

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
                    ("next_core_results", "next_core_results")]:
        _add_tree(os.path.join(BASE, sub), zp)

    readme = """# Agent新手村 R1.2 Round4-P0-R2 独立审阅包

## 主题
Round4-P0-R2 精准修复(基于独立审阅失败 ROUND4_P0_R1_REVIEW_FAILED @ 1aebf616405712ff55b2a09648a9c3d92ab89d34):
  一、post_commit_error 必须是粘性终态(finish() 不得用 committed 覆盖; 侧作用抛错后仍保持终态);
  二、内存回滚必须完整验证(递归深比较当前关/下一关/currentLevel/totalStars/xp/achievements);
  三、持久化回滚必须写后重读验证(不一致即 rollback_persist_failed, 不得报告 rolled_back);
  四、派生状态刷新单独统计(result.success = 内存 && 持久化 && 派生刷新);
  五、nextCoreOf 不得静默吞异常(抛错进入 preflight_failed, 不写权威状态);
  六、增加回滚不可变证据哈希(仅诊断, 不记录完整用户存档内容)。
不扩展关卡 / 不迁移 74 关 / 不修改 LevelData / 课程哈希 / 门禁业务规则 / Round3 fail-closed 门禁。

## 权威基线(冻结)
  main = e4fc44f29a3d7355e0d78609874b7eef8e8794a9 (R3 收口基线 / checkpoint R1.2-R3-R3-PASS)
  失败基线(已打 annotated tag, 保留不重写):
    ROUND4_P0_REVIEW_FAILED    -> 08c63715f40dc98f1b30fc82f9037be6ec573dec
    ROUND4_P0_R1_REVIEW_FAILED -> 1aebf616405712ff55b2a09648a9c3d92ab89d34
  状态 = ENGINEERING_PASS + CI_PASS (R3 已收口); 本轮 CI 仅 CI_CONFIG_READY

## 本轮交付(本地分支 r1.2-round4-p0, 未 push / 未 tag PASS / 未 merge)
  组件: completion_transaction.js(注入到 round3-dev HTML 末尾)
  构建: apply_round4.py → Agent新手村_R1.2-round4-p0.html
  测试: 14 个文件(13 浏览器 + 1 静态), 共 56 步统一回归
        (1-41 基线 + 42-48 Round4-P0 原 7 步 + 49-52 Round4-P0-R1 新增 4 步
         + 53-56 Round4-P0-R2 新增 4 步)

## 验证清单
  [ ] TWO_BUILD_SHA.txt       两遍构建字节一致
  [ ] COURSE_INVARIANTS.txt   74/70/4/8 + 课程哈希 MATCH
  [ ] CI_STATUS.txt           = CI_CONFIG_READY(非 CI_PASS)
  [ ] FULL_PATCH.patch        git format-patch 可 git am
  [ ] GIT_BUNDLE.bundle       git bundle verify 通过 + 含两个失败 tag
  [ ] GIT_BUNDLE_HEADS.txt    bundle 头引用列表(含两个失败 tag)
  [ ] fault_injection_results/FAULT_INJECTION_MATRIX.md  注入点矩阵
  [ ] SELF_REBUILD_VERIFY.txt 自重建字节一致校验通过
  [ ] 全部测试 56 步通过(logs/run_all_tests_r4r2.log)
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
  * 阶段 C(提交点之后)任意异常 → 不回滚, 仅标记 post_commit_error(粘性终态, R2 加固)。
  * 提交锁 Level._completing 在所有出口恢复为 false。
  * R2 加固: 内存回滚失败 → rollback_failed; 持久化重读失败 → rollback_persist_failed;
    nextCoreOf 异常 → preflight_failed; 回滚结果带不可变证据哈希。
"""
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
    extract_dir = tempfile.mkdtemp(prefix="r4r2_selfbuild_")
    try:
        with zipfile.ZipFile(OUT_ZIP, "r") as z:
            z.extractall(extract_dir)
        sb_src = os.path.join(extract_dir, "source")
        sb_script = os.path.join(sb_src, "apply_round4.py")
        sb_delivered = os.path.join(sb_src, ROUND4_HTML)
        sb1 = os.path.join(sb_src, "sb1.html")
        sb2 = os.path.join(sb_src, "sb2.html")
        for out_name in ("sb1.html", "sb2.html"):
            rr = subprocess.run([PY, sb_script, out_name], cwd=sb_src,
                                capture_output=True, text=True, env=env)
            if rr.returncode != 0:
                raise RuntimeError("SELF-BUILD FAIL %s\n%s\n%s" % (out_name, rr.stdout, rr.stderr))
        sha1 = sha256_file(sb1) if os.path.exists(sb1) else "MISSING"
        sha2 = sha256_file(sb2) if os.path.exists(sb2) else "MISSING"
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
        with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
            for p, rel in inclusions:
                z.write(p, rel)
        print("   自重建一致: %s (build1=%s.. build2=%s.. delivered=%s..)" % (
            rebuild_ok, sha1[:16], sha2[:16], sha_deliv[:16]))
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)

    print("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
