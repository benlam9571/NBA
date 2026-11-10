#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cache="$root/.cache/hoopr"
if [ ! -d "$cache/.git" ]; then
  git clone --depth 1 --filter=blob:none --no-checkout https://github.com/sportsdataverse/hoopR-nba-data.git "$cache"
fi
git -C "$cache" sparse-checkout init --no-cone
git -C "$cache" sparse-checkout set 'nba/player_box/parquet/*202[67]*' 'nba/schedules/parquet/*2027*'
git -C "$cache" fetch --depth 1 origin HEAD
git -C "$cache" checkout --detach FETCH_HEAD
"${PYTHON:-python3}" "$root/etl/build_data.py" --source "$cache" --output "$root/data" "$@"
