set -euo pipefail
ENCLAVE=builder-dev
TEMP=./temp/builder-dev
KURTOSIS_VERSION="1.20.0"
METRICS_PORT="${METRICS_PORT:-5077}"

          PUBKEY="0x$(jq -r .pubkey "$TEMP/keystore.json")"
          BN_URL="$(kurtosis port print "$ENCLAVE" cl-2-lodestar-geth http)"

          # wait for BN to be healthy
          timeout 120 bash -c "until curl -sf $BN_URL/eth/v1/node/health >/dev/null; do sleep 3; done"

          START_FINALIZED="$(curl -sf "$BN_URL/eth/v1/beacon/states/head/finality_checkpoints" \
            | jq -r .data.finalized.epoch)"

          LODESTAR_PRESET=minimal ./lodestar builder \
            --keystore "$TEMP/keystore.json" \
            --keystorePassword "$TEMP/password.txt" \
            --builderPubkey "$PUBKEY" \
            --beaconNodeUrl "$BN_URL" \
            --executionFeeRecipient 0x8943545177806ed17b9f23f0a21ee5948ecaa776 \
            --paramsFile "$TEMP/netcfg/config.yaml" \
            --metrics \
            --metrics.port "$METRICS_PORT" \
            > builder.log 2>&1 &
          BUILDER_PID=$!
          trap 'kill "$BUILDER_PID" 2>/dev/null || true' EXIT

          alive() { kill -0 "$BUILDER_PID" 2>/dev/null; }
          died() { echo "builder $1"; wait "$BUILDER_PID" || echo "exit code: $?"; exit 1; }

          # readiness: metrics server up (bounded to ~4 minimal epochs)
          timeout 10 bash -c \
            'until curl -sf localhost:'"$METRICS_PORT"'/metrics >/dev/null; do kill -0 '"$BUILDER_PID"' || exit 1; sleep 3; done'
          alive || died "exited before metrics server came up"

          # builder reaches active (status gauge is set once per epoch)
          timeout 10 bash -c \
            'until curl -sf localhost:'"$METRICS_PORT"'/metrics | grep -q "^bc_builder_status 1$"; do kill -0 '"$BUILDER_PID"' || exit 1; sleep 6; done'
          alive || died "exited before becoming active"

          # soak ~3 epochs
          for _ in $(seq 1 24); do
            alive || died "exited during soak"
            sleep 6
          done

          END_FINALIZED="$(curl -sf "$BN_URL/eth/v1/beacon/states/head/finality_checkpoints" \
            | jq -r .data.finalized.epoch)"
          if [ "$END_FINALIZED" -le "$START_FINALIZED" ]; then
            echo "finality did not advance ($START_FINALIZED -> $END_FINALIZED)"; exit 1
          fi

          if grep -qE '\]\s+error:' builder.log; then
            echo "error-level lines in builder.log"; exit 1
          fi

          echo "smoke check passed"

