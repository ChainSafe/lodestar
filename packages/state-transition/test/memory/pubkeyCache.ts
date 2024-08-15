import crypto from "node:crypto";
import {PubkeyIndexMap} from "../../src/cache/pubkeyCache.js";
import {testRunnerMemoryBpi} from "./testRunnerMemory.js";

const vcArr = [500_000, 2_000_000];

// Results in Mac M1 Aug 2024 using `node --expose-gc --loader=ts-node/esm pubkeyCache.ts`
// PubkeyIndexMap PubkeyIndexMap 500000  - 54672689.8 bytes / instance
// PubkeyIndexMap PubkeyIndexMap 2000000 - 218719267.4 bytes / instance
testRunnerMemoryBpi(
  vcArr.map((vc) => ({
    id: `PubkeyIndexMap PubkeyIndexMap ${vc}`,
    getInstance: () => {
      const pubkeyCache = new PubkeyIndexMap();
      for (let i = 0; i < vc; i++) {
        pubkeyCache.set(crypto.randomBytes(48), i);
      }
      return pubkeyCache;
    },
  }))
);
