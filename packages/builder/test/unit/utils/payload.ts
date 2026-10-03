import {Slot, ssz} from "@lodestar/types";
import {BuiltPayload} from "../../../src/services/payloadStore.js";

export const GWEI_TO_WEI = 1_000_000_000n;

export function mockBuiltPayload({
  sourceId = "el",
  slot = 1,
  parentHash = Buffer.alloc(32, 1),
  blockHash = Buffer.alloc(32, 2),
  prevRandao = Buffer.alloc(32, 3),
  valueGwei = 1_000_000_000,
  gasLimit = 30_000_000,
}: {
  sourceId?: string;
  slot?: Slot;
  parentHash?: Uint8Array;
  blockHash?: Uint8Array;
  prevRandao?: Uint8Array;
  valueGwei?: number;
  gasLimit?: number;
} = {}): BuiltPayload {
  const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
  executionPayload.parentHash = parentHash;
  executionPayload.blockHash = blockHash;
  executionPayload.prevRandao = prevRandao;
  executionPayload.gasLimit = gasLimit;
  executionPayload.slotNumber = slot;
  return {
    sourceId,
    executionPayload,
    executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
    blobsBundle: ssz.fulu.BlobsBundle.defaultValue(),
    executionPayloadValue: BigInt(valueGwei) * GWEI_TO_WEI,
  };
}
