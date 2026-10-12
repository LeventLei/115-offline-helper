#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
git config --local user.name LeventLei
git config --local user.email 19942206+LeventLei@users.noreply.github.com
git config --local user.useConfigOnly true
git config --local core.hooksPath .githooks
printf '%s\n' '已启用本项目匿名提交身份和隐私 hooks；未修改全局 Git 配置。'
