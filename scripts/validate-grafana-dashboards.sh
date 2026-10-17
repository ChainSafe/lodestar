#!/bin/bash

# Checks every dashboard is linted, without rewriting it; `pnpm lint-dashboards` fixes them
if ! node scripts/lint-grafana-dashboards.mjs ./dashboards --check; then
  echo 'dashboards need fixing: run pnpm lint-dashboards'
  exit 1
fi
echo 'dashboards clean'
