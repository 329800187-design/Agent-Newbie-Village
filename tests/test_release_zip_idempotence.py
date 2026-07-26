# -*- coding: utf-8 -*-
"""tests/test_release_zip_idempotence.py — 构建幂等测试
连续两轮 --skeleton: 三 HTML 与骨架 ZIP 的 SHA256 必须完全一致
用法: python tests/test_release_zip_idempotence.py
"""
import hashlib
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
TARGETS = ["Agent新手村_当前版.html", "Agent新手村_开发测试版.html",
           "Agent新手村_v1.0_发布候选版.html", "Agent新手村_v1.0_骨架预览版.zip"]

P, F = 0, 0
def check(cond, msg):
    global P, F
    print(f"  {'[PASS]' if cond else '[FAIL]'} {msg}")
    if cond: P += 1
    else: F += 1

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

rounds = []
for i in (1, 2):
    r = subprocess.run([sys.executable, str(BASE / "build_release.py"), "--skeleton"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       cwd=str(BASE), timeout=900)
    check(r.returncode == 0, f"第 {i} 轮 --skeleton 退出码 0 (实际 {r.returncode})")
    rounds.append({t: sha(BASE / t) for t in TARGETS})
    print(f"    round{i}: " + " | ".join(f"{t.split('_')[-1][:8]}={rounds[-1][t][:12]}" for t in TARGETS))

for t in TARGETS:
    check(rounds[0][t] == rounds[1][t], f"两轮哈希一致: {t} ({rounds[0][t][:16]}...)")

print(f"\n== test_release_zip_idempotence: {P} pass / {F} fail — {'ALL PASS' if F == 0 else str(F) + ' FAILED'} ==")
if F == 0:
    print("两轮构建SHA256记录:")
    for t in TARGETS:
        print(f"  {t}: {rounds[0][t]}")
sys.exit(0 if F == 0 else 1)
