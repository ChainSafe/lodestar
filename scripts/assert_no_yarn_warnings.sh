#!/bin/bash

# run yarn install --check-files, capturing stderr
OUTPUT=$(yarn install --check-files 2>&1)

echo $OUTPUT

# grep the output for 'warning'
if echo "$OUTPUT" | grep -qi 'warning'; then
  echo "There were warnings in yarn install --check-files"
  exit 1
else
  echo "No warnings in yarn install --check-files"
fi
