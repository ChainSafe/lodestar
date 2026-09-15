import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {ExecutionEngineMockBackend} from "../../../../src/execution/engine/mock.js";
import {serializeExecutionPayload} from "../../../../src/execution/engine/types.js";

describe("execution engine mock payload bodies", () => {
  function makePayload(id: number) {
    const payload = ssz.gloas.ExecutionPayload.defaultValue();
    payload.blockNumber = 2;
    payload.blockHash.fill(id);
    payload.transactions = [new Uint8Array([id])];
    payload.blockAccessList = new Uint8Array([id, id]);
    return serializeExecutionPayload(ForkName.gloas, payload);
  }

  it("serves complete Gloas bodies by hash and returns null for unknown payloads", () => {
    const {handlers} = new ExecutionEngineMockBackend({});
    const payload = makePayload(1);
    expect(handlers.engine_newPayloadV5(payload, [], ZERO_HASH_HEX, []).status).toBe(ExecutionPayloadStatus.VALID);
    expect(handlers.engine_getPayloadBodiesByHashV2([payload.blockHash, ZERO_HASH_HEX])).toEqual([
      {transactions: payload.transactions, withdrawals: payload.withdrawals, blockAccessList: payload.blockAccessList},
      null,
    ]);
    expect(handlers.engine_getPayloadBodiesByHashV1([payload.blockHash])).toEqual([
      {transactions: payload.transactions, withdrawals: payload.withdrawals},
    ]);
  });

  it("follows the canonical head for range requests and truncates past the head", () => {
    const {handlers} = new ExecutionEngineMockBackend({});
    const first = makePayload(1);
    const second = makePayload(2);
    handlers.engine_newPayloadV5(first, [], ZERO_HASH_HEX, []);
    handlers.engine_newPayloadV5(second, [], ZERO_HASH_HEX, []);
    for (const payload of [first, second]) {
      handlers.engine_forkchoiceUpdatedV4(
        {headBlockHash: payload.blockHash, safeBlockHash: ZERO_HASH_HEX, finalizedBlockHash: ZERO_HASH_HEX},
        undefined
      );
      expect(handlers.engine_getPayloadBodiesByRangeV2("0x1", "0x3"), `head ${payload.blockHash}`).toEqual([
        null,
        {
          transactions: payload.transactions,
          withdrawals: payload.withdrawals,
          blockAccessList: payload.blockAccessList,
        },
      ]);
    }
    expect(handlers.engine_getPayloadBodiesByRangeV2("0x3", "0x1")).toEqual([]);
  });
});
