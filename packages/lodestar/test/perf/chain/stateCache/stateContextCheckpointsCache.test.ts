import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {generateCachedState} from "../../../utils/state";
import {CheckpointStateCache} from "../../../../src/chain/stateCache";
import {Checkpoint} from "../../../../../types/phase0";

describe.skip("CheckpointStateCache perf tests", function () {
  let state: CachedBeaconState<allForks.BeaconState>;
  let checkpoint: Checkpoint;
  let checkpointStateCache: CheckpointStateCache;

  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 1 * 1000,
    runs: 1024,
  });

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
