import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks, ssz, phase0} from "@chainsafe/lodestar-types";
import {generateCachedState} from "../../../utils/state";
import {CheckpointStateCache} from "../../../../src/chain/stateCache";

describe("CheckpointStateCache perf tests", function () {
  let state: CachedBeaconState<allForks.BeaconState>;
  let checkpoint: phase0.Checkpoint;
  let checkpointStateCache: CheckpointStateCache;

  setBenchOpts({maxMs: 10 * 1000, threshold: Infinity});

  before(() => {
    checkpointStateCache = new CheckpointStateCache();
    state = generateCachedState();
    checkpoint = ssz.phase0.Checkpoint.defaultValue();
  });

  itBench("CheckpointStateCache - add get delete", () => {
    checkpointStateCache.add(checkpoint, state);
    checkpointStateCache.get(checkpoint);
    checkpointStateCache.delete(checkpoint);
  });
});
