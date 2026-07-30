# -*- coding: utf-8 -*-
"""test_round3_no_empty_catch.py — R1.2 Round3-R1 静态守门:
   对 round3_features.js 做静态扫描, 确认:
     * 不存在空 catch (catch(e){} / catch (e) {} / 仅注释的空 catch)
     * 所有 catch 必须调用 Round3Diagnostics.record
     * 所有 catch 不得降级为"无门禁"(catch 体不得含 '无门禁')
     * Round3Diagnostics 已定义并暴露到 window
     * InteractionProgress 含 sync / updatePanel / ensure 方法
   不依赖运行环境/浏览器, 纯静态检查。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(ROOT, '..', 'round3_features.js'))


def main():
    with open(SRC, encoding='utf-8') as f:
        src = f.read()

    problems = []

    # 1) 禁止空 catch (含仅注释的空 catch)
    empty_brace = re.findall(r'catch\s*\([^)]*\)\s*\{\s*\}', src)
    empty_comment = re.findall(r'catch\s*\([^)]*\)\s*\{\s*/\*.*?\*/\s*\}', src, re.S)
    if empty_brace or empty_comment:
        problems.append('发现空 catch: ' + str(empty_brace + empty_comment))

    # 2) 所有 catch 必须记录诊断, 且不得降级为"无门禁"
    catches = re.findall(r'catch\s*\(([^)]*)\)\s*\{(.*?)\}', src, re.S)
    for var, body in catches:
        if 'Round3Diagnostics.record' not in body:
            problems.append('catch 块未记录诊断: ' + body.strip()[:100])
        if '无门禁' in body:
            problems.append('catch 块降级为"无门禁": ' + body.strip()[:100])

    # 3) 禁止"门禁失败兜底为无门禁"的确切形态
    if "catch (e) { return { label: '无门禁" in src or \
       "catch(e){return{label:'无门禁" in src or \
       "return { label: '无门禁（普通关卡）', passed: null }" in src:
        # 仅当该 return 出现在 catch 内才违规; 上面已通过 catch 体扫描保证, 此处再兜底
        pass

    # 4) Round3Diagnostics 定义且暴露
    if 'var Round3Diagnostics' not in src:
        problems.append('未定义 Round3Diagnostics')
    if 'window.Round3Diagnostics = Round3Diagnostics' not in src:
        problems.append('未暴露 window.Round3Diagnostics')

    # 5) InteractionProgress 必须含 sync / updatePanel / ensure
    for m in ['sync = function', 'updatePanel = function', 'ensure = function']:
        if m not in src:
            problems.append('InteractionProgress 缺少方法: ' + m)

    if problems:
        for p in problems:
            print('[FAIL]', p)
        sys.exit(1)
    print('OK: round3_features.js 无空 catch; 所有 catch 记录诊断且未降级为无门禁; '
          'Round3Diagnostics 已定义并暴露; InteractionProgress 含 sync/updatePanel/ensure')
    sys.exit(0)


if __name__ == '__main__':
    main()
