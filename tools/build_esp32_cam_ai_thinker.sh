#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "${project_root}/tools/board_profiles.py" build esp32-cam-ai-thinker
