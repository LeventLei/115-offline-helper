#!/usr/bin/env python3
"""检查提交内容和身份；只输出文件、行号和规则，不输出敏感值。"""
import argparse
import re
import subprocess
import sys

RULES = {
    "本机用户路径": re.compile(r"(?:/" + r"Users/|/" + r"home/|[A-Za-z]:\\Users\\)[^\s\"'<>]+"),
    "私人邮箱": re.compile(r"[\w.+-]+@([\w.-]+\.[A-Za-z]{2,})"),
    "私钥": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "访问密钥": re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{32,}|AKIA[A-Z0-9]{16})"),
    "硬编码凭据": re.compile(r"(?:SEID|api[_-]?key|access[_-]?token|password|authorization)\s*[=:]\s*[\"'][^\"']{16,}[\"']", re.I),
    "疑似真实目录CID": re.compile(r"(?:预处理|Preprocess|CID\s*[=:])\s*:?\s*\d{15,}", re.I),
}


def git(*args):
    return subprocess.check_output(["git", *args])


def check_content(raw, path):
    if b"\x00" in raw:
        return []
    text = raw.decode("utf-8", errors="replace")
    hits = []
    for rule, pattern in RULES.items():
        for match in pattern.finditer(text):
            if rule == "私人邮箱" and match.group(1).lower() in {"users.noreply.github.com", "github.com", "example.com", "example.test"}:
                continue
            hits.append(f"{path}:{text[:match.start()].count(chr(10)) + 1}: {rule}")
    return hits


def check_identity(name, email):
    # 本地所有新提交使用同一个已确认的 GitHub 匿名身份。
    return name == "LeventLei" and email.lower() == "19942206+leventlei@users.noreply.github.com"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", action="store_true")
    parser.add_argument("--stdin", action="store_true")
    parser.add_argument("--ref", help="仅扫描指定提交及其全部祖先；默认扫描全部引用")
    args = parser.parse_args()
    errors = []
    if args.stdin:
        errors.extend(check_content(sys.stdin.buffer.read(), "stdin"))
    elif args.history:
        commits = git("rev-list", args.ref or "--all").decode().splitlines()
        seen = set()
        for commit in commits:
            author, email, committer, cemail = git("show", "-s", "--format=%an%n%ae%n%cn%n%ce", commit).decode().splitlines()
            for name, address in [(author, email), (committer, cemail)]:
                # 仅检查本项目作者；保留已公开的上游贡献者身份。
                if name.lower() in {"leventlei", "leilw"} and not check_identity(name, address):
                    errors.append(f"{commit[:12]}: 项目作者未使用匿名GitHub身份")
            for row in git("ls-tree", "-r", commit).decode().splitlines():
                meta, path = row.split("\t", 1)
                _, kind, oid = meta.split()
                if kind != "blob" or oid in seen:
                    continue
                seen.add(oid)
                errors.extend(check_content(git("cat-file", "blob", oid), path))
    else:
        name = git("var", "GIT_AUTHOR_IDENT").decode().split(" <", 1)[0]
        email = git("var", "GIT_AUTHOR_IDENT").decode().split("<", 1)[1].split(">", 1)[0]
        committer = git("var", "GIT_COMMITTER_IDENT").decode()
        cname, cemail = committer.split(" <", 1)[0], committer.split("<", 1)[1].split(">", 1)[0]
        if not check_identity(name, email) or not check_identity(cname, cemail):
            errors.append("提交身份不符合项目匿名策略，请运行 scripts/setup-privacy.sh")
        for path in git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").decode().split("\0"):
            if path:
                errors.extend(check_content(git("show", ":" + path), path))
    if errors:
        print("隐私检查失败（敏感值已隐藏）：", file=sys.stderr)
        print("\n".join(sorted(set(errors))), file=sys.stderr)
        return 1
    print("隐私检查通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
