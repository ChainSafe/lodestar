import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {ExecutionEngineMockBackend} from "../../../../src/execution/engine/mock.js";
import {serializeExecutionPayload} from "../../../../src/execution/engine/types.js";

describe("execution engine mock payload bodies", () => {
  function makePayload(id: number): ReturnType<typeof serializeExecutionPayload> {
    const payload = ssz.gloas.ExecutionPayload.defaultValue();
    payload.blockNumber = 2;
    payload.blockHash.fill(id);
    payload.transactions = [new Uint8Array([id])];
    payload.blockAccessList = new Uint8Array([id, id]);
    return serializeExecutionPayload(ForkName.gloas, payload);
  }

  it("serves gloas bodies by hash from payloads it has seen, null for unknown hashes", () => {
    // Asserts on the backend's sync JSON-RPC handlers; the async IExecutionEngine method is covered in http.test.ts
    const {handlers} = new ExecutionEngineMockBackend({});
    const payload = makePayload(1);
    expect(handlers.engine_newPayloadV5(payload, [], ZERO_HASH_HEX, []).status).toBe(ExecutionPayloadStatus.VALID);

    expect(handlers.engine_getPayloadBodiesByHashV2([payload.blockHash, `0x${"ab".repeat(32)}`])).toEqual([
      {transactions: payload.transactions, withdrawals: payload.withdrawals, blockAccessList: payload.blockAccessList},
      null,
    ]);
    // V1 shape has no block access list
    expect(handlers.engine_getPayloadBodiesByHashV1([payload.blockHash])).toEqual([
      {transactions: payload.transactions, withdrawals: payload.withdrawals},
    ]);
  });
});
