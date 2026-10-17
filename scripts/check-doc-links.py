#!/usr/bin/env python3
"""check-doc-links.py — 文档体检：扫描 docs/ 与门面 md 里的路径引用，报断链。

用法（仓库根目录）：
    python scripts/check-doc-links.py

检查范围：
    - docs/**/*.md 全部 Markdown 链接 [text](path) 与行内代码 `path`
    - 根目录门面文件：AGENTS.md / CLAUDE.md / CONTRIBUTING.md / README.md /
      README_EN.md / SECURITY.md / ROADMAP.md

解析规则（按序尝试，命中即算有效）：
    1. 相对文档所在目录
    2. 相对仓库根目录（写 `src/...`、`scripts/...` 这类根相对路径是常态）
    3. 去掉 ./ 前缀后相对仓库根

已知的「合理误报」，本脚本有意放过：
    - http(s):// / mailto: 外链、@/ 别名、含 * 的 glob、$ 变量
    - 形如 `node scripts/bump-version.js` 的命令串（整串不是路径）
    - 只写文件名的简写（如 `loop.ts`），无法判定基准目录

退出码：0 = 无断链；1 = 有断链（可直接挂 CI 或 pre-push 钩子）。
"""

import re
import os
import sys
import glob

FACADE_FILES = [
    'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md',
    'README.md', 'README_EN.md', 'SECURITY.md', 'ROADMAP.md',
]

PATH_EXT_RE = re.compile(
    r'\.(ts|tsx|js|jsx|mjs|cjs|md|json|sql|prisma|ps1|py|sh|css|html|svg|png|db)$'
)
SLASH_RE = re.compile(r'[/\\]')

# 已知历史引用白名单：(文件, 目标路径) —— 文档里「当初怎么写」的决策记录，
# 每一处都在正文带了「未按该名落地 / 早期计划写作 / 仓库外输入」的注解。
# 新增断链不要往这里塞；这里只收「有意保留的历史陈述」。
KNOWN_HISTORICAL = {
    ('docs/IMPLEMENTATION-PLAN.md', 'src/app/api/generate/apply-updates/route.ts'),
    ('docs/IMPLEMENTATION-PLAN.md', 'apply-extraction/route.ts'),
    ('docs/IMPLEMENTATION-PLAN.md', 'write/route.ts'),
    ('docs/IMPLEMENTATION-PLAN.md', 'src/lib/quality-analyzer.ts'),
    ('docs/internal/调研计划-更新优化-2026-09-11.md', 'src/middleware.ts'),
    ('docs/novel-smith-升级计划-2026-09-08.md', 'src/components/FirstRunGuide.tsx'),
    ('ROADMAP.md', 'PROCESS/analysis/novel-smith-精进分析-2026-09-02.md'),
    ('ROADMAP.md', '会议/2.0-plan/chair-integration.md'),
}


def collect_files():
    files = sorted(glob.glob('docs/**/*.md', recursive=True))
    files += [f for f in FACADE_FILES if os.path.exists(f)]
    return files


def resolve(base, target):
    cands = [os.path.join(base, target), target]
    if target.startswith('./'):
        cands.append(target[2:])
    else:
        cands.append(target.lstrip('./'))
    return any(os.path.exists(c) for c in cands)


def scan_file(f):
    text = open(f, encoding='utf-8').read()
    base = os.path.dirname(f)
    broken = []

    # Markdown 链接
    for m in re.finditer(r'\[([^\]]*)\]\(([^)]+)\)', text):
        target = m.group(2).split('#')[0].strip()
        if not target or target.startswith(('http://', 'https://', 'mailto:')):
            continue
        if '*' in target or target.startswith('@/'):
            continue
        if not resolve(base, target):
            broken.append((text[:m.start()].count('\n') + 1, 'link',
                           target, m.group(1)[:40]))

    # 行内代码里的路径
    for m in re.finditer(r'`([^`]+)`', text):
        target = m.group(1).strip()
        if not SLASH_RE.search(target):
            continue
        if target.startswith(('http', '$', '~')) or target.startswith('@/'):
            continue
        if '*' in target or ' ' in target:
            continue
        if not PATH_EXT_RE.search(target):
            continue
        if not resolve(base, target):
            broken.append((text[:m.start()].count('\n') + 1, 'code', target, ''))

    return broken


def main():
    files = collect_files()
    all_broken = []
    for f in files:
        for ln, kind, target, label in scan_file(f):
            if (f.replace('\\', '/'), target) in KNOWN_HISTORICAL:
                continue
            all_broken.append((f, ln, kind, target, label))

    if not all_broken:
        print('OK: %d 个文档未发现断链（已知历史引用已在白名单）' % len(files))
        return 0

    print('发现 %d 个断链：' % len(all_broken))
    for f, ln, kind, target, label in all_broken:
        suffix = (' -> ' + label) if label else ''
        print('  %s:%d [%s] %s%s' % (f, ln, kind, target, suffix))
    print('\n提示：历史计划/调研文档里的过期路径，优先加「已落地/历史快照」回填注解，')
    print('而不是静默改路径——读者需要知道「当初怎么写、现在真实情况是什么」。')
    return 1


if __name__ == '__main__':
    sys.exit(main())
