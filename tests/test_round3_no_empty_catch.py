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

    # 3) W6/W7 门禁缺失分支不得降级为"无门禁"/passed:null (fail-closed 守门)
    #    提取 readGate 函数体, 统计其中"无门禁（普通关卡）"/"passed: null"出现次数:
    #    合法的末尾兜底(用于非门禁关卡)只应出现 1 次; 若 >1 说明 W6/W7 缺失分支仍降级。
    rg = src.find('function readGate(levelId)')
    if rg < 0:
        problems.append('未找到 readGate 函数')
    else:
        ob = src.find('{', rg)
        depth = 0
        end = ob
        for i in range(ob, len(src)):
            if src[i] == '{':
                depth += 1
            elif src[i] == '}':
                depth -= 1
                if depth == 0:
                    end = i
                    break
        body = src[ob:end + 1]
        if body.count("无门禁（普通关卡）") > 1:
            problems.append('W6/W7 门禁缺失时仍降级为无门禁')
        if body.count('passed: null') > 1:
            problems.append('W6/W7 门禁缺失分支仍为 passed: null')
        # 6 个门禁缺失处理模式必须覆盖 (门禁对象不存在 / 状态不存在, W6 与 W7 各一对)
        required = [
            "typeof Sim === 'undefined'",
            "!Sim",
            "!Sim.state",
            "typeof WfSim === 'undefined'",
            "!WfSim",
            "!WfSim.state",
        ]
        for p in required:
            if p not in body:
                problems.append('readGate 缺少门禁缺失处理分支: ' + p)

    # 4) Round3Diagnostics 定义且暴露
    if 'var Round3Diagnostics' not in src:
        problems.append('未定义 Round3Diagnostics')
    if 'window.Round3Diagnostics = Round3Diagnostics' not in src:
        problems.append('未暴露 window.Round3Diagnostics')

    # 5) InteractionProgress 必须含 sync / updatePanel / ensure / currentLabel / clearFailure
    for m in ['sync = function', 'updatePanel = function', 'ensure = function',
              'currentLabel = function', 'clearFailure = function']:
        if m not in src:
            problems.append('InteractionProgress 缺少方法: ' + m)

    if problems:
        for p in problems:
            print('[FAIL]', p)
        sys.exit(1)
    print('OK: round3_features.js 无空 catch; 所有 catch 记录诊断且未降级为无门禁; '
          'Round3Diagnostics 已定义并暴露; InteractionProgress 含 sync/updatePanel/ensure/'
          'currentLabel/clearFailure; readGate 门禁缺失分支 fail-closed')
    sys.exit(0)


if __name__ == '__main__':
    main()
