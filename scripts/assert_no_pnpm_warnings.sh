#!/bin/bash

IGNORE_WARNINGS=(
  'WARN  using --force I sure hope you know what you are doing'
)

# Run pnpm install --force and capture output
OUTPUT=$(pnpm install --force 2>&1)
echo "$OUTPUT"

# Build grep filter arguments dynamically
FILTER_ARGS=()
for pattern in "${IGNORE_WARNINGS[@]}"; do
  FILTER_ARGS+=(-e "$pattern")
done

# Filter out specified warnings
FILTERED_OUTPUT=$(echo "$OUTPUT" | grep -viF "${FILTER_ARGS[@]}")

# Check for remaining warnings
if echo "$FILTERED_OUTPUT" | grep -qi 'warning'; then
  echo "There were unexpected warnings in pnpm install"
  exit 1
else
  echo "No unexpected warnings in pnpm install"
fi
