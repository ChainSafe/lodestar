/* eslint-disable import/no-relative-packages */
import {itBench} from "@dapplion/benchmark";
import {generatePerfTestCachedStateAltair} from "../../../../state-transition/test/perf/util.js";

// > yarn benchmark:files packages/beacon-node/test/perf/util/buffer.test.ts
//
// Buffer utils
// ✔ Buffer.from - copy                  7.286412 ops/s    137.2418 ms/op   x1.024         38 runs   5.82 s
// ✔ Buffer.from - no copy                1117318 ops/s    895.0000 ns/op   x0.982     723013 runs   1.11 s
// ✔ Buffer.from - no copy with offset    1179245 ops/s    848.0000 ns/op        -    2699558 runs   3.85 s

describe("Buffer utils", function () {
  let stateBytes: Uint8Array;

  before(function () {
    this.timeout("5min");
    stateBytes = generatePerfTestCachedStateAltair({goBackOneSlot: false, vc: 1_000_000}).serialize();
  });

  itBench({
    id: "Buffer.from - copy",
    fn: () => {
      Buffer.from(stateBytes);
    },
  });

  itBench({
    id: "Buffer.from - no copy",
    fn: () => {
      Buffer.from(stateBytes.buffer);
    },
  });

  itBench({
    id: "Buffer.from - no copy with offset",
    fn: () => {
      Buffer.from(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
    },
  });
});
