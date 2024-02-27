import {randomBytes} from "node:crypto";
import * as snappyjs from "snappyjs";
import * as snappy from "snappy";
import {itBench} from "@dapplion/benchmark";

describe("network / gossip / snappy", () => {
  for (const msgLen of [100, 200, 300, 400, 500, 1000, 10000, 100000]) {
    const uncompressed = randomBytes(msgLen);
    const compressed = snappyjs.compress(uncompressed);
    const RUNS_FACTOR = 1000;

    itBench({
      id: `snappyjs compress ${msgLen} bytes`,
      runsFactor: RUNS_FACTOR,
      fn: () => {
        for (let i = 0; i < RUNS_FACTOR; i++) {
          snappyjs.compress(uncompressed);
        }
      },
    });

    itBench({
      id: `snappyjs uncompress ${msgLen} bytes`,
      runsFactor: RUNS_FACTOR,
      fn: () => {
        for (let i = 0; i < RUNS_FACTOR; i++) {
          snappyjs.uncompress(compressed);
        }
      },
    });

    itBench({
      id: `snappy compress ${msgLen} bytes`,
      runsFactor: RUNS_FACTOR,
      fn: () => {
        for (let i = 0; i < RUNS_FACTOR; i++) {
          snappy.compressSync(uncompressed);
        }
      },
    });

    itBench({
      id: `snappy uncompress ${msgLen} bytes`,
      runsFactor: RUNS_FACTOR,
      fn: () => {
        for (let i = 0; i < RUNS_FACTOR; i++) {
          snappy.uncompressSync(compressed);
        }
      },
    });
  }
});
