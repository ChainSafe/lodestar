import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {ssz, phase0} from "@lodestar/types";
import {generateCachedState} from "../../../utils/state.js";
import {CheckpointStateCache, toCheckpointHex} from "../../../../src/chain/stateCache/index.js";
import {ShufflingCache} from "../../../../src/chain/shufflingCache.js";

describe("CheckpointStateCache perf tests", function () {
  setBenchOpts({noThreshold: true});

  let state: CachedBeaconStateAllForks;
  let checkpoint: phase0.Checkpoint;
  let checkpointStateCache: CheckpointStateCache;

  before(() => {
    checkpointStateCache = new CheckpointStateCache({shufflingCache: new ShufflingCache()});
    state = generateCachedState();
    checkpoint = ssz.phase0.Checkpoint.defaultValue();
  });

  itBench("CheckpointStateCache - add get delete", () => {
    checkpointStateCache.add(checkpoint, state);
    checkpointStateCache.get(toCheckpointHex(checkpoint));
    checkpointStateCache.delete(checkpoint);
  });
});
