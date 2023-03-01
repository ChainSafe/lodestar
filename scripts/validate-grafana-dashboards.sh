#!/bin/bash

# This script will mutate the dashboards if anything needs linting
node scripts/lint-grafana-dashboards.mjs ./dashboards

if [[ $(git diff --stat ./dashboards) != '' ]]; then
  git --no-pager diff
  echo 'dashboards need fixing'
  exit 1
else
  echo 'dashboards clean'
fi