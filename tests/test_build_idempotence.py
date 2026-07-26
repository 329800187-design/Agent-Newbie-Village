#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建幂等性测试(v5 转发器)
v5 起构建幂等由 tests/test_release_zip_idempotence.py 全权负责
（两轮 --skeleton, 校验三 HTML + 骨架 ZIP 哈希一致）。
本文件保留旧入口名, 直接转发, 避免旧文档/流水线断链。
"""
import subprocess
import sys
from pathlib import Path

target = Path(__file__).resolve().parent / "test_release_zip_idempotence.py"
sys.exit(subprocess.run([sys.executable, str(target)]).returncode)
