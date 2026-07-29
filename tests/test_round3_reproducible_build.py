# -*- coding: utf-8 -*-
"""tests/test_round3_reproducible_build.py — 验证两次 apply_round3.py 输出逐字节一致。

用法: python tests/test_round3_reproducible_build.py
注意: 输出写入临时路径, 不污染提交的 Agent新手村_R1.2-round3-dev.html。
"""
import hashlib
import os
import subprocess
import sys
import tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, ".."))
PY = sys.executable


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(65536), b""):
            h.update(c)
    return h.hexdigest()


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)


def main():
    ok = True

    def check(name, cond):
        nonlocal ok
        print(("[PASS] " if cond else "[FAIL] ") + name)
        if not cond:
            ok = False

    # 1) 生成夹具（确定性，可重跑）
    r = run([PY, "tests/generate_fixture_assets.py"])
    check("generate_fixture_assets.py 退出码0", r.returncode == 0)

    # 2) 两次构建到临时输出, 比对 SHA256
    d = tempfile.mkdtemp(prefix="r3build_")
    o1 = os.path.join(d, "r3a.html")
    o2 = os.path.join(d, "r3b.html")
    r1 = run([PY, "apply_round3.py", o1])
    r2 = run([PY, "apply_round3.py", o2])
    check("apply_round3.py 两次均退出码0", r1.returncode == 0 and r2.returncode == 0)
    s1, s2 = sha(o1), sha(o2)
    check("两次构建 SHA256 一致 (%s)" % s1[:16], s1 == s2)

    # 3) 重跑夹具 + 重构, 哈希仍稳定（顺序无关 / 确定性）
    run([PY, "tests/generate_fixture_assets.py"])
    r3 = run([PY, "apply_round3.py", o2])
    s3 = sha(o2)
    check("重跑后构建 SHA256 仍一致", r3.returncode == 0 and s1 == s3)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
