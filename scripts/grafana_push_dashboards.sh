#!/bin/bash

# Utility script to push dashboards to Grafana via its HTTP API. Useful to quickly sync local dashboards
#
# USAGE:
#
# API_URL=http://localhost:3000 API_USERPASS=admin:admin ./grafana_push_dashboards.sh dashboards/*.json
#
# - Accepts a single file, a file glob, or multiple combinations of both
# - Set API_URL to the root Grafana API url: API_URL=https://yourgrafana.server
# - Set API_USERPASS to `$user:$password`: API_USERPASS=admin:admin

if [ $# -eq 0 ]; then
  echo "No arguments supplied"
  exit 1
fi

# Accepts a single file, a file glob, or multiple combinations of both
for fileglob in "${@:1}"; do
  for filename in $fileglob; do
    echo "Uploading dashboard $filename"

    # https://grafana.com/docs/grafana/latest/http_api/dashboard/#create--update-dashboard
    # 
    # POST /api/dashboards/db HTTP/1.1
    # Accept: application/json
    # Content-Type: application/json

    # To authenticate with token. However, token cannot be provisioned so it's harder to use with ansible
    # Authorization: Bearer eyJrIjoiT0tTcG1pUlY2RnVKZTFVaDFsNFZXdE9ZWmNrMkZYbk
    #
    # To authenticate with user:password
    # curl http://admin:admin@localhost:3000/api/search

    curl -X POST \
      -H "Accept: application/json" \
      -H "Content-Type: application/json" \
      -u $API_USERPASS \
      -d @$filename \
      ${API_URL}/api/dashboards/import
  done
done

# TODO: Only overwrite if changes are detected. But it's not easy to do.
#
# 1. Check version of existing dashboard. However, we may not bump the version
#
# GET /api/dashboards/uid/:uid
# {
#   "uid": "lodestar",
#   "version": 2,
# }
#
# 2. Hash existing dashboard and compare with new dashboard. However, Grafana may render them differently

