#!/bin/bash
set -euo pipefail
command_directory="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec /bin/bash "$command_directory/scripts/verify-macos.sh"
