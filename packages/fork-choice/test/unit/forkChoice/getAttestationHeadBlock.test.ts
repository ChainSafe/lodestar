import {beforeEach, describe, expect, it, vi} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {toHex} from "@lodestar/utils";
import {
  ExecutionStatus,
  ForkChoice,
  IForkChoiceStore,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "../../../src/index.js";

/**
 * Tests for ForkChoice.getAttestationHeadBlock: resolving the payload-status variant
 * (PENDING/EMPTY/FULL) an attestation votes for from `data.index` and the attestation slot.
 */
describe("ForkChoice.getAttestationHeadBlock", () => {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const finalizedRoot = "0x1100000000000000000000000000000000000000000000000000000000000000";
  const gloasRoot = "0x2200000000000000000000000000000000000000000000000000000000000000";
  const gloasSlot = 1;
  const validatorCount = 8;

  const checkpoint = {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot};
  const fcStore: IForkChoiceStore = {
    currentSlot: gloasSlot + 1,
    justified: {checkpoint, balances: new Uint16Array([32]), totalBalance: 32},
    unrealizedJustified: {checkpoint, balances: new Uint16Array([32])},
    finalizedCheckpoint: checkpoint,
    unrealizedFinalizedCheckpoint: checkpoint,
    justifiedBalancesGetter: () => new Uint16Array([32]),
    equivocatingIndices: new Set(),
    confirmedRoot: finalizedRoot,
    previousEpochObservedJustifiedCheckpoint: checkpoint,
    currentEpochObservedJustifiedCheckpoint: checkpoint,
    previousEpochGreatestUnrealizedCheckpoint: checkpoint,
    previousEpochObservedJustifiedBalances: new Uint16Array([32]),
    currentEpochObservedJustifiedBalances: new Uint16Array([32]),
    previousEpochGreatestUnrealizedBalances: new Uint16Array([32]),
    previousSlotHead: finalizedRoot,
    currentSlotHead: finalizedRoot,
    stateGetter: () => null,
  };

  // Pre-Gloas finalized genesis block (parentBlockHash === null -> not gloas)
  function createGenesisBlock(): Omit<ProtoBlock, "targetRoot"> {
    return {
      slot: genesisSlot,
      blockRoot: finalizedRoot,
      parentRoot: toHex(Buffer.alloc(32, 0xff)),
      stateRoot: genesisRoot,
      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,
      unrealizedJustifiedEpoch: genesisEpoch,
      unrealizedJustifiedRoot: genesisRoot,
      unrealizedFinalizedEpoch: genesisEpoch,
      unrealizedFinalizedRoot: genesisRoot,
      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      timeliness: false,
      parentBlockHash: null,
      payloadStatus: PayloadStatus.FULL,
    };
  }

  // Gloas block (parentBlockHash !== null -> gloas). onBlock creates PENDING + EMPTY variants.
  function createGloasBlock(): ProtoBlock {
    return {
      slot: gloasSlot,
      blockRoot: gloasRoot,
      parentRoot: finalizedRoot,
      stateRoot: genesisRoot,
      targetRoot: finalizedRoot,
      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,
      unrealizedJustifiedEpoch: genesisEpoch,
      unrealizedJustifiedRoot: genesisRoot,
      unrealizedFinalizedEpoch: genesisEpoch,
      unrealizedFinalizedRoot: genesisRoot,
      executionPayloadBlockHash: gloasRoot,
      executionPayloadNumber: gloasSlot,
      executionPayloadGasLimit: 30000000,
      executionStatus: ExecutionStatus.Valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
      timeliness: true,
      parentBlockHash: finalizedRoot, // non-null -> gloas; parent is pre-gloas so fork-transition path
      payloadStatus: PayloadStatus.FULL,
    };
  }

  let protoArr: ProtoArray;
  let forkChoice: ForkChoice;

  beforeEach(() => {
    protoArr = ProtoArray.initialize(createGenesisBlock(), genesisSlot);
    protoArr.onBlock(createGloasBlock(), gloasSlot, null);
    forkChoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null);
  });

  const importFullPayload = (): void =>
    protoArr.onExecutionPayload(
      gloasRoot,
      gloasSlot,
      gloasRoot,
      gloasSlot,
      30000000,
      null,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );

  it("unknown root -> null", () => {
    expect(forkChoice.getAttestationHeadBlock("0xdead", gloasSlot, 0)).toBeNull();
  });

  it("pre-gloas block -> FULL variant regardless of index", () => {
    for (const index of [0, 1]) {
      const block = forkChoice.getAttestationHeadBlock(finalizedRoot, genesisSlot, index);
      expect(block?.payloadStatus).toBe(PayloadStatus.FULL);
    }
  });

  it("gloas same-slot attestation -> PENDING, reusing the default block (single lookup)", () => {
    // getBlockHex is called once internally via getBlockHexDefaultStatus; the derived PENDING
    // equals the default variant so no second getBlockHex call is made.
    const getBlockHexSpy = vi.spyOn(forkChoice, "getBlockHex");
    const block = forkChoice.getAttestationHeadBlock(gloasRoot, gloasSlot, 0);
    expect(block?.blockRoot).toBe(gloasRoot);
    expect(block?.payloadStatus).toBe(PayloadStatus.PENDING);
    expect(getBlockHexSpy).toHaveBeenCalledTimes(1);
  });

  it("gloas past-slot index=0 -> EMPTY (second lookup for non-default variant)", () => {
    const getBlockHexSpy = vi.spyOn(forkChoice, "getBlockHex");
    const block = forkChoice.getAttestationHeadBlock(gloasRoot, gloasSlot + 1, 0);
    expect(block?.blockRoot).toBe(gloasRoot);
    expect(block?.payloadStatus).toBe(PayloadStatus.EMPTY);
    // one call for the default-status lookup + one for the explicit EMPTY variant
    expect(getBlockHexSpy).toHaveBeenCalledTimes(2);
  });

  it("gloas past-slot index=1 -> null when FULL not imported, FULL after onExecutionPayload", () => {
    expect(forkChoice.getAttestationHeadBlock(gloasRoot, gloasSlot + 1, 1)).toBeNull();
    importFullPayload();
    const block = forkChoice.getAttestationHeadBlock(gloasRoot, gloasSlot + 1, 1);
    expect(block?.payloadStatus).toBe(PayloadStatus.FULL);
  });

  it("gloas past-slot index>=2 -> throws", () => {
    expect(() => forkChoice.getAttestationHeadBlock(gloasRoot, gloasSlot + 1, 2)).toThrow();
  });

  it("gloas attestation slot < block slot -> throws (attests to future block)", () => {
    expect(() => forkChoice.getAttestationHeadBlock(gloasRoot, gloasSlot - 1, 0)).toThrow();
  });

  it("gloas same-slot attestation with index != 0 -> throws (payload not yet revealed)", () => {
    expect(() => forkChoice.getAttestationHeadBlock(gloasRoot, gloasSlot, 1)).toThrow();
  });
});
