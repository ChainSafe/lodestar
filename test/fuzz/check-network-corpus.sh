#!/bin/bash
set -euo pipefail
FUZZ_DIR="$(cd "$(dirname "$0")" && pwd)"
generated="${1:?usage: check-network-corpus.sh GENERATED_CORPUS}"

# QUIC handshakes and TLS certificates use native entropy. Their paths are checked
# by the generator; these wire seeds have reproducible bytes.
for seed in discv5_wire-initial/{ping,truncated-rlp,whoareyou,signed-enr,invalid-enr} network_quic_receive-initial/short-header; do
    cmp "${FUZZ_DIR}/corpus/$seed" "$generated/$seed"
done
echo "Deterministic network seeds match the committed corpus."
