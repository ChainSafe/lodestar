import {describe, expect, it, vi} from "vitest";
import {ZERO_HASH_HEX} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {
  ExecutionStatus,
  IForkChoice,
  PayloadStatus,
  ProtoBlock,
  getSafeExecutionBlockHashForHead,
} from "../../../src/index.js";

const rootA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const rootB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const hashA = "0x1111111111111111111111111111111111111111111111111111111111111111";
const hashB = "0x2222222222222222222222222222222222222222222222222222222222222222";

function block(blockRoot: string, executionPayloadBlockHash: string, payloadStatus = PayloadStatus.FULL): ProtoBlock {
  return {
    slot: 1,
    blockRoot,
    parentRoot: ZERO_HASH_HEX,
    stateRoot: ZERO_HASH_HEX,
    targetRoot: ZERO_HASH_HEX,
    justifiedEpoch: 0,
    justifiedRoot: ZERO_HASH_HEX,
    finalizedEpoch: 0,
    finalizedRoot: ZERO_HASH_HEX,
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: ZERO_HASH_HEX,
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: ZERO_HASH_HEX,
    timeliness: true,
    payloadStatus,
    parentBlockHash: ZERO_HASH_HEX,
    executionPayloadBlockHash,
    executionPayloadNumber: 1,
    executionPayloadGasLimit: 30_000_000,
    executionStatus: ExecutionStatus.Valid,
    dataAvailabilityStatus: DataAvailabilityStatus.Available,
  } as ProtoBlock;
}

function forkChoice(confirmedBlock: ProtoBlock | null, isDescendant: boolean): IForkChoice {
  return {
    getConfirmedRoot: vi.fn().mockReturnValue(confirmedBlock?.blockRoot ?? ZERO_HASH_HEX),
    getBlockHexDefaultStatus: vi.fn().mockReturnValue(confirmedBlock),
    isDescendant: vi.fn().mockReturnValue(isDescendant),
  } as unknown as IForkChoice;
}

describe("getSafeExecutionBlockHashForHead", () => {
  it("returns confirmed execution hash when confirmed block is compatible with the FCU head", () => {
    const confirmedBlock = block(rootA, hashA);
    const headBlock = block(rootB, hashB);
    const fc = forkChoice(confirmedBlock, true);

    expect(getSafeExecutionBlockHashForHead(fc, headBlock)).toBe(hashA);
    expect(fc.isDescendant).toHaveBeenCalledWith(rootA, PayloadStatus.FULL, rootB, PayloadStatus.FULL);
  });

  it("returns zero hash when confirmed block is not an ancestor of the FCU head", () => {
    const confirmedBlock = block(rootB, hashB);
    const reorgHead = block(rootA, hashA);
    const fc = forkChoice(confirmedBlock, false);

    expect(getSafeExecutionBlockHashForHead(fc, reorgHead)).toBe(ZERO_HASH_HEX);
    expect(fc.isDescendant).toHaveBeenCalledWith(rootB, PayloadStatus.FULL, rootA, PayloadStatus.FULL);
  });

  it("returns zero hash when confirmed block has no execution payload hash", () => {
    const confirmedBlock = block(rootA, hashA);
    confirmedBlock.executionPayloadBlockHash = null;
    const fc = forkChoice(confirmedBlock, true);

    expect(getSafeExecutionBlockHashForHead(fc, block(rootB, hashB))).toBe(ZERO_HASH_HEX);
    expect(fc.isDescendant).not.toHaveBeenCalled();
  });
});
