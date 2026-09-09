import {describe, expect, it, vi} from "vitest";
import {GENESIS_SLOT} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {ForkChoiceError, ForkChoiceErrorCode} from "../../../src/forkChoice/errors.js";
import {IForkChoice} from "../../../src/forkChoice/interface.js";
import {getFinalizedExecutionBlockHash, getSafeExecutionBlockHash} from "../../../src/forkChoice/safeBlocks.js";
import {ExecutionStatus, HEX_ZERO_HASH, PayloadStatus, ProtoBlock} from "../../../src/protoArray/interface.js";

function buildBlock(opts: {
  blockRoot: RootHex;
  executionPayloadBlockHash: RootHex | null;
  parentBlockHash: RootHex | null;
  slot?: Slot;
}): ProtoBlock {
  const common = {
    slot: opts.slot ?? 1,
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
    importedTimely: true,
    ptcTimeliness: false,
    proposerIndex: 0,
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

  it("logs when the confirmed block is the finalized block", () => {
    const debug = vi.fn();
    const confirmed = buildBlock({
      blockRoot: "0xaa",
      executionPayloadBlockHash: "0xpayloadA",
      parentBlockHash: null,
    });
    const fc = mockForkChoice(confirmed, confirmed);

    expect(getSafeExecutionBlockHash(fc, {debug})).toBe("0xpayloadA");
    expect(debug).toHaveBeenCalledWith("Confirmed block is the finalized block", {
      blockRoot: confirmed.blockRoot,
      slot: confirmed.slot,
    });
  });

  it("pre-Bellatrix: returns ZERO_HASH_HEX when executionPayloadBlockHash is null", () => {
    const confirmed = buildBlock({
      blockRoot: "0xaa",
      executionPayloadBlockHash: null,
      parentBlockHash: null,
    });
    const fc = mockForkChoice(confirmed, confirmed);
    expect(getSafeExecutionBlockHash(fc)).toBe(HEX_ZERO_HASH);
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

  it("throws when the confirmed block is not found", () => {
    const finalized = buildBlock({
      blockRoot: "0xbb",
      executionPayloadBlockHash: "0xpayloadF",
      parentBlockHash: null,
    });
    const fc = mockForkChoice(null, finalized);

    expect(() => getSafeExecutionBlockHash(fc)).toThrowError(
      new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: "0xconfirmed"})
    );
  });

  it("throws when a post-Merge block is missing its execution payload block hash", () => {
    const confirmed = {
      ...buildBlock({
        blockRoot: "0xaa",
        executionPayloadBlockHash: null,
        parentBlockHash: null,
      }),
      executionStatus: ExecutionStatus.Valid,
    } as unknown as ProtoBlock;
    const fc = mockForkChoice(confirmed, confirmed);

    expect(() => getSafeExecutionBlockHash(fc)).toThrowError(
      new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_EXECUTION_PAYLOAD_BLOCK_HASH,
        root: confirmed.blockRoot,
        slot: confirmed.slot,
      })
    );
  });

  it("pre-Gloas genesis anchor: returns ZERO_HASH_HEX, not the state's payload header hash", () => {
    const confirmed = buildBlock({
      blockRoot: "0xaa",
      executionPayloadBlockHash: "0xfromStateHeader",
      parentBlockHash: null,
      slot: GENESIS_SLOT,
    });
    const fc = mockForkChoice(confirmed, confirmed);
    expect(getSafeExecutionBlockHash(fc)).toBe(HEX_ZERO_HASH);
  });

  it("Gloas genesis anchor: returns the bid.parent_block_hash", () => {
    const confirmed = buildBlock({
      blockRoot: "0xaa",
      executionPayloadBlockHash: "0xpayloadA",
      parentBlockHash: "0xparentEL",
      slot: GENESIS_SLOT,
    });
    const fc = mockForkChoice(confirmed, confirmed);
    expect(getSafeExecutionBlockHash(fc)).toBe("0xparentEL");
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
    const finalized = buildBlock({
      blockRoot: "0xbb",
      executionPayloadBlockHash: null,
      parentBlockHash: null,
    });
    const fc = mockForkChoice(finalized, finalized);
    expect(getFinalizedExecutionBlockHash(fc)).toBe(HEX_ZERO_HASH);
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

  it("pre-Gloas genesis anchor: returns ZERO_HASH_HEX, not the state's payload header hash", () => {
    const finalized = buildBlock({
      blockRoot: "0xbb",
      executionPayloadBlockHash: "0xfromStateHeader",
      parentBlockHash: null,
      slot: GENESIS_SLOT,
    });
    const fc = mockForkChoice(finalized, finalized);
    expect(getFinalizedExecutionBlockHash(fc)).toBe(HEX_ZERO_HASH);
  });
});
