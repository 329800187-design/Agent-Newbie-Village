# -*- coding: utf-8 -*-
"""tests/run_all_tests.py — Agent新手村 v1.0 骨架统一测试入口

用法（在归档根目录或任意解压目录）:
    python tests/run_all_tests.py [--log-name final_run_all_tests.log]

运行顺序:
    1-5   环境检查 (Python / Node / Pillow / playwright-core / Chromium)
    6     build_release.py --skeleton
    7-11  Python 测试
    12-18 Node 测试 (含 2 个浏览器测试)

每项输出 [PASS]/[FAIL] + 退出码; 失败附最后 50 行日志。
任何一项失败 → 本脚本退出码非 0; 全部成功 → 打印 ALL TESTS PASS。
完整日志写入 tests/logs/<log-name> (默认 run_all_tests_last.log)。
"""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
LOGS_DIR = BASE_DIR / "tests" / "logs"

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

CHILD_ENV = dict(os.environ)
CHILD_ENV["PYTHONIOENCODING"] = "utf-8"

RESULTS = []      # (name, passed, exit_code, seconds)
LOG_LINES = []    # 完整日志


def log(line=""):
    print(line, flush=True)
    LOG_LINES.append(line)


def tail(text, n=50):
    lines = (text or "").splitlines()
    return "\n".join(lines[-n:])


def run_step(name, cmd, timeout=2400):
    """跑一个子进程步骤, 记录 PASS/FAIL。"""
    t0 = time.time()
    try:
        r = subprocess.run(
            cmd, cwd=str(BASE_DIR), env=CHILD_ENV,
            capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout,
        )
        code, out = r.returncode, (r.stdout or "") + ("\n" + r.stderr if r.stderr else "")
    except subprocess.TimeoutExpired:
        code, out = 124, f"TIMEOUT after {timeout}s"
    except FileNotFoundError as e:
        code, out = 127, f"命令不存在: {e}"
    dt = time.time() - t0
    ok = code == 0
    RESULTS.append((name, ok, code, dt))
    log(f"[{'PASS' if ok else 'FAIL'}] {name}")
    log(f"       退出码={code}  耗时={dt:.1f}s")
    LOG_LINES.append("------ 完整输出 ------")
    LOG_LINES.append(out.rstrip())
    LOG_LINES.append("----------------------")
    if not ok:
        log("       ------ 最后50行错误日志 ------")
        for ln in tail(out).splitlines():
            log("       " + ln)
        log("       -----------------------------")
    return ok, out


def check_env(name, cmd, validate=None, hint=""):
    """环境检查步骤: validate(stdout)->错误消息或 None。"""
    t0 = time.time()
    try:
        r = subprocess.run(
            cmd, cwd=str(BASE_DIR), env=CHILD_ENV,
            capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=120,
        )
        out = (r.stdout or "").strip() + ((" | " + r.stderr.strip()) if r.stderr.strip() else "")
        err = None
        if r.returncode != 0:
            err = f"退出码 {r.returncode}: {tail(out, 10)}"
        elif validate:
            err = validate((r.stdout or "").strip())
    except FileNotFoundError:
        out, err = "", f"命令不存在: {cmd[0]}"
    except subprocess.TimeoutExpired:
        out, err = "", "检查超时"
    dt = time.time() - t0
    ok = err is None
    RESULTS.append((name, ok, 0 if ok else 1, dt))
    log(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({out.splitlines()[0] if out else ''})" if ok else ""))
    if not ok:
        log(f"       {err}")
        if hint:
            log(f"       提示: {hint}")
    return ok


def v_python(_):
    if sys.version_info < (3, 10):
        return f"需要 Python >= 3.10, 当前 {sys.version.split()[0]}"
    return None


def v_node(out):
    try:
        major = int(out.lstrip("v").split(".")[0])
    except Exception:
        return f"无法解析 node 版本: {out!r}"
    if major < 18:
        return f"需要 Node >= 18 (playwright-core 要求), 当前 {out}"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--log-name", default="run_all_tests_last.log")
    args = ap.parse_args()

    log("=" * 62)
    log("Agent新手村 v1.0 骨架 — 统一测试入口 run_all_tests.py")
    log(f"归档根目录: {BASE_DIR}")
    log(f"开始时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    log("=" * 62)

    py = sys.executable  # 用当前解释器跑所有 python 步骤

    # ── 1-5 环境检查 ──
    log("\n── 环境检查 ──")
    check_env("1. Python 版本检查 (>=3.10)", [py, "--version"], v_python,
              hint="请安装 Python 3.10+ : https://www.python.org/downloads/")
    node_ok = check_env("2. Node 版本检查 (>=18)", ["node", "--version"], v_node,
                        hint="请安装 Node.js 18+ : https://nodejs.org/")
    check_env("3. Pillow 检查", [py, "-c", "import PIL; print('Pillow', PIL.__version__)"],
              hint=f"请执行: {Path(py).name} -m pip install Pillow")
    pw_ok = False
    if node_ok:
        pw_ok = check_env("4. playwright-core 检查",
                          ["node", "-e", "console.log('playwright-core', require('playwright-core/package.json').version)"],
                          hint="请在归档根目录执行: npm ci  (或 npm install)")
        check_env("5. Chromium/Edge/Chrome 检查",
                  ["node", "-e", "console.log(require('./tests/_pw.js').findChromium())"],
                  hint="见上方错误信息中的四种解决方式")
    else:
        for nm in ("4. playwright-core 检查", "5. Chromium/Edge/Chrome 检查"):
            RESULTS.append((nm, False, 1, 0.0))
            log(f"[FAIL] {nm}")
            log("       跳过: Node 不可用")

    env_all_ok = all(ok for _, ok, _, _ in RESULTS)
    if not env_all_ok:
        log("\n环境检查未全部通过 — 为避免误导性失败, 不再执行构建与测试。")
        finish(args.log_name)
        return 2

    # ── 6 骨架构建 ──
    log("\n── 骨架构建 ──")
    run_step("6. build_release.py --skeleton", [py, "build_release.py", "--skeleton"])

    # ── 7-11 Python 测试 ──
    log("\n── Python 测试 ──")
    py_tests = [
        ("7. test_static_integrity.py", "tests/test_static_integrity.py"),
        ("8. test_asset_manifest.py", "tests/test_asset_manifest.py"),
        ("9. test_skeleton_build.py", "tests/test_skeleton_build.py"),
        ("10. test_release_gate.py", "tests/test_release_gate.py"),
        ("11. test_release_zip_idempotence.py", "tests/test_release_zip_idempotence.py"),
    ]
    for name, rel in py_tests:
        run_step(name, [py, rel])

    # ── 12-20 Node 测试 ──
    log("\n── Node 测试 ──")
    node_tests = [
        ("12. test_save_migration.js", "tests/test_save_migration.js"),
        ("13. test_unlock_chain.js", "tests/test_unlock_chain.js"),
        ("14. test_c07_c08.js", "tests/test_c07_c08.js"),
        ("15. test_w6_gate.js", "tests/test_w6_gate.js"),
        ("16. test_w7_gate.js", "tests/test_w7_gate.js"),
        ("17. test_runtime_assets.js", "tests/test_runtime_assets.js"),
        ("18. test_onboarding.js", "tests/test_onboarding.js"),
    ]
    if pw_ok:
        node_tests += [
            ("19. test_w6_e2e.js", "tests/test_w6_e2e.js"),
            ("20. test_w7_e2e.js", "tests/test_w7_e2e.js"),
        ]
    for name, rel in node_tests:
        run_step(name, ["node", rel])

    return finish(args.log_name)


def finish(log_name):
    log("\n" + "=" * 62)
    log("汇总:")
    failed = 0
    for name, ok, code, dt in RESULTS:
        log(f"  [{'PASS' if ok else 'FAIL'}] {name}  (退出码={code}, {dt:.1f}s)")
        if not ok:
            failed += 1
    log("=" * 62)
    if failed == 0:
        log("ALL TESTS PASS")
        rc = 0
    else:
        log(f"{failed} 项失败 — run_all_tests.py 退出码非0")
        rc = 1
    # 写完整日志
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        (LOGS_DIR / log_name).write_text("\n".join(LOG_LINES) + "\n", encoding="utf-8", newline="\n")
        print(f"完整日志: {LOGS_DIR / log_name}", flush=True)
    except Exception as e:
        print(f"[WARN] 日志写入失败: {e}", flush=True)
    return rc


if __name__ == "__main__":
    sys.exit(main())
