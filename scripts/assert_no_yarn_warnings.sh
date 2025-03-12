#!/bin/bash

# Now modern packages support multiple runtimes
# while the Yarn 1 shows warnings for engines other than node
IGNORE_WARNINGS=(
  'engine "deno" appears to be invalid'
  'engine "bun" appears to be invalid'
  'engine "bare" appears to be invalid'
)

# Run yarn install --check-files and capture output
OUTPUT=$(yarn install --check-files 2>&1)
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
  echo "There were unexpected warnings in yarn install --check-files"
  exit 1
else
  echo "No unexpected warnings in yarn install --check-files"
fi
