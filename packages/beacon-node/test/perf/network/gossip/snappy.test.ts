import {randomBytes} from "node:crypto";
import * as snappyJs from "snappyjs";
import {bench, describe} from "@chainsafe/benchmark";
import snappyWasm from "@chainsafe/snappy-wasm";
import {SnappyDecompressor} from "../../../../src/network/gossip/snappy/snappy-js/decompressor.js";
import {SnappyWasmDecompressor} from "../../../../src/network/gossip/snappy/snappy-wasm.js";

describe("network / gossip / snappy", () => {
  const msgLens = [
    // ->
    100,
    200,
    300,
    400,
    500,
    1000,
    10000, // 100000,
  ];
  describe("compress", () => {
    const encoder = new snappyWasm.Encoder();

    for (const msgLen of msgLens) {
      const uncompressed = randomBytes(msgLen);
      const RUNS_FACTOR = 1000;

      bench({
        id: `${msgLen} bytes - compress - snappyjs`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappyJs.compress(uncompressed);
          }
        },
      });

      bench({
        id: `${msgLen} bytes - compress - snappy-wasm`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            encoder.compress(uncompressed);
          }
        },
      });

      bench({
        id: `${msgLen} bytes - compress - snappy-wasm - prealloc`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            let out = Buffer.allocUnsafe(snappyWasm.max_compress_len(uncompressed.length));
            const len = encoder.compress_into(uncompressed, out);
            out = out.subarray(0, len);
          }
        },
      });
    }
  });

  describe("uncompress", () => {
    for (const msgLen of msgLens) {
      const uncompressed = randomBytes(msgLen);
      const compressed = snappyJs.compress(uncompressed);
      const RUNS_FACTOR = 1000;

      bench({
        id: `${msgLen} bytes - uncompress - snappyjs`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            const snappyJsDecompressor = new SnappyDecompressor(compressed);
            const uncompressedDataLength = snappyJsDecompressor.readUncompressedLength();
            const uncompressedData = Buffer.alloc(uncompressedDataLength);
            if (!snappyJsDecompressor.uncompressInto(uncompressedData)) {
              throw Error("Decompression failed");
            }
          }
        },
      });

      bench({
        id: `${msgLen} bytes - uncompress - snappy-wasm`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            const snappyWasmDecompressor = new SnappyWasmDecompressor(compressed);
            const uncompressedDataLength = snappyWasmDecompressor.readUncompressedLength();
            const uncompressedData = Buffer.alloc(uncompressedDataLength);
            if (!snappyWasmDecompressor.uncompressInto(uncompressedData)) {
              throw Error("Decompression failed");
            }
          }
        },
      });
    }
  });
});
