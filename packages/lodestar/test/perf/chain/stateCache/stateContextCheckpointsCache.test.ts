import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {generateCachedState} from "../../../utils/state";
import {CheckpointStateCache} from "../../../../src/chain/stateCache";

describe("CheckpointStateCache perf tests", function () {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 1 * 1000,
    runs: 1024,
  });

  const checkpointStateCache = new CheckpointStateCache(config);
  const state = generateCachedState();
  const checkpoint = ssz.phase0.Checkpoint.defaultValue();

  itBench("CheckpointStateCache - add get delete", () => {
    checkpointStateCache.add(checkpoint, state);
    checkpointStateCache.get(checkpoint);
    checkpointStateCache.delete(checkpoint);
  });
});
