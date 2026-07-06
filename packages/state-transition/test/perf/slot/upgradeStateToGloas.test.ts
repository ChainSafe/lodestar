import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bench, describe, setBenchOpts} from "@chainsafe/benchmark";
import {setHasher} from "@chainsafe/persistent-merkle-tree";
import {hasher as hashtreeHasher} from "@chainsafe/persistent-merkle-tree/hasher/hashtree";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig, config as chainForkConfig} from "@lodestar/config/default";
import {createPubkeyCache} from "../../../src/cache/pubkeyCache.js";
import {CachedBeaconStateFulu, createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {upgradeStateToGloas} from "../../../src/slot/index.js";
import {getStateSlotFromBytes, getStateTypeFromBytes} from "../../../src/util/sszBytes.js";

// ESM: no __dirname by default. Default path = repo-root mainnet_state_14707840.ssz (5 levels up:
// slot -> perf -> test -> state-transition -> packages -> repo root). Override via env var
// so the path can be changed on the user's server.
// Use the SIMD hashtree hasher, as production does (see packages/cli/src/applyPreset.ts). The pmt
// default is the pure-JS noble hasher, which makes hashTreeRoot several times slower than reality.
setHasher(hashtreeHasher);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_SSZ_PATH = process.env.STATE_SSZ_PATH ?? path.join(dirname, "../../../../../mainnet_state_14707840.ssz");

// Enable per-step timing logs inside upgradeStateToGloas() for profiling
process.env.LOG_GLOAS_UPGRADE_TIMING = "true";

function step(label: string, start: number): number {
  const end = performance.now();
  console.log(`[bench] ${label}: ${(end - start).toFixed(1)}ms`);
  return end;
}

describe("upgradeStateToGloas", () => {
  // Each op is ~35s on a mainnet-sized state, so the default maxMs/minMs stop after a single
  // (untested) run. Force a batch of runs and raise maxMs so the average is statistically meaningful.
  setBenchOpts({
    noThreshold: true,
    minRuns: 4,
    maxRuns: 4,
    // maxWarmUpRuns defaults to 1000, which must be < maxRuns; one warm-up run is enough here
    maxWarmUpRuns: 1,
    maxMs: 10 * 60 * 1000,
  });

  bench<CachedBeaconStateFulu, CachedBeaconStateFulu>({
    id: "upgradeStateToGloas mainnet state",
    before: () => {
      let t = performance.now();
      const bytes = new Uint8Array(fs.readFileSync(STATE_SSZ_PATH));
      t = step("readFileSync", t);

      // Extract + log the state slot from the raw bytes (offset 40)
      const slot = getStateSlotFromBytes(bytes);
      console.log("state slot", slot);

      // Mainnet config: FULU_FORK_EPOCH=411392, GLOAS_FORK_EPOCH=Infinity -> slot resolves to fulu
      const stateType = getStateTypeFromBytes(chainForkConfig, bytes); // ssz.fulu.BeaconState
      const stateView = stateType.deserializeToViewDU(bytes);
      t = step("deserializeToViewDU", t);

      const config = createBeaconConfig(chainConfig, stateView.genesisValidatorsRoot);
      const cachedState = createCachedBeaconState(stateView, {
        config,
        pubkeyCache: createPubkeyCache(),
      }) as CachedBeaconStateFulu;
      t = step("createCachedBeaconState", t);

      // Warm up: cache all HashObjects on the seed state so the benchmark doesn't pay for the
      // Fulu state's initial merkleization
      cachedState.hashTreeRoot();
      step("seed hashTreeRoot", t);

      return cachedState;
    },
    // upgradeStateToGloas commits/consumes the input view and shares its epochCtx -> clone per run
    beforeEach: (state) => state.clone(),
    fn: (state) => {
      let t = performance.now();
      const gloasState = upgradeStateToGloas(state);
      t = step("upgradeStateToGloas", t);
      gloasState.hashTreeRoot();
      step("gloas hashTreeRoot", t);
    },
  });
});
