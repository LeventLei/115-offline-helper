#!/bin/sh
set -eu
cd "$(dirname "$0")"
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -x "$candidate" ] && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))'; then
    "$candidate" updater.py --install "$@"
    exit 0
  fi
done
printf '%s\n' '需要Python 3.9或更新版本。安装后重新运行此安装器。' >&2
exit 1
