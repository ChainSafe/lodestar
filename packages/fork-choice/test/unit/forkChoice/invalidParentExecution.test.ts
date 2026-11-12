import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {RootHex, Slot, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {
  ExecutionStatus,
  ForkChoice,
  ForkChoiceError,
  ForkChoiceErrorCode,
  InvalidBlockCode,
  PayloadStatus,
  ProtoArray,
} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {
  VALIDATOR_COUNT,
  genesisSlot,
  gloasConfig,
  headSlot,
  makeStore,
  parentSlot,
  toProtoBlock,
} from "./proposerHeadTestUtils.js";

const childSlot = headSlot + 1;

function payloadHash(slot: Slot): RootHex {
  return toHex(Buffer.alloc(32, slot));
}

function checkpoint(): {epoch: number; root: Uint8Array} {
  return {epoch: 0, root: fromHexString(getBlockRoot(genesisSlot))};
}

const state = {
  currentJustifiedCheckpoint: checkpoint(),
  finalizedCheckpoint: checkpoint(),
  computeUnrealizedCheckpoints: () => ({justifiedCheckpoint: checkpoint(), finalizedCheckpoint: checkpoint()}),
  getBlockRootAtSlot: (slot: Slot) => fromHexString(getBlockRoot(slot)),
  isExecutionStateType: false,
} as unknown as IBeaconStateView;

function setup(isGloas: boolean): {forkChoice: ForkChoice; protoArray: ProtoArray} {
  const genesisRoot = getBlockRoot(genesisSlot);
  const protoArray = ProtoArray.initialize(
    toProtoBlock(genesisSlot, genesisRoot, false, {executionPayloadBlockHash: payloadHash(genesisSlot)}),
    genesisSlot
  );
  for (const [slot, parentRoot] of [
    [parentSlot, genesisRoot],
    [headSlot, getBlockRoot(parentSlot)],
  ] as const) {
    protoArray.onBlock(
      toProtoBlock(slot, parentRoot, isGloas, {
        executionStatus: ExecutionStatus.Syncing,
        executionPayloadBlockHash: payloadHash(isGloas ? slot - 1 : slot),
        ...(isGloas ? {parentBlockHash: payloadHash(slot - 1)} : {}),
      }),
      slot,
      null
    );
    if (isGloas && slot === parentSlot) {
      protoArray.onExecutionPayload(
        getBlockRoot(slot),
        slot,
        payloadHash(slot),
        slot,
        30_000_000,
        null,
        ExecutionStatus.Syncing,
        DataAvailabilityStatus.Available
      );
    }
  }
  const forkChoice = new ForkChoice(
    gloasConfig,
    {...makeStore(), currentSlot: childSlot},
    protoArray,
    VALIDATOR_COUNT,
    null
  );
  return {forkChoice, protoArray};
}

function invalidateHead(forkChoice: ForkChoice, isGloas: boolean): void {
  const applied = forkChoice.validateLatestHash(
    {
      executionStatus: ExecutionStatus.Invalid,
      latestValidExecHash: null,
      invalidateFromParentBlockRoot: getBlockRoot(headSlot),
      invalidateFromParentBlockHash: payloadHash(isGloas ? headSlot - 1 : headSlot),
    },
    {strict: false}
  );
  expect(applied).toBe(true);
}

function expectParentExecutionInvalid(fn: () => void): void {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ForkChoiceError);
  const {type} = error as ForkChoiceError;
  expect(type.code).toBe(ForkChoiceErrorCode.INVALID_BLOCK);
  expect(type.code === ForkChoiceErrorCode.INVALID_BLOCK && type.err.code).toBe(
    InvalidBlockCode.PARENT_EXECUTION_INVALID
  );
}

describe("ForkChoice / invalidated parent payload chain", () => {
  it.each([ExecutionStatus.Syncing, ExecutionStatus.Valid] as const)(
    "onBlock rejects a %s block building on an invalidated parent",
    (executionStatus) => {
      const {forkChoice} = setup(false);
      invalidateHead(forkChoice, false);

      const block = ssz.phase0.BeaconBlock.defaultValue();
      block.slot = childSlot;
      block.parentRoot = fromHexString(getBlockRoot(headSlot));
      const blockRoot = toHex(ssz.phase0.BeaconBlock.hashTreeRoot(block));

      expectParentExecutionInvalid(() =>
        forkChoice.onBlock(block, state, 0, 0, childSlot, executionStatus, DataAvailabilityStatus.PreData)
      );
      expect(forkChoice.hasBlockHex(blockRoot)).toBe(false);
      expect(forkChoice.irrecoverableError).toBeUndefined();
      expect(forkChoice.updateHead().blockRoot).toBe(getBlockRoot(parentSlot));
    }
  );

  it("onExecutionPayload rejects a payload for a block on an invalidated payload chain", () => {
    const {forkChoice, protoArray} = setup(true);
    invalidateHead(forkChoice, true);

    expectParentExecutionInvalid(() =>
      forkChoice.onExecutionPayload(
        getBlockRoot(headSlot),
        payloadHash(headSlot),
        headSlot,
        30_000_000,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      )
    );
    expect(protoArray.getNodeIndexByRootAndStatus(getBlockRoot(headSlot), PayloadStatus.FULL)).toBeUndefined();
    expect(forkChoice.irrecoverableError).toBeUndefined();
  });

  it("a gloas block inherits the execution status of the parent variant it builds on", () => {
    const {forkChoice} = setup(true);

    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = childSlot;
    block.parentRoot = fromHexString(getBlockRoot(parentSlot));
    block.body.signedExecutionPayloadBid.message.parentBlockHash = fromHexString(payloadHash(parentSlot));

    const protoBlock = forkChoice.onBlock(
      block,
      state,
      0,
      0,
      childSlot,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.NotRequired
    );

    expect(protoBlock.executionStatus).toBe(ExecutionStatus.Syncing);
    expect(forkChoice.getBlockHex(getBlockRoot(parentSlot), PayloadStatus.FULL)?.executionStatus).toBe(
      ExecutionStatus.Syncing
    );
  });
});
