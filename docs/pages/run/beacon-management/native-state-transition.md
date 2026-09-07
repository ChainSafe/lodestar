# Experimental native state transition

The hidden `--chain.nativeStateView` beacon-node flag enables the Zig state transition implementation for experimental fleet testing. TypeScript remains the default.

```sh
./lodestar beacon --network <network> --chain.nativeStateView
```

The node selects one implementation at startup. Block import, local block production, state regeneration, checkpoint reloads, and historical-state workers use that selection. There is no runtime switch or automatic fallback. Restart without the flag to use TypeScript.

Native state transition supports Phase0 through Fulu. Creating, loading, or advancing a native state into Gloas or later forks fails with `NATIVE_STF_UNSUPPORTED_FORK`. Restart with the TypeScript implementation before a scheduled Gloas activation. Early builder deposit verification in the preceding Fulu window is skipped because it only accelerates that unsupported fork upgrade.

The native rewards API implementations remain unsupported: block rewards, attestation rewards, and sync committee rewards requests can fail. This flag is intended for controlled fleet experiments and does not promise full API parity.

When metrics are enabled, the selected implementation supplies its state-transition metrics. Native historical-worker metrics use the `lodestar_historical_state_` prefix. Shared chain metrics, including cache clone counters, remain available. In native mode, the shared JavaScript state-root timer uses `lodestar_chain_stfn_hash_tree_root_seconds` so it cannot collide with the native internal timer. Startup logs identify the selected implementation.

For development, `LODESTAR_NATIVE_STF=true` selects native state views in the sanity, finality, fork-transition, and fork-choice spec runners. Gloas and later vectors are excluded from native runs. This environment variable does not enable native state transition in a beacon node; use the CLI flag for that.
