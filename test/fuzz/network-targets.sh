#!/bin/bash
NETWORK_TARGETS=()
declare -A NETWORK_CORPUS NETWORK_INPUT_MAX NETWORK_MODE
while read -r name corpus input_max link mode extra; do
    if [[ ! "$name" =~ ^(network|discv5)_[a-z0-9_]+$ || ! "$input_max" =~ ^[1-9][0-9]*$ ||
          ! "$corpus" =~ ^(initial|cmin)$ || ! "$link" =~ ^(none|snappy|quiche|all)$ ||
          ! "$mode" =~ ^(persistent|snapshot)?$ || -n "$extra" || -n "${NETWORK_CORPUS[$name]:-}" ]]; then
        echo "Invalid or duplicate network fuzz target: $name" >&2
        return 1
    fi
    NETWORK_TARGETS+=("$name")
    NETWORK_CORPUS["$name"]="$corpus"
    NETWORK_INPUT_MAX["$name"]="$input_max"
    NETWORK_MODE["$name"]="${mode:-persistent}"
done < "$(dirname "${BASH_SOURCE[0]}")/network-targets.tsv"
