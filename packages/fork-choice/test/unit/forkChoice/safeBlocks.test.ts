import {describe, expect, it, vi} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {IForkChoice} from "../../../src/forkChoice/interface.js";
import {getFinalizedExecutionBlockHash, getSafeExecutionBlockHash} from "../../../src/forkChoice/safeBlocks.js";
import {ExecutionStatus, HEX_ZERO_HASH, PayloadStatus, ProtoBlock} from "../../../src/protoArray/interface.js";

function buildBlock(opts: {
  blockRoot: RootHex;
  executionPayloadBlockHash: RootHex | null;
  parentBlockHash: RootHex | null;
}): ProtoBlock {
  const common = {
    slot: 0,
    blockRoot: opts.blockRoot,
    parentRoot: "0x00",
    stateRoot: "0x00",
    targetRoot: "0x00",
    justifiedEpoch: 0,
    justifiedRoot: "0x00",
    finalizedEpoch: 0,
    finalizedRoot: "0x00",
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: "0x00",
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: "0x00",
    timeliness: true,
    payloadStatus: PayloadStatus.FULL,
    parentBlockHash: opts.parentBlockHash,
  };
  if (opts.executionPayloadBlockHash === null) {
    return {
      ...common,
      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    };
  }
  return {
    ...common,
    executionPayloadBlockHash: opts.executionPayloadBlockHash,
    executionPayloadNumber: 0,
    executionPayloadGasLimit: 30_000_000,
    executionStatus: ExecutionStatus.Valid,
    dataAvailabilityStatus: DataAvailabilityStatus.Available,
  };
}

function mockForkChoice(confirmed: ProtoBlock | null, finalized: ProtoBlock): IForkChoice {
  return {
    getConfirmedBlock: () => confirmed,
    getConfirmedRoot: () => confirmed?.blockRoot ?? "0xconfirmed",
    getFinalizedBlock: () => finalized,
  } as unknown as IForkChoice;
}

describe("safeBlocks - getSafeExecutionBlockHash", () => {
  it("pre-Gloas: returns the confirmed block's own executionPayloadBlockHash", () => {
    const confirmed = buildBlock({
      blockRoot: "0xaa",
      executionPayloadBlockHash: "0xpayloadA",
      parentBlockHash: null,
    });
    const fc = mockForkChoice(confirmed, confirmed);
    expect(getSafeExecutionBlockHash(fc)).toBe("0xpayloadA");
  });

  it("pre-Bellatrix: returns ZERO_HASH_HEX when executionPayloadBlockHash is null", () => {
    const warn = vi.fn();
    const confirmed = buildBlock({
      blockRoot: "0xaa",
      executionPayloadBlockHash: null,
      parentBlockHash: null,
    });
    const fc = mockForkChoice(confirmed, confirmed);
    expect(getSafeExecutionBlockHash(fc, {warn})).toBe(HEX_ZERO_HASH);
    expect(warn).toHaveBeenCalledWith("Execution payload block hash not found; using zero hash", {
      blockRoot: confirmed.blockRoot,
      slot: confirmed.slot,
    });
  });

  it("post-Gloas: returns the confirmed block's bid.parent_block_hash, not its own payload hash", () => {
    const confirmed = buildBlock({
      blockRoot: "0xaa",
      executionPayloadBlockHash: "0xpayloadA",
      parentBlockHash: "0xparentEL",
    });
    const fc = mockForkChoice(confirmed, confirmed);
    expect(getSafeExecutionBlockHash(fc)).toBe("0xparentEL");
  });

  it("returns ZERO_HASH_HEX and logs when the confirmed block is not found", () => {
    const warn = vi.fn();
    const finalized = buildBlock({
      blockRoot: "0xbb",
      executionPayloadBlockHash: "0xpayloadF",
      parentBlockHash: null,
    });
    const fc = mockForkChoice(null, finalized);

    expect(getSafeExecutionBlockHash(fc, {warn})).toBe(HEX_ZERO_HASH);
    expect(warn).toHaveBeenCalledWith("Confirmed block not found; using zero safe execution block hash", {
      confirmedRoot: "0xconfirmed",
    });
  });
});

describe("safeBlocks - getFinalizedExecutionBlockHash", () => {
  it("pre-Gloas: returns the finalized block's own executionPayloadBlockHash", () => {
    const finalized = buildBlock({
      blockRoot: "0xbb",
      executionPayloadBlockHash: "0xpayloadF",
      parentBlockHash: null,
    });
    const fc = mockForkChoice(finalized, finalized);
    expect(getFinalizedExecutionBlockHash(fc)).toBe("0xpayloadF");
  });

  it("pre-Bellatrix: returns ZERO_HASH_HEX when executionPayloadBlockHash is null", () => {
    const warn = vi.fn();
    const finalized = buildBlock({
      blockRoot: "0xbb",
      executionPayloadBlockHash: null,
      parentBlockHash: null,
    });
    const fc = mockForkChoice(finalized, finalized);
    expect(getFinalizedExecutionBlockHash(fc, {warn})).toBe(HEX_ZERO_HASH);
    expect(warn).toHaveBeenCalledWith("Execution payload block hash not found; using zero hash", {
      blockRoot: finalized.blockRoot,
      slot: finalized.slot,
    });
  });

  it("post-Gloas: returns the finalized block's bid.parent_block_hash, not its own payload hash", () => {
    const finalized = buildBlock({
      blockRoot: "0xbb",
      executionPayloadBlockHash: "0xpayloadF",
      parentBlockHash: "0xparentEL",
    });
    const fc = mockForkChoice(finalized, finalized);
    expect(getFinalizedExecutionBlockHash(fc)).toBe("0xparentEL");
  });
});
