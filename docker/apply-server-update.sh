#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
compose() { docker compose -f docker-compose.yearly.yml "$@"; }
revision="$(git rev-parse HEAD)"
echo "[deploy] revision=$revision start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
compose config --quiet

# Determine how to drain the initial, pre-deployment-helper image safely.
legacy=""
if ! compose exec -T current-year node -e 'process.exit(require("./docker/yearly-scheduler.cjs").DRAIN_VERSION === 1 ? 0 : 1)'; then
  node -e 'const s=require("./config/yearly/jobs.json"); if(s.historical_years.length) throw Error("Upgrade legacy workers with an empty historical queue first")'
  legacy="--legacy"
fi

docker buildx build --builder music-release-rss-builder --load \
  -t "moosicgraff-yearly:$revision" -t moosicgraff-yearly:server .
docker buildx stop music-release-rss-builder
docker run --rm --cpus=0.5 --memory=256m --entrypoint node moosicgraff-yearly:server \
  --test docker/tests/yearly-scheduler.test.cjs docker/tests/deploy.test.cjs
compose run --rm --no-deps --entrypoint node current-year build/index.js db.status

mkdir -p output/yearly/current output/yearly/historical
cleanup() {
  rm -f output/yearly/current/pause output/yearly/historical/pause
}
trap cleanup EXIT
trap 'exit 1' INT TERM
touch output/yearly/current/pause output/yearly/historical/pause
echo "[deploy] Waiting for active jobs to finish; no running command will be interrupted."
until node docker/deploy-state.cjs $legacy; do sleep 30; done
compose up -d --no-build
cleanup
compose ps
printf '%s\n' "$revision" > output/yearly/deployed-revision
echo "[deploy] complete revision=$revision finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
