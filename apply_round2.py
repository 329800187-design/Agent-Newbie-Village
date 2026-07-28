# -*- coding: utf-8 -*-
"""apply_round2.py — 由 Alpha2 冻结版派生 round2-dev，注入 R1.2 Round2 骨架扩展。
用法: python apply_round2.py
- 重新生成 AssetRegistry 种子(扫描 assets/ 下真实 PNG)
- 将 round2_features.js 注入 Agent新手村_R1.2-round2-dev.html(在 </body> 前新增独立 <script>)
- 不修改 Alpha2 冻结文件, 不修改 LevelData / 课程哈希
"""
import json
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
ALPHA2 = os.path.join(BASE, 'release', 'R1.2-alpha2', 'Agent新手村_R1.2-alpha2.html')
FEATURES = os.path.join(BASE, 'round2_features.js')
OUT = os.path.join(BASE, 'Agent新手村_R1.2-round2-dev.html')

BUCKETS = ['splash', 'onboard', 'character', 'node', 'done', 'background', 'boss', 'certificate', 'ui']


def build_seed():
    seed_lines = []
    for b in BUCKETS:
        d = os.path.join(BASE, 'assets', b)
        m = {}
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.endswith('.png'):
                    m[f[:-4]] = '%s/%s' % (b, f)
        seed_lines.append('  AssetRegistry.%s = %s;' % (b, json.dumps(m, ensure_ascii=False)))
    return '\n'.join(seed_lines)


def main():
    with open(FEATURES, 'r', encoding='utf-8') as f:
        feat = f.read()
    seed = build_seed()
    if '/*__ASSET_SEED__*/' in feat:
        feat = feat.replace('/*__ASSET_SEED__*/', seed)
    else:
        raise SystemExit('missing /*__ASSET_SEED__*/ marker in round2_features.js')

    with open(ALPHA2, 'r', encoding='utf-8') as f:
        html = f.read()

    script_block = '\n<script>\n' + feat + '\n</script>\n'
    # 关键: 注入到「真正的」</body>(文档末尾), 而非首个 </body> 字符串字面量
    # (引擎代码里可能含 '</body></html>' 这类字符串, 误替换会导致 round2 被塞进主 <script> 块内)。
    idx = html.rfind('</body>')
    if idx >= 0:
        html = html[:idx] + script_block + html[idx:]
    else:
        idx = html.rfind('</html>')
        if idx >= 0:
            html = html[:idx] + script_block + html[idx:]
        else:
            html = html + script_block

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', OUT, '(', len(html), 'chars )')


if __name__ == '__main__':
    main()
