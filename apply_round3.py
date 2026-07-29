# -*- coding: utf-8 -*-
"""apply_round3.py — 由 Round2-R2 派生的 round3-dev，注入 R1.2 Round3 扩展。

用法:
    python apply_round3.py [OUT_PATH]
      OUT_PATH 省略时写入提交的 Agent新手村_R1.2-round3-dev.html (交付件)。
      验收/CI 用临时路径调用两次以比对 SHA256 一致性 (不污染交付件)。

派生关系:
    Round3 必须在通过签字的 Round2-R2 之上派生:
        输入 = Agent新手村_R1.2-round2-dev.html (Round2-R2 交付件, 固定)
        注入 = round3_features.js (R1.2 Round3 骨架扩展)
        输出 = Agent新手村_R1.2-round3-dev.html

必须记录(写入 R1.2_Round3_build_manifest.txt + 注入确定性溯源注释):
    * Round2-R2 输入 SHA256
    * Round3 输出 SHA256
    * 注入位置 (字符偏移)
    * fixture 清单哈希 (tests/fixtures/assets/, 排序后哈希; 目录缺失时为 'none')

不变量:
    * 不修改 Alpha2 冻结文件 / Round2-R2 交付件 / LevelData / 课程哈希。
    * 注入位置固定为「文档末尾最后一个 </body> 之前」, 与 apply_round2 一致, 保证可复现。
    * 溯源注释仅含运行前可确定的值 (输入 SHA / 注入位置 / fixture 哈希), 不影响两次构建一致性。
"""
import hashlib
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
INPUT = os.path.join(BASE, "Agent新手村_R1.2-round2-dev.html")
FEATURES = os.path.join(BASE, "round3_features.js")
DEFAULT_OUT = os.path.join(BASE, "Agent新手村_R1.2-round3-dev.html")
FIXTURES = os.path.join(BASE, "tests", "fixtures", "assets")
MANIFEST = os.path.join(BASE, "R1.2_Round3_build_manifest.txt")


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def fixture_manifest_hash():
    if not os.path.isdir(FIXTURES):
        return "none"
    rows = []
    for root, _, files in os.walk(FIXTURES):
        for fn in files:
            if fn.endswith(".png"):
                fp = os.path.join(root, fn)
                rel = os.path.relpath(fp, FIXTURES)
                rows.append((rel, sha256_file(fp)))
    rows.sort()
    h = hashlib.sha256()
    for rel, s in rows:
        h.update((rel + ":" + s + "\n").encode("utf-8"))
    return h.hexdigest()


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    in_sha = sha256_file(INPUT)

    with open(FEATURES, "r", encoding="utf-8") as f:
        feat = f.read()
    with open(INPUT, "r", encoding="utf-8") as f:
        html = f.read()

    script_block = "\n<script>\n" + feat + "\n</script>\n"
    idx = html.rfind("</body>")
    if idx >= 0:
        html2 = html[:idx] + script_block + html[idx:]
    else:
        idx2 = html.rfind("</html>")
        if idx2 >= 0:
            html2 = html[:idx2] + script_block + html[idx2:]
        else:
            html2 = html + script_block
            idx = len(html)

    fx_hash = fixture_manifest_hash()
    # 确定性溯源注释: 仅含运行前可确定的值, 两次构建完全一致 → 不影响输出 SHA 一致性。
    prov = "<!-- Round3 build: input=%s; injectionPos=%d; fixtures=%s -->\n" % (in_sha, idx, fx_hash)
    html2 = prov + html2

    with open(out, "w", encoding="utf-8") as f:
        f.write(html2)
    out_sha = sha256_file(out)

    try:
        with open(MANIFEST, "w", encoding="utf-8") as f:
            f.write("round2_r2_input_sha256: %s\n" % in_sha)
            f.write("round3_output_sha256: %s\n" % out_sha)
            f.write("injection_position: %d\n" % idx)
            f.write("fixture_manifest_sha256: %s\n" % fx_hash)
            f.write("output_file: %s\n" % os.path.basename(out))
    except Exception as e:
        print("[WARN] manifest 写入失败: %s" % e)

    print("wrote", out, "( %d chars )" % len(html2))
    print("round2_r2_input_sha256 =", in_sha)
    print("round3_output_sha256  =", out_sha)
    print("injection_position     =", idx)
    print("fixture_manifest_sha256 =", fx_hash)
    return 0


if __name__ == "__main__":
    sys.exit(main())
