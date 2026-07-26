#!/usr/bin/env bash
set -euo pipefail

target="${1:-esp32}"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v idf.py >/dev/null 2>&1; then
  echo "idf.py is not available; activate ESP-IDF first." >&2
  exit 2
fi

mkdir -p "${project_root}/build"
for mode in sd-disabled sdmmc sdspi; do
  build_dir="${project_root}/build/${target}-${mode}"
  # Keep sdkconfig outside build_dir because `set-target` clears build_dir.
  sdkconfig_file="${project_root}/build/sdkconfig-${target}-${mode}"
  idf.py -B "${build_dir}" \
    -D "SDKCONFIG=${sdkconfig_file}" \
    -D "SDKCONFIG_DEFAULTS=${project_root}/sdkconfig.defaults;${project_root}/sdkconfig.ci.${mode}" \
    set-target "${target}" build
done
