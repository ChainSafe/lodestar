import {bench, describe} from "@chainsafe/benchmark";
import * as browser from "../../src/bytes/browser.ts";
import * as nodejs from "../../src/bytes/nodejs.ts";

describe("bytes utils", async () => {
  const runsFactor = 1000;
  const blockRoot = new Uint8Array(Array.from({length: 32}, (_, i) => i));
  // FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT = 4096 * 32 = 131072
  const BLOB_LEN = 131072;
  const blob = new Uint8Array(BLOB_LEN);
  for (let i = 0; i < blob.length; i++) {
    blob[i] = i % 256;
  }
  const blobHex = nodejs.toHex(blob);

  const implementations = [
    {
      name: "nodejs",
      impl: nodejs,
    },
    {
      name: "browser",
      impl: browser,
    },
  ].filter(Boolean) as {
    name: string;
    impl: typeof nodejs;
  }[];

  for (const {name, impl} of implementations) {
    bench({
      id: `${name} block root to RootHex using toHex`,
      fn: () => {
        for (let i = 0; i < runsFactor; i++) {
          impl.toHex(blockRoot);
        }
      },
      runsFactor,
    });

    bench({
      id: `${name} block root to RootHex using toRootHex`,
      fn: () => {
        for (let i = 0; i < runsFactor; i++) {
          impl.toRootHex(blockRoot);
        }
      },
      runsFactor,
    });

    bench({
      id: `${name} fromHex(blob)`,
      fn: () => {
        for (let i = 0; i < runsFactor; i++) {
          impl.fromHex(blobHex);
        }
      },
      runsFactor,
    });

    const buffer = new Uint8Array(BLOB_LEN);
    bench({
      id: `${name} fromHexInto(blob)`,
      fn: () => {
        for (let i = 0; i < runsFactor; i++) {
          impl.fromHexInto(blobHex, buffer);
        }
      },
      runsFactor,
    });

    bench({
      id: `${name} block root to RootHex using the deprecated toHexString`,
      fn: () => {
        for (let i = 0; i < runsFactor; i++) {
          impl.toHexString(blockRoot);
        }
      },
      runsFactor,
    });

    /**
     * Node v24.13.0 benchmark results for byteArrayEquals:
     *
     * Size         | nodejs (hybrid)              | browser (loop)
     * -------------|------------------------------|----------------
     * 32 bytes     | 14.7 ns/op (loop)            | 14.7 ns/op
     * 48 bytes     | 36 ns/op (loop)              | 36 ns/op
     * 96 bytes     | 50 ns/op (Buffer.compare)    | 130 ns/op
     * 1024 bytes   | 55 ns/op (Buffer.compare)    | 940 ns/op
     * 131072 bytes | 270 ns/op (Buffer.compare)   | 14.8 μs/op
     *
     * The nodejs implementation uses a hybrid approach:
     * - Loop for <=48 bytes (V8 JIT optimized)
     * - Buffer.compare for >48 bytes (native code)
     */
    const arraysToCompare = [
      {name: "32 bytes (block root)", a: blockRoot, b: new Uint8Array(blockRoot)},
      {name: "48 bytes (pubkey)", a: new Uint8Array(48).fill(42), b: new Uint8Array(48).fill(42)},
      {name: "96 bytes (signature)", a: new Uint8Array(96).fill(42), b: new Uint8Array(96).fill(42)},
      {name: "1024 bytes", a: new Uint8Array(1024).fill(42), b: new Uint8Array(1024).fill(42)},
      {name: `${BLOB_LEN} bytes (blob)`, a: blob, b: new Uint8Array(blob)},
    ];

    for (const {name: arrName, a, b} of arraysToCompare) {
      bench({
        id: `${name} byteArrayEquals ${arrName}`,
        fn: () => {
          for (let i = 0; i < runsFactor; i++) {
            impl.byteArrayEquals(a, b);
          }
        },
        runsFactor,
      });
    }
  }
});
