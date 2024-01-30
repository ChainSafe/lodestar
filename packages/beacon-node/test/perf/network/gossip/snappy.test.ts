import {randomBytes} from "node:crypto";
import * as snappyjs from "snappyjs";
import * as snappy from "snappy";
import {itBench} from "@dapplion/benchmark";

describe("network / gossip / snappy", () => {
  for (const msgLen of [100, 200, 300, 400, 500, 1000, 10000, 100000]) {
    const uncompressed = randomBytes(msgLen);
    const compressed = snappyjs.compress(uncompressed);

    itBench({
      id: `snappyjs compress ${msgLen} bytes`,
      fn: () => void snappyjs.compress(uncompressed),
    });

    itBench({
      id: `snappyjs uncompress ${msgLen} bytes`,
      fn: () => void snappyjs.uncompress(compressed),
    });

    itBench({
      id: `snappy compress ${msgLen} bytes`,
      fn: () => void snappy.compressSync(uncompressed),
    });

    itBench({
      id: `snappy uncompress ${msgLen} bytes`,
      fn: () => void snappy.uncompressSync(compressed),
    });
  }
});
