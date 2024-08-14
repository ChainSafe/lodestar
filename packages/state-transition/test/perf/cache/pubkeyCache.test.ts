import {itBench, setBenchOpts} from "@dapplion/benchmark";

/**
 * Using base64 is a little faster than hex, and it's more memory efficient
 * This is on Mac M1 Aug 2024
 * PubkeyCache
 *    ✔ Public key to string using hex, shared Buffer instance               8466684 ops/s    118.1100 ns/op        -     168390 runs   20.0 s
 *    ✔ Public key to string using hex, separate Buffer instance             5850109 ops/s    170.9370 ns/op        -     116277 runs   20.1 s
 *    ✔ Public key to string using base64, shared Buffer instance        1.031183e+7 ops/s    96.97600 ns/op        -     204949 runs   20.0 s
 *    ✔ Public key to string using base64, separate Buffer instance          6180011 ops/s    161.8120 ns/op        -     122556 runs   20.0 s
 */
describe("PubkeyCache", () => {
  setBenchOpts({
    minMs: 20_000,
  });

  const pubkeyBuf = Buffer.alloc(48);
  const runsFactor = 1000;
  const pubkey = Uint8Array.from(Array.from({length: 48}, (_, i) => i));

  for (const encoding of ["hex" as const, "base64" as const]) {
    itBench({
      id: `Public key to string using ${encoding}, shared Buffer instance`,
      fn: () => {
        for (let i = 0; i < runsFactor; i++) {
          pubkeyBuf.set(pubkey);
          pubkeyBuf.toString(encoding);
        }
      },
      runsFactor,
    });

    itBench({
      id: `Public key to string using ${encoding}, separate Buffer instance`,
      fn: () => {
        for (let i = 0; i < runsFactor; i++) {
          Buffer.from(pubkey.buffer, pubkey.byteOffset, pubkey.byteLength).toString(encoding);
        }
      },
      runsFactor,
    });
  }
});
