import {randomBytes} from "node:crypto";
import * as snappyjs from "snappyjs";
import * as snappy from "snappy";
import {itBench} from "@dapplion/benchmark";

// eslint-disable-next-line import/order
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const snappyWasm = require("snappy-wasm") as typeof import("snappy-wasm");

describe("network / gossip / snappy", () => {
  const msgLens = [100, 200, 300, 400, 500, 1000, 10000, 100000];
  describe("compress", () => {
    for (const msgLen of msgLens) {
      const uncompressed = randomBytes(msgLen);
      const RUNS_FACTOR = 1000;

      itBench({
        id: `${msgLen} bytes - compress - snappyjs`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappyjs.compress(uncompressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - compress - snappy`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappy.compressSync(uncompressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - compress - snappy-wasm`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappyWasm.compress_raw(uncompressed);
          }
        },
      });
    }
  });
  describe("uncompress", () => {
    for (const msgLen of msgLens) {
      const uncompressed = randomBytes(msgLen);
      const compressed = snappyjs.compress(uncompressed);
      const RUNS_FACTOR = 1000;

      itBench({
        id: `${msgLen} bytes - uncompress - snappyjs`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappyjs.uncompress(compressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - uncompress - snappy`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappy.uncompressSync(compressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - uncompress - snappy-wasm`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappyWasm.decompress_raw(compressed);
          }
        },
      });
    }
  });
});
