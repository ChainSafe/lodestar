import {config} from "@chainsafe/lodestar-config/default";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {generateCachedState} from "../../../utils/state";
import {CheckpointStateCache} from "../../../../src/chain/stateCache";

describe("CheckpointStateCache perf tests", function () {
  it("should run test", async () => {
    const checkpointStateCache = new CheckpointStateCache(config);
    const state = generateCachedState();
    const checkpoint = ssz.phase0.Checkpoint.defaultValue();
    const runner = new BenchmarkRunner("CheckpointStateCache perf test", {
      minMs: 1000,
      runs: 1024,
    });

    await runner.run({
      id: "CheckpointStateCache: add, get, delete",
      run: () => {
        checkpointStateCache.add(checkpoint, state);
        checkpointStateCache.get(checkpoint);
        checkpointStateCache.delete(checkpoint);
      },
    });

    runner.done();
  });
});
