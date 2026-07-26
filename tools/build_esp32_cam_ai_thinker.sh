#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${project_root}/build/esp32-cam-ai-thinker"
sdkconfig_file="${project_root}/build/sdkconfig-esp32-cam-ai-thinker"

if ! command -v idf.py >/dev/null 2>&1; then
  echo "idf.py is not available; activate ESP-IDF first." >&2
  exit 2
fi

mkdir -p "${project_root}/build"
idf.py -B "${build_dir}" \
  -D "IDF_TARGET=esp32" \
  -D "SDKCONFIG=${sdkconfig_file}" \
  -D "SDKCONFIG_DEFAULTS=${project_root}/sdkconfig.defaults;${project_root}/sdkconfig.board.esp32-cam-ai-thinker" \
  build

echo "AI-Thinker ESP32-CAM firmware: ${build_dir}/pocket_arcade.bin"
