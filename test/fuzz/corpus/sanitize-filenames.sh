#!/bin/sh
# Rename AFL++ output files to replace colons with underscores.
# Colons are invalid on Windows (NTFS) and macOS (HFS+/APFS).
#
# Usage: ./sanitize-filenames.sh [directory ...]
# Defaults to all *-cmin directories in the same directory as this script.

cd "$(dirname "$0")" || exit 1

if [ $# -gt 0 ]; then
  set -- "$@"
else
  set -- ssz_basic-cmin ssz_bitlist-cmin ssz_bitvector-cmin \
         ssz_bytelist-cmin ssz_containers-cmin ssz_lists-cmin
fi

for dir in "$@"; do
  [ -d "$dir" ] || continue
  for f in "$dir"/*; do
    [ -f "$f" ] || continue
    newname=$(echo "$f" | tr ':' '_')
    [ "$f" != "$newname" ] && mv "$f" "$newname"
  done
done
