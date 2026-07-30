# -*- coding: utf-8 -*-
"""gen_r3r3_review_package.py — 生成 R1.2 Round3-R3 独立审阅包。

必须在 R3 修复提交(commit)之后运行。生成:
    Agent新手村_R1.2-Round3-R3_独立审阅包.zip
内含(均见 README.txt):
    NEW_COMMIT_SHA.txt
    ROUND3_R2_REVIEW_FAILED_tag_evidence.txt
    FULL_PATCH.patch                         (git show HEAD)
    CUMULATIVE_PATCH_since_R2_REVIEW_FAILED.patch (git diff 6f12969..HEAD)
    GIT_BUNDLE.bundle                        (main..r1.2-round3-dev + 3 tags)
    GIT_BUNDLE_VERIFY.txt
    TWO_BUILD_SHA.txt                        (apply_round3.py 两次构建一致性)
    COURSE_INVARIANTS.txt                    (课程哈希 74/70/4/8 + TEST_MODE)
    CI_STATUS.txt                            (仅 CI_CONFIG_READY, 无 CI_PASS)
    source/  tests/  logs/
    fault_injection_results/Level_done_fault_injection.txt
    engine_gate_legit_pass/engine_gate_submission.txt
    SHA256SUMS.txt
并列产出: <zip>.sha256 (ZIP 最终 SHA256)

仅用标准库 + git / node(托管) / python(venv)。
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.abspath(os.path.dirname(__file__))
NODE = "/Users/mac/.workbuddy/binaries/node/versions/22.22.2/bin/node"
PY = sys.executable

R2_REVIEW_FAILED_BASE = "6f12969338845b8b98178a67e40b3254542977ea"
TAGS = ["ROUND3_REVIEW_FAILED", "ROUND3_R1_REVIEW_FAILED", "ROUND3_R2_REVIEW_FAILED"]
EXPECTED_COURSE_HASH = "56860b8325375125f0950398fe512ab8fa9795e7087e30fe6bbf5a8f68965895"

PKG_NAME = "Agent新手村_R1.2-Round3-R3_独立审阅包"
STAGE = os.path.join(ROOT, "_r3r3_stage")
ZIP_PATH = os.path.join(ROOT, PKG_NAME + ".zip")


def run(cmd, cwd=ROOT, capture=True, text=True):
    r = subprocess.run(cmd, cwd=cwd, capture_output=capture, text=text)
    return r


def g(cmd):
    r = run(["git"] + cmd)
    if r.returncode != 0:
        return "<<git error %d>> %s" % (r.returncode, (r.stderr or "").strip())
    return (r.stdout or "").strip()


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if isinstance(content, str):
        content = content.encode("utf-8")
    with open(path, "wb") as f:
        f.write(content)


def main():
    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(STAGE, exist_ok=True)

    lines = []
    lines.append("R1.2 Round3-R3 独立审阅包生成")
    lines.append("=" * 60)

    # 1) 新提交 SHA
    head = g(["rev-parse", "HEAD"])
    write(os.path.join(STAGE, "NEW_COMMIT_SHA.txt"), head + "\n")
    lines.append("[1] 新提交 SHA = %s" % head)

    # 2) ROUND3_R2_REVIEW_FAILED tag 证据
    ev = []
    ev.append("tag: ROUND3_R2_REVIEW_FAILED")
    ev.append("tag-object: %s" % g(["rev-parse", "ROUND3_R2_REVIEW_FAILED"]))
    ev.append("points-to-commit: %s" % g(["rev-parse", "ROUND3_R2_REVIEW_FAILED^{commit}"]))
    ev.append("expected-base-commit: %s" % R2_REVIEW_FAILED_BASE)
    ok_tag = g(["rev-parse", "ROUND3_R2_REVIEW_FAILED^{commit}"]).startswith(R2_REVIEW_FAILED_BASE)
    ev.append("MATCH: %s" % ok_tag)
    ev.append("")
    ev.append("所有 ROUND3 标签 -> 提交:")
    for t in TAGS:
        ev.append("  %s -> %s" % (t, g(["rev-parse", t + "^{commit}"])))
    ev.append("")
    ev.append("git show-ref --tags | grep -i round3:")
    ev.append(g(["show-ref", "--tags"]) .splitlines() and "\n".join(
        l for l in g(["show-ref", "--tags"]).splitlines() if "round3" in l.lower()) or "(none)")
    write(os.path.join(STAGE, "ROUND3_R2_REVIEW_FAILED_tag_evidence.txt"), "\n".join(ev) + "\n")
    lines.append("[2] ROUND3_R2_REVIEW_FAILED tag 证据: MATCH=%s" % ok_tag)

    # 3) 完整 patch + 累计 patch (git format-patch 标准格式, 可被 git am 干净应用, 含完整上下文)
    full = g(["format-patch", "--stdout", "-1", "HEAD"])
    write(os.path.join(STAGE, "FULL_PATCH.patch"), full)
    cum = g(["format-patch", "--stdout", R2_REVIEW_FAILED_BASE + "..HEAD"])
    write(os.path.join(STAGE, "CUMULATIVE_PATCH_since_R2_REVIEW_FAILED.patch"), cum)
    lines.append("[3] FULL_PATCH.patch / CUMULATIVE_PATCH.patch 已生成 (git format-patch)")

    # 4) git bundle + verify
    bundle = os.path.join(STAGE, "GIT_BUNDLE.bundle")
    rb = run(["git", "bundle", "create", bundle,
              "main..r1.2-round3-dev"] + ["refs/tags/" + t for t in TAGS])
    verify_out = ""
    if rb.returncode == 0:
        rv = run(["git", "bundle", "verify", bundle])
        verify_out = (rv.stdout or "") + (rv.stderr or "")
    else:
        verify_out = "BUNDLE CREATE FAILED:\n" + (rb.stderr or "")
    write(os.path.join(STAGE, "GIT_BUNDLE_VERIFY.txt"), verify_out + "\n")
    lines.append("[4] GIT_BUNDLE.bundle 创建: rc=%s; verify rc=%s" % (
        rb.returncode, "n/a" if rb.returncode else run(["git", "bundle", "verify", bundle]).returncode))

    # 5) 两次构建一致性 (apply_round3.py -> 临时路径)
    b1 = os.path.join(ROOT, "_build_a.html")
    b2 = os.path.join(ROOT, "_build_b.html")
    ra = run([PY, "apply_round3.py", b1])
    rb2 = run([PY, "apply_round3.py", b2])
    sha1 = sha256_file(b1) if os.path.exists(b1) else "MISSING"
    sha2 = sha256_file(b2) if os.path.exists(b2) else "MISSING"
    committed_html = os.path.join(ROOT, "Agent新手村_R1.2-round3-dev.html")
    committed_sha = sha256_file(committed_html) if os.path.exists(committed_html) else "MISSING"
    consistent = (sha1 == sha2)
    two = []
    two.append("构建1 (apply_round3.py -> %s): %s" % (os.path.basename(b1), sha1))
    two.append("构建2 (apply_round3.py -> %s): %s" % (os.path.basename(b2), sha2))
    two.append("两次构建一致: %s" % consistent)
    two.append("交付件 HTML (%s): %s" % (os.path.basename(committed_html), committed_sha))
    two.append("交付件 == 构建1: %s" % (committed_sha == sha1))
    two.append("")
    two.append("apply_round3 退出码: build1=%s build2=%s" % (ra.returncode, rb2.returncode))
    write(os.path.join(STAGE, "TWO_BUILD_SHA.txt"), "\n".join(two) + "\n")
    lines.append("[5] 两次构建一致=%s; 交付件==构建1=%s" % (consistent, committed_sha == sha1))

    # 6) 课程不变量 + TEST_MODE
    ci = run([PY, "tests/check_course_invariants.py"])
    ci_out = (ci.stdout or "") + (ci.stderr or "")
    # 额外确认 TEST_MODE=false
    html_txt = open(committed_html, "r", encoding="utf-8", errors="replace").read()
    tm = "TEST_MODE=false" in html_txt
    cov = []
    cov.append("=== check_course_invariants.py 输出 ===")
    cov.append(ci_out.strip())
    cov.append("")
    cov.append("=== TEST_MODE ===")
    cov.append("TEST_MODE=false 存在于 HTML: %s" % tm)
    cov.append("课程哈希基线期望: %s" % EXPECTED_COURSE_HASH)
    write(os.path.join(STAGE, "COURSE_INVARIANTS.txt"), "\n".join(cov) + "\n")
    lines.append("[6] 课程不变量: check rc=%s; TEST_MODE=false=%s" % (ci.returncode, tm))

    # 7) CI 状态 (仅 CI_CONFIG_READY, 无 CI_PASS)
    wf = os.path.join(ROOT, ".github", "workflows", "r1.2-round3-ci.yml")
    wf_txt = open(wf, "r", encoding="utf-8", errors="replace").read() if os.path.exists(wf) else ""
    # 仅检查非注释(活跃)行; CI_PASS 仅允许出现在注释说明中, 不得作为活动状态声明/输出。
    active_lines = [ln for ln in wf_txt.splitlines() if not ln.lstrip().startswith("#")]
    has_ready = any("CI_CONFIG_READY" in ln for ln in active_lines)
    has_pass_active = any("CI_PASS" in ln for ln in active_lines)
    has_pass_in_comment = any("CI_PASS" in ln for ln in wf_txt.splitlines() if ln.lstrip().startswith("#"))
    cist = []
    cist.append("CI 工作流: %s" % wf)
    cist.append("包含 CI_CONFIG_READY(活跃声明/输出): %s" % has_ready)
    cist.append("包含 CI_PASS(活跃声明/输出, 应无): %s" % has_pass_active)
    cist.append("CI_PASS 仅出现在注释说明中: %s" % has_pass_in_comment)
    cist.append("结论: %s" % ("合规(仅 CI_CONFIG_READY, 无活动 CI_PASS)" if (has_ready and not has_pass_active) else "不合规"))
    cist.append("")
    # 抓取工作流中打印 CI_CONFIG_READY / 提及 CI_PASS 的上下文
    for ln in wf_txt.splitlines():
        if "CI_CONFIG_READY" in ln or "CI_PASS" in ln:
            cist.append("  > " + ln.strip())
    write(os.path.join(STAGE, "CI_STATUS.txt"), "\n".join(cist) + "\n")
    lines.append("[7] CI 状态: CI_CONFIG_READY=%s; CI_PASS(活跃,应无)=%s; CI_PASS仅注释=%s" % (
        has_ready, has_pass_active, has_pass_in_comment))

    # 8) source/
    os.makedirs(os.path.join(STAGE, "source"), exist_ok=True)
    src_files = [
        "round3_features.js",
        "apply_round3.py",
        "Agent新手村_R1.2-round3-dev.html",
    ]
    if os.path.exists(os.path.join(ROOT, "R1.2_Round3_build_manifest.txt")):
        src_files.append("R1.2_Round3_build_manifest.txt")
    for sf in src_files:
        sp = os.path.join(ROOT, sf)
        if os.path.exists(sp):
            shutil.copy(sp, os.path.join(STAGE, "source", sf))

    # 9) tests/ (所有 js/py + _pw.js)
    os.makedirs(os.path.join(STAGE, "tests"), exist_ok=True)
    tests_dir = os.path.join(ROOT, "tests")
    for fn in sorted(os.listdir(tests_dir)):
        if fn.endswith(".js") or fn.endswith(".py"):
            shutil.copy(os.path.join(tests_dir, fn), os.path.join(STAGE, "tests", fn))

    # 10) logs/ (完整原始回归日志)
    os.makedirs(os.path.join(STAGE, "logs"), exist_ok=True)
    reg_log = os.path.join(tests_dir, "logs", "r1.2_round3_r3_full_test_v2.log")
    if not os.path.exists(reg_log):
        # 回退到最新 r3 全量日志
        cands = sorted([f for f in os.listdir(os.path.join(tests_dir, "logs"))
                        if "round3_r3" in f and f.endswith(".log")])
        reg_log = os.path.join(tests_dir, "logs", cands[-1]) if cands else None
    if reg_log and os.path.exists(reg_log):
        shutil.copy(reg_log, os.path.join(STAGE, "logs", os.path.basename(reg_log)))
        lines.append("[10] 回归日志: %s" % os.path.basename(reg_log))

    # 11) fault_injection_results (真实 Level.done() 注入)
    fj = run([NODE, "tests/test_round3_gate_missing_state.js"], cwd=ROOT)
    fj_out = (fj.stdout or "") + (("\n[STDERR]\n" + fj.stderr) if fj.stderr else "")
    write(os.path.join(STAGE, "fault_injection_results", "Level_done_fault_injection.txt"), fj_out)
    lines.append("[11] fault-injection: 退出码=%s (%d 行)" % (fj.returncode, len(fj_out.splitlines())))

    # 12) engine_gate_legit_pass (W6/W7 合法通过)
    ep = run([NODE, "tests/test_round3_engine_gate_submission.js"], cwd=ROOT)
    ep_out = (ep.stdout or "") + (("\n[STDERR]\n" + ep.stderr) if ep.stderr else "")
    write(os.path.join(STAGE, "engine_gate_legit_pass", "engine_gate_submission.txt"), ep_out)
    lines.append("[12] engine-gate-submission: 退出码=%s (%d 行)" % (ep.returncode, len(ep_out.splitlines())))

    # 13) README
    readme = []
    readme.append("Agent 新手村 R1.2 Round3-R3 独立审阅包")
    readme.append("")
    readme.append("新提交 SHA: %s" % head)
    readme.append("ROUND3_R2_REVIEW_FAILED tag -> %s (MATCH=%s)" % (
        g(["rev-parse", "ROUND3_R2_REVIEW_FAILED^{commit}"]), ok_tag))
    readme.append("")
    readme.append("本包针对 R1.2 Round3-R3 最终门禁提交修复指令生成。仅修复真实提交门禁,")
    readme.append("未扩大课程 / 素材 / 关卡范围。历史(60e1d23 / 7716825 / 6f12969)已保留为 annotated tag。")
    readme.append("")
    readme.append("目录结构:")
    readme.append("  NEW_COMMIT_SHA.txt                       新提交 SHA")
    readme.append("  ROUND3_R2_REVIEW_FAILED_tag_evidence.txt  tag 证据(指向 6f12969)")
    readme.append("  FULL_PATCH.patch                          本提交完整 patch")
    readme.append("  CUMULATIVE_PATCH_since_R2_REVIEW_FAILED.patch  自 R2 复审失败基线累计 patch")
    readme.append("  GIT_BUNDLE.bundle                        main..r1.2-round3-dev + 3 tags")
    readme.append("  GIT_BUNDLE_VERIFY.txt                    bundle verify 输出")
    readme.append("  TWO_BUILD_SHA.txt                        两次构建 SHA 一致性")
    readme.append("  COURSE_INVARIANTS.txt                    课程哈希 74/70/4/8 + TEST_MODE")
    readme.append("  CI_STATUS.txt                            仅 CI_CONFIG_READY(无 CI_PASS)")
    readme.append("  source/                                 全部源码(含交付件 HTML)")
    readme.append("  tests/                                  全部测试")
    readme.append("  logs/                                   完整原始回归日志")
    readme.append("  fault_injection_results/                 6 种缺失态真实 Level.done() 注入结果")
    readme.append("  engine_gate_legit_pass/                  W6/W7 合法通过结果")
    readme.append("  SHA256SUMS.txt                           包内文件 SHA256")
    readme.append("")
    readme.append("侧车文件: %s.sha256 = ZIP 最终 SHA256" % PKG_NAME)
    readme.append("")
    readme.append("回归验收(41 项全量): 见 logs/ 与下方生成摘要。")
    readme.append("")
    readme.append("生成摘要:")
    for l in lines:
        readme.append("  " + l)
    write(os.path.join(STAGE, "README.txt"), "\n".join(readme) + "\n")

    # 14) SHA256SUMS (包内所有文件, 相对路径排序; 排除 SHA256SUMS.txt 自身)
    all_files = []
    for dp, _, fns in os.walk(STAGE):
        for fn in fns:
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, STAGE).replace(os.sep, "/")
            if rel == "SHA256SUMS.txt":
                continue
            all_files.append((rel, sha256_file(full)))
    all_files.sort(key=lambda x: x[0])
    sums = ["%s  %s" % (h, rel) for rel, h in all_files]
    write(os.path.join(STAGE, "SHA256SUMS.txt"), "\n".join(sums) + "\n")

    # 15) 打包
    if os.path.exists(ZIP_PATH):
        os.remove(ZIP_PATH)
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, _ in all_files:
            z.write(os.path.join(STAGE, rel), os.path.join(PKG_NAME, rel))
        z.write(os.path.join(STAGE, "SHA256SUMS.txt"), os.path.join(PKG_NAME, "SHA256SUMS.txt"))

    zip_sha = sha256_file(ZIP_PATH)
    with open(ZIP_PATH + ".sha256", "w", encoding="utf-8") as f:
        f.write("%s  %s\n" % (zip_sha, os.path.basename(ZIP_PATH)))

    # 清理临时构建文件
    for tmp in (b1, b2):
        if os.path.exists(tmp):
            os.remove(tmp)

    print("=" * 60)
    for l in lines:
        print(l)
    print("-" * 60)
    print("ZIP: %s" % ZIP_PATH)
    print("ZIP SHA256: %s" % zip_sha)
    print("大小: %d 字节; 文件数(含 SHA256SUMS): %d" % (os.path.getsize(ZIP_PATH), len(all_files) + 1))
    print("=" * 60)


if __name__ == "__main__":
    main()
