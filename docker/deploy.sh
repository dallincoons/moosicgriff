#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ "$(git branch --show-current)" != main ]; then
  echo "Deploy from main; merge your changes first." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit local changes before deploying." >&2
  exit 1
fi
git push origin main
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes forge@142.93.6.169 '
  cd /home/forge/moosicgraff
  mkdir -p output/yearly
  (nohup sh docker/deploy-server.sh >> output/yearly/deploy.log 2>&1 < /dev/null &)
'
echo "Server deployment started. Follow it with:"
echo "ssh forge@142.93.6.169 'tail -f /home/forge/moosicgraff/output/yearly/deploy.log'"
