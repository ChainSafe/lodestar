import {randomBytes} from "node:crypto";
import xxhashFactory from "xxhash-wasm";
import {itBench} from "@dapplion/benchmark";
import {digest} from "@chainsafe/as-sha256";

const hasher = await xxhashFactory();

// Ethereum mainnet case processes 500_000 attestations / epoch (384 sec) = 1302 msg per sec

describe("network / gossip / fastMsgIdFn", () => {
  const salt = randomBytes(8);

  for (const msgLen of [200, 1000, 10000]) {
    const msgData = randomBytes(msgLen);

    itBench({
      id: `fastMsgIdFn sha256 / ${msgLen} bytes`,
      fn: () => {
        Buffer.from(digest(msgData)).subarray(0, 8).toString("hex");
      },
    });

    itBench({
      id: `fastMsgIdFn xxhash / ${msgLen} bytes`,
      fn: () => {
        hasher.h32Raw(msgData);
      },
    });

    itBench({
      id: `fastMsgIdFn xxhash+String / ${msgLen} bytes`,
      fn: () => {
        String(hasher.h32Raw(msgData));
      },
    });

    itBench({
      id: `fastMsgIdFn xxhash+concat / ${msgLen} bytes`,
      fn: () => {
        hasher.h32Raw(Buffer.concat([salt, msgData]));
      },
    });
  }
});
