import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {ssz, phase0} from "@lodestar/types";
import {generateCachedState} from "../../../utils/state.js";
import {InMemoryCheckpointStateCache, toCheckpointHex} from "../../../../src/chain/stateCache/index.js";

describe("InMemoryCheckpointStateCache perf tests", () => {
  setBenchOpts({noThreshold: true});

  let state: CachedBeaconStateAllForks;
  let checkpoint: phase0.Checkpoint;
  let checkpointStateCache: InMemoryCheckpointStateCache;

  before(() => {
    checkpointStateCache = new InMemoryCheckpointStateCache({});
    state = generateCachedState();
    checkpoint = ssz.phase0.Checkpoint.defaultValue();
  });

  itBench("InMemoryCheckpointStateCache - add get delete", () => {
    checkpointStateCache.add(checkpoint, state);
    checkpointStateCache.get(toCheckpointHex(checkpoint));
    checkpointStateCache.delete(checkpoint);
  });
});
