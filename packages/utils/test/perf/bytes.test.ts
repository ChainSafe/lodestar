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
    Boolean(globalThis.Bun) && {
      name: "bun",
      impl: await import("../../src/bytes/bun.ts"),
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
  }
});
