import {describe, expect, it} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {createChainConfig} from "@lodestar/config";
import {ForkName, ForkPostBellatrix, ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {computeExecutionBlockHash} from "../../../../src/execution/engine/blockHash.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {ExecutionEngineMockBackend} from "../../../../src/execution/engine/mock.js";
import {
  parseExecutionPayload,
  serializeExecutionPayload,
  serializePayloadAttributes,
} from "../../../../src/execution/engine/types.js";

describe("execution engine mock payload bodies", () => {
  function makePayload(id: number): ReturnType<typeof serializeExecutionPayload> {
    const payload = ssz.gloas.ExecutionPayload.defaultValue();
    payload.blockNumber = 2;
    payload.blockHash.fill(id);
    payload.transactions = SerializedList.fromArray([new Uint8Array([id])]);
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
  });
});

describe("execution engine mock payload block hash", () => {
  const forks: ForkPostBellatrix[] = [
    ForkName.bellatrix,
    ForkName.capella,
    ForkName.deneb,
    ForkName.electra,
    ForkName.fulu,
    ForkName.gloas,
  ];

  for (const fork of forks) {
    it(`built ${fork} payload hashes to its blockHash`, () => {
      const forkEpoch = (f: ForkName): number => (ForkSeq[f] <= ForkSeq[fork] ? 0 : Infinity);
      const genesisTime = 1000;
      const {handlers} = new ExecutionEngineMockBackend({
        genesisTime,
        config: createChainConfig({
          CAPELLA_FORK_EPOCH: forkEpoch(ForkName.capella),
          DENEB_FORK_EPOCH: forkEpoch(ForkName.deneb),
          ELECTRA_FORK_EPOCH: forkEpoch(ForkName.electra),
          FULU_FORK_EPOCH: forkEpoch(ForkName.fulu),
          GLOAS_FORK_EPOCH: forkEpoch(ForkName.gloas),
        }),
      });

      const parentBeaconBlockRoot = ForkSeq[fork] >= ForkSeq.deneb ? new Uint8Array(32).fill(7) : undefined;
      const {payloadId} = handlers.engine_forkchoiceUpdatedV3(
        {headBlockHash: ZERO_HASH_HEX, safeBlockHash: ZERO_HASH_HEX, finalizedBlockHash: ZERO_HASH_HEX},
        serializePayloadAttributes({
          timestamp: genesisTime,
          prevRandao: new Uint8Array(32).fill(1),
          suggestedFeeRecipient: `0x${"aa".repeat(20)}`,
          withdrawals: ForkSeq[fork] >= ForkSeq.capella ? [] : undefined,
          parentBeaconBlockRoot,
          slotNumber: ForkSeq[fork] >= ForkSeq.gloas ? 5 : undefined,
        })
      );
      if (payloadId === null) throw Error("No payloadId");

      const {executionPayload, executionRequests} = parseExecutionPayload(
        fork,
        handlers.engine_getPayloadV5(payloadId)
      );
      const expected = computeExecutionBlockHash(
        fork,
        executionPayload,
        parentBeaconBlockRoot ?? null,
        ForkSeq[fork] >= ForkSeq.electra ? (executionRequests ?? null) : null
      );
      expect(toHex(executionPayload.blockHash)).toBe(toHex(expected));
    });
  }
});
