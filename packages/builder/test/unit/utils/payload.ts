import {vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {Slot, ssz} from "@lodestar/types";
import {BuildHandle, BuildRequest, BuiltPayload, PayloadSource} from "../../../src/services/payloadSource.js";

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

export class FakePayloadSource implements PayloadSource {
  prepare = vi.fn<(req: BuildRequest) => Promise<BuildHandle>>();
  getPayload = vi.fn<(fork: ForkName, handle: BuildHandle) => Promise<BuiltPayload>>();

  constructor(readonly id: string) {
    this.prepare.mockImplementation(async () => ({sourceId: this.id, payloadId: `0x${this.id}`}));
  }
}
