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

    // byteArrayEquals benchmarks - comparing browser (loop) vs nodejs (Buffer.compare)
    const arraysToCompare = [
      {name: "32 bytes (block root)", a: blockRoot, b: new Uint8Array(blockRoot)},
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
