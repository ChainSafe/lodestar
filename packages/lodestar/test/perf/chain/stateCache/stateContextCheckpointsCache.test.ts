import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz, phase0} from "@chainsafe/lodestar-types";
import {generateCachedState} from "../../../utils/state";
import {CheckpointStateCache, toCheckpointHex} from "../../../../src/chain/stateCache";

describe("CheckpointStateCache perf tests", function () {
  setBenchOpts({noThreshold: true});

  let state: CachedBeaconStateAllForks;
  let checkpoint: phase0.Checkpoint;
  let checkpointStateCache: CheckpointStateCache;

  before(() => {
    checkpointStateCache = new CheckpointStateCache({});
    state = generateCachedState();
    checkpoint = ssz.phase0.Checkpoint.defaultValue();
  });

  itBench("CheckpointStateCache - add get delete", () => {
    checkpointStateCache.add(checkpoint, state);
    checkpointStateCache.get(toCheckpointHex(checkpoint));
    checkpointStateCache.delete(checkpoint);
  });
});
