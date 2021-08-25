#!/usr/bin/env bash

# Should ONLY run on CI/GA for releases
NUM_WEEK=$(date +%V)

# Fails every other week with exit "1"
if [[ $(($NUM_WEEK%2)) -eq 1 ]]; then
    echo "Even week, skipping release..."
    exit 1
fi
