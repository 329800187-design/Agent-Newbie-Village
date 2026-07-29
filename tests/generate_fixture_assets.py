# -*- coding: utf-8 -*-
"""tests/generate_fixture_assets.py — 生成最小合法 PNG 测试夹具 (确定性, 可清理)

用法:
    python tests/generate_fixture_assets.py            # 生成到 tests/fixtures/assets/
    python tests/generate_fixture_assets.py --clean    # 删除生成的夹具

设计要点:
    * 纯标准库生成 PNG (无第三方依赖, 无时间戳, 无随机数据) —— 连续两次执行输出逐字节一致。
    * 每个 PNG 内含 tEXt 标记 FixtureAsset, 明确声明「非真实素材, 仅供测试」, 不冒充正式贴图。
    * 颜色由素材 id 派生 (sha256), 确定性且各文件可区分。
    * 干净克隆后运行本脚本即可得到所需夹具, 不依赖人工补 assets。
    * 与 AssetRegistry 桶/分类对应关系 (见 fixtures 表): 物理子目录名即 BUCKET_DIRS 子目录。
"""
import hashlib
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fixtures", "assets")

# (物理子目录, 文件名stem, AssetRegistry 桶, 注册 id)
# 注意: character 桶的 id 带子类型前缀 (peipei:/kuro:), 与 apply_round2.build_seed 一致。
FIXTURES = [
    ("splash", "J01", "splash", "J01"),
    ("onboard", "K01", "onboard", "K01"),
    ("peipei", "A07", "character", "peipei:A07"),
    ("kuro", "H01", "character", "kuro:H01"),
    ("nodes", "C01", "node", "C01"),
    ("done", "G01", "done", "G01"),
    ("bg", "B01", "background", "B01"),
    ("boss", "D01", "boss", "D01"),
    ("cert", "E01", "certificate", "E01"),
    ("ui", "U01", "ui", "U01"),
]

SIZE = 16  # 16x16 最小合法位图


def _color_for(rid):
    h = hashlib.sha256(rid.encode("utf-8")).digest()
    return (h[0], h[1], h[2])


def _chunk(typ, data):
    body = typ + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def make_png(path, rid):
    w = h = SIZE
    r, g, b = _color_for(rid)
    raw = bytearray()
    for _ in range(h):
        raw.append(0)  # PNG 每行 filter type 0
        for _ in range(w):
            raw.append(r)
            raw.append(g)
            raw.append(b)
    comp = zlib.compress(bytes(raw), 9)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit, color type 2 (RGB)
    text = b"FixtureAsset\x00R1.2-Round3-Fixture; do-not-ship; id=" + rid.encode("utf-8")
    png = (
        sig
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"tEXt", text)
        + _chunk(b"IDAT", comp)
        + _chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def main():
    if "--clean" in sys.argv:
        import shutil

        if os.path.isdir(OUT):
            shutil.rmtree(OUT)
        print("cleaned", OUT)
        return 0

    os.makedirs(OUT, exist_ok=True)
    for sub, stem, bucket, rid in FIXTURES:
        d = os.path.join(OUT, sub)
        os.makedirs(d, exist_ok=True)
        make_png(os.path.join(d, stem + ".png"), rid)
    print("generated", len(FIXTURES), "fixture PNGs into", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
