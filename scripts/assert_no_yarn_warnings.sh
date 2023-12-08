#!/bin/bash

# run yarn install --check-files, capturing stderr
OUTPUT=$(yarn install --check-files 2>&1)

echo $OUTPUT

MATCH=("warning")

# There are few yarn warnings we can't find a fix for. Excluding those.
# TODO: Keep checking occasionally if the warnings are fixed upstream.
EXCLUDE=("Pattern \[\".*\"\] is trying to unpack in the same destination")

MATCH_ARGS=()
EXCLUDE_ARGS=()
for m in "${MATCH[@]}"; do MATCH_ARGS+=(-e "'$m'"); done
for e in "${EXCLUDE[@]}"; do EXCLUDE_ARGS+=(-e "'$e'"); done

echo "Running 'grep -qi ${MATCH_ARGS[@]} | grep -qi -v ${EXCLUDE_ARGS[@]}'"

# grep the output for 'warning'
if echo "$OUTPUT" | grep -qi "${MATCH_ARGS[@]}" | grep -qi -v "${EXCLUDE_ARGS[@]}"; then
  echo "There were warnings in yarn install --check-files"
  exit 1
else
  echo "No warnings in yarn install --check-files"
fi
