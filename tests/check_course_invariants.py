# -*- coding: utf-8 -*-
"""tests/check_course_invariants.py — 校验课程哈希与 74/70/4/8 不变量。

复用规范工具 tests/leveldata_hash.js(其哈希算法即课程数据不变性的权威实现,
输出需与冻结基线 _leveldata_hash_baseline.json 完全一致):
    leveldata_worlds_sha256 == 56860b8325375125f0950398fe512ab8fa9795e7087e30fe6bbf5a8f68965895
    levels==74, core==70, optional==4, worlds==8

Round3 严禁修改 Alpha2 / Round2-R2 交付件 / LevelData / 课程哈希, 本检查即守门。

用法: python tests/check_course_invariants.py
注意: 需在 apply_round3.py 构建出 Agent新手村_R1.2-round3-dev.html 之后运行。
"""
import json
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, ".."))
HTML = os.path.join(ROOT, "Agent新手村_R1.2-round3-dev.html")
NODE = "node"
EXPECTED = "56860b8325375125f0950398fe512ab8fa9795e7087e30fe6bbf5a8f68965895"


def main():
    if not os.path.exists(HTML):
        print("[FAIL] 未找到 %s (请先运行 apply_round3.py 构建)" % HTML)
        return 1
    r = subprocess.run([NODE, "tests/leveldata_hash.js", os.path.basename(HTML)],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print("[FAIL] leveldata_hash.js 退出码非0")
        print(r.stderr)
        return 1
    try:
        data = json.loads(r.stdout)
    except Exception as e:
        print("[FAIL] 无法解析 leveldata_hash.js 输出: %s" % e)
        print(r.stdout)
        return 1

    ok = True

    def check(name, cond):
        nonlocal ok
        print(("[PASS] " if cond else "[FAIL] ") + name)
        if not cond:
            ok = False

    check("course_hash == 基线 %s" % EXPECTED[:16], data.get("leveldata_worlds_sha256") == EXPECTED)
    check("levels == 74 (got %s)" % data.get("levels"), data.get("levels") == 74)
    check("core == 70 (got %s)" % data.get("core"), data.get("core") == 70)
    check("optional == 4 (got %s)" % data.get("optional"), data.get("optional") == 4)
    check("worlds == 8 (got %s)" % data.get("worlds"), data.get("worlds") == 8)

    if ok:
        print("COURSE_HASH=%s" % data.get("leveldata_worlds_sha256"))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
