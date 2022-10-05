import {randomBytes} from "node:crypto";
import xxHash from "xxhash-addon";
import xxhashjs from "xxhashjs";
import xxhashFactory from "xxhash-wasm";
import {itBench} from "@dapplion/benchmark";
import {digest} from "@chainsafe/as-sha256";

const hasher = await xxhashFactory();

// Ethereum mainnet case processes 500_000 attestations / epoch (384 sec) = 1302 msg per sec

describe("network / gossip / fastMsgIdFn", () => {
  const salt = randomBytes(8);
  const hasher2 = new xxHash.XXHash3(salt);

  const hashjs = xxhashjs.h32(0xabcd);

  for (const msgLen of [200, 500, 1000, 10000]) {
    const msgData = randomBytes(msgLen);

    itBench({
      id: `fastMsgIdFn sha256 / ${msgLen} bytes`,
      fn: () => {
        Buffer.from(digest(msgData)).subarray(0, 8).toString("hex");
      },
      runsFactor: 1e3,
    });

    itBench({
      id: `fastMsgIdFn xxhash-raw / ${msgLen} bytes`,
      fn: () => {
        hasher.h32Raw(Buffer.concat([salt, msgData]));
      },
      runsFactor: 1e3,
    });

    itBench({
      id: `fastMsgIdFn xxhash-addon / ${msgLen} bytes`,
      fn: () => {
        hasher2.update(msgData);
        // 8 bytes
        hasher2.digest();
      },
      runsFactor: 1e3,
    });

    itBench({
      id: `fastMsgIdFn xxhashjs / ${msgLen} bytes`,
      fn: () => {
        hashjs.update(msgData).digest().toNumber();
      },
      runsFactor: 1e3,
    });
  }
});
