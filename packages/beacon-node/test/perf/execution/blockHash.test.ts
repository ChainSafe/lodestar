import crypto from "node:crypto";
import {bench, describe} from "@chainsafe/benchmark";
import {SerializedList} from "@chainsafe/ssz";
import {ForkName, MAX_WITHDRAWALS_PER_PAYLOAD} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {computeExecutionBlockHash, computeOrderedTrieRoot} from "../../../src/execution/engine/blockHash.js";

describe("execution / engine / computeExecutionBlockHash", () => {
  const cases = [
    {id: "typical", txCount: 300, txSize: 400, balSize: 64 * 1024},
    {id: "heavy", txCount: 1500, txSize: 300, balSize: 512 * 1024},
    {id: "near gossip max", txCount: 2000, txSize: 2000, balSize: 4 * 1024 * 1024},
  ];

  for (const {id, txCount, txSize, balSize} of cases) {
    const transactions = Array.from({length: txCount}, () => {
      const tx = new Uint8Array(crypto.randomBytes(txSize));
      tx[0] = 2;
      return tx;
    });
    const payload = ssz.gloas.ExecutionPayload.defaultValue();
    payload.transactions = SerializedList.fromArray(transactions);
    payload.withdrawals = Array.from({length: MAX_WITHDRAWALS_PER_PAYLOAD}, (_, i) => ({
      index: i,
      validatorIndex: i,
      address: new Uint8Array(20).fill(i),
      amount: BigInt(32e9),
    }));
    payload.blockAccessList = new Uint8Array(crypto.randomBytes(balSize));
    const parentBeaconBlockRoot = new Uint8Array(32);
    const executionRequests: gloas.ExecutionRequests = ssz.gloas.ExecutionRequests.defaultValue();
    const name = `${id} ${txCount} txs x ${txSize} B, BAL ${balSize / 1024} KiB`;

    bench(`block hash ${name}`, () => {
      computeExecutionBlockHash(ForkName.gloas, payload, parentBeaconBlockRoot, executionRequests);
    });

    bench(`transactions trie ${name}`, () => {
      computeOrderedTrieRoot(transactions);
    });
  }
});
