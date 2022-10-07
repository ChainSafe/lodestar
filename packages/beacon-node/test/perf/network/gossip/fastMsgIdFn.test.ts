import {randomBytes} from "node:crypto";
import xxhashFactory from "xxhash-wasm";
import {itBench} from "@dapplion/benchmark";
import {digest} from "@chainsafe/as-sha256";

const hasher = await xxhashFactory();

// Ethereum mainnet case processes 500_000 attestations / epoch (384 sec) = 1302 msg per sec

describe("network / gossip / fastMsgIdFn", () => {
  const h32Seed = Math.floor(Math.random() * 1e9);
  const h64Seed = BigInt(Math.floor(Math.random() * 1e9));
  for (const msgLen of [200, 1000, 10000]) {
    const msgData = randomBytes(msgLen);

    itBench({
      id: `fastMsgIdFn sha256 / ${msgLen} bytes`,
      fn: () => {
        Buffer.from(digest(msgData)).subarray(0, 8).toString("hex");
      },
    });

    itBench({
      id: `fastMsgIdFn h32 xxhash / ${msgLen} bytes`,
      fn: () => {
        hasher.h32Raw(msgData, h32Seed);
      },
    });

    itBench({
      id: `fastMsgIdFn h64 xxhash / ${msgLen} bytes`,
      fn: () => {
        hasher.h64Raw(msgData, h64Seed).toString(16);
      },
    });
  }
});
