# -*- coding: utf-8 -*-
"""tests/test_release_gate.py — 发布闸门测试
在 placeholder 仍存在时:
  --release 必须退出非零, 且不得生成正式 ZIP
  --skeleton 必须成功
用法: python tests/test_release_gate.py
"""
import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
REL_ZIP = BASE / "Agent新手村_v1.0.zip"

P, F = 0, 0
def check(cond, msg):
    global P, F
    print(f"  {'[PASS]' if cond else '[FAIL]'} {msg}")
    if cond: P += 1
    else: F += 1

mf = json.loads((BASE / "assets" / "asset_manifest.json").read_text(encoding="utf-8"))
n_ph = sum(1 for a in mf["assets"] if a["status"] == "placeholder")
check(n_ph > 0, f"前置: 当前存在 {n_ph} 个 placeholder (发布闸门应拦截)")

before = (REL_ZIP.stat().st_mtime_ns, REL_ZIP.stat().st_size) if REL_ZIP.exists() else None

r = subprocess.run([sys.executable, str(BASE / "build_release.py"), "--release"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace",
                   cwd=str(BASE), timeout=900)
check(r.returncode != 0, f"--release 在有 placeholder 时退出非零 (实际 {r.returncode})")
check("placeholder 必须为 0" in (r.stdout or ""), "失败原因明确指向 placeholder 闸门")

after = (REL_ZIP.stat().st_mtime_ns, REL_ZIP.stat().st_size) if REL_ZIP.exists() else None
check(after == before, f"未生成/未改动正式 ZIP (前 {before} == 后 {after})")
check("正式发布构建成功" not in (r.stdout or ""), "未错误宣布正式发布成功")

r2 = subprocess.run([sys.executable, str(BASE / "build_release.py"), "--skeleton"],
                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                    cwd=str(BASE), timeout=900)
check(r2.returncode == 0, f"同一状态下 --skeleton 成功 (实际 {r2.returncode})")
check("骨架构建成功" in (r2.stdout or ""), "骨架构建报告正常")

print(f"\n== test_release_gate: {P} pass / {F} fail — {'ALL PASS' if F == 0 else str(F) + ' FAILED'} ==")
sys.exit(0 if F == 0 else 1)
