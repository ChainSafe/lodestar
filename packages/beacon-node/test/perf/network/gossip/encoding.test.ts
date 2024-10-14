import {itBench} from "@dapplion/benchmark";
import {toHex} from "@lodestar/utils";

/**
 * This is a benchmark for different ways of converting a gossipsub message id to a hex string using Mac M1
 *   encoding
    ✔ toHex                                                                6463330 ops/s    154.7190 ns/op        -       7170 runs   1.26 s
    ✔ Buffer.from                                                          6696982 ops/s    149.3210 ns/op        -       2023 runs  0.454 s
    ✔ shared Buffer                                                    1.013911e+7 ops/s    98.62800 ns/op        -       3083 runs  0.404 s
 */
describe("encoding", () => {
  const msgId = Uint8Array.from(Array.from({length: 20}, (_, i) => i));

  const runsFactor = 1000;
  itBench({
    id: "toHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        toHex(msgId);
      }
    },
    runsFactor,
  });

  itBench({
    id: "Buffer.from",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        "0x" + Buffer.from(msgId.buffer, msgId.byteOffset, msgId.byteLength).toString("hex");
      }
    },
    runsFactor,
  });

  const sharedBuf = Buffer.from(msgId);
  itBench({
    id: "shared Buffer",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        sharedBuf.set(msgId);
        "0x" + sharedBuf.toString("hex");
      }
    },
    runsFactor,
  });
});
