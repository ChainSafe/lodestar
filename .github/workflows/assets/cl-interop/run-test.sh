#!/usr/bin/env bash
set -euo pipefail

api="$1/api/v1"
test_file="$2"

test_id=$(curl -sf -X POST -H "Content-Type: application/yaml" --data-binary "@${test_file}" "${api}/tests/register" | jq -r .data.test_id)
run_id=$(curl -sf -X POST -H "Content-Type: application/json" -d "{\"test_id\":\"${test_id}\"}" "${api}/test_runs/schedule" | jq -r .data.run_id)
echo "Scheduled ${test_id} as run ${run_id}"

while true; do
  status=$(curl -sf "${api}/test_run/${run_id}/status" | jq -r .data)
  case "$status" in
    pending | running) sleep 15 ;;
    *) break ;;
  esac
done

curl -sf "${api}/test_run/${run_id}/details" |
  jq -r '.data.tasks[] | select(.result_error != "context canceled") | "\(.status)\t\(.result)\t\(.title)\(if (.result_error // "") != "" then " — " + .result_error else "" end)"'

echo "${test_id}: ${status}"
[[ "$status" == "success" ]]
