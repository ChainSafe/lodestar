import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
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
  ProtoBlock,
} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {VALIDATOR_COUNT, genesisSlot, gloasConfig, makeStore, toProtoBlock} from "./proposerHeadTestUtils.js";

const anchorSlot = genesisSlot;
const childSlot = anchorSlot + 1;
const anchorRoot = getBlockRoot(anchorSlot);

// Block hash and root of the last pre-gloas payload, and of a payload which is not on the chain
const lastPayloadHash = toHex(Buffer.alloc(32, 0x11));
const lastPayloadRoot = toHex(Buffer.alloc(32, 0x22));
const otherPayloadRoot = toHex(Buffer.alloc(32, 0x33));

function checkpoint(): {epoch: number; root: Uint8Array} {
  return {epoch: 0, root: fromHexString(anchorRoot)};
}

const state = {
  currentJustifiedCheckpoint: checkpoint(),
  finalizedCheckpoint: checkpoint(),
  computeUnrealizedCheckpoints: () => ({justifiedCheckpoint: checkpoint(), finalizedCheckpoint: checkpoint()}),
  getBlockRootAtSlot: (slot: Slot) => fromHexString(getBlockRoot(slot)),
  isExecutionStateType: false,
} as unknown as IBeaconStateView;

function setup(anchor: ProtoBlock): {forkChoice: ForkChoice; protoArray: ProtoArray} {
  const protoArray = ProtoArray.initialize(anchor, anchorSlot);
  const forkChoice = new ForkChoice(
    gloasConfig,
    {...makeStore(), currentSlot: childSlot},
    protoArray,
    VALIDATOR_COUNT,
    null
  );
  return {forkChoice, protoArray};
}

/** The first gloas block, building on the anchor */
function firstGloasBlock(parentPayloadRoot: RootHex) {
  const block = ssz.gloas.BeaconBlock.defaultValue();
  block.slot = childSlot;
  block.parentRoot = fromHexString(anchorRoot);
  block.body.signedExecutionPayloadBid.message.parentBlockHash = fromHexString(lastPayloadHash);
  block.body.signedExecutionPayloadBid.message.parentPayloadRoot = fromHexString(parentPayloadRoot);
  block.body.signedExecutionPayloadBid.message.payloadRoot = Buffer.alloc(32, 0x44);
  return block;
}

function onBlock(forkChoice: ForkChoice, parentPayloadRoot: RootHex): ProtoBlock {
  return forkChoice.onBlock(
    firstGloasBlock(parentPayloadRoot),
    state,
    0,
    0,
    childSlot,
    ExecutionStatus.Valid,
    DataAvailabilityStatus.NotRequired
  );
}

function expectUnknownParent(fn: () => void): void {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ForkChoiceError);
  const {type} = error as ForkChoiceError;
  expect(type.code).toBe(ForkChoiceErrorCode.INVALID_BLOCK);
  expect(type.code === ForkChoiceErrorCode.INVALID_BLOCK && type.err.code).toBe(InvalidBlockCode.UNKNOWN_PARENT);
}

describe("ForkChoice / first gloas block", () => {
  describe("anchor from a state upgraded to gloas", () => {
    // The latest block of the state is pre-gloas. `upgradeStateToGloas` sets both `latestPayloadRoot` and
    // `latestExecutionPayloadBid.payloadRoot` to the root of the last pre-gloas payload, so the anchor
    // commits to the payload it builds on. It has no payload of its own to import
    // This anchor is built by hand, it shows what fork choice does with such a node. That the node of a real
    // upgraded state has these fields is covered in beacon-node, which owns the code that derives them from the
    // state: "LodestarForkChoice anchor variants" in test/unit/chain/forkChoice/forkChoice.test.ts
    const anchor = toProtoBlock(anchorSlot, anchorRoot, true, {
      executionPayloadBlockHash: lastPayloadHash,
      executionPayloadRoot: lastPayloadRoot,
      parentBlockHash: lastPayloadHash,
      parentPayloadRoot: lastPayloadRoot,
      payloadRoot: lastPayloadRoot,
      payloadStatus: PayloadStatus.PENDING,
    });

    it("accepts a block building on the last pre-gloas payload", () => {
      const {forkChoice, protoArray} = setup(anchor);
      expect(protoArray.getNodeIndexByRootAndStatus(anchorRoot, PayloadStatus.FULL)).toBeUndefined();

      const protoBlock = onBlock(forkChoice, lastPayloadRoot);

      expect(forkChoice.hasBlockHex(protoBlock.blockRoot)).toBe(true);
      expect(protoArray.getParentPayloadStatus(protoBlock)).toBe(PayloadStatus.EMPTY);
      expect(protoBlock.executionPayloadRoot).toBe(lastPayloadRoot);
      expect(protoBlock.executionPayloadBlockHash).toBe(lastPayloadHash);
      expect(forkChoice.getBlockHexAndPayloadRoot(anchorRoot, lastPayloadRoot)?.payloadStatus).toBe(
        PayloadStatus.EMPTY
      );
    });

    it("rejects a block naming another parent payload root", () => {
      const {forkChoice} = setup(anchor);
      expectUnknownParent(() => onBlock(forkChoice, otherPayloadRoot));
      expect(forkChoice.getBlockHexAndPayloadRoot(anchorRoot, otherPayloadRoot)).toBeNull();
    });
  });

  describe("pre-gloas parent", () => {
    const anchor = toProtoBlock(anchorSlot, anchorRoot, false, {
      executionPayloadBlockHash: lastPayloadHash,
      executionPayloadRoot: lastPayloadRoot,
    });

    it("accepts a block building on the payload of the parent", () => {
      const {forkChoice} = setup(anchor);
      const protoBlock = onBlock(forkChoice, lastPayloadRoot);

      expect(forkChoice.hasBlockHex(protoBlock.blockRoot)).toBe(true);
      expect(protoBlock.executionPayloadRoot).toBe(lastPayloadRoot);
      expect(forkChoice.getBlockHexAndPayloadRoot(anchorRoot, lastPayloadRoot)?.blockRoot).toBe(anchorRoot);
    });

    it("rejects a block naming another parent payload root", () => {
      const {forkChoice} = setup(anchor);
      expectUnknownParent(() => onBlock(forkChoice, otherPayloadRoot));
      expect(forkChoice.getBlockHexAndPayloadRoot(anchorRoot, otherPayloadRoot)).toBeNull();
      // The block hash of the payload is not its root
      expect(forkChoice.getBlockHexAndPayloadRoot(anchorRoot, lastPayloadHash)).toBeNull();
    });
  });

  it("a pre-gloas block carries the root of its payload", () => {
    const fuluConfig = createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
    });
    const protoArray = ProtoArray.initialize(
      toProtoBlock(anchorSlot, anchorRoot, false, {
        executionPayloadBlockHash: lastPayloadHash,
        executionPayloadRoot: lastPayloadRoot,
      }),
      anchorSlot
    );
    const forkChoice = new ForkChoice(
      fuluConfig,
      {...makeStore(), currentSlot: childSlot},
      protoArray,
      VALIDATOR_COUNT,
      null
    );

    const block = ssz.fulu.BeaconBlock.defaultValue();
    block.slot = childSlot;
    block.parentRoot = fromHexString(anchorRoot);
    const payload = block.body.executionPayload;
    payload.parentHash = fromHexString(lastPayloadHash);
    payload.blockHash = Buffer.alloc(32, 0x55);
    payload.blockNumber = 7;
    payload.gasLimit = 30_000_000;
    payload.withdrawals = [{index: 1, validatorIndex: 2, address: Buffer.alloc(20, 3), amount: 4n}];
    const payloadRoot = toHex(ssz.fulu.ExecutionPayload.hashTreeRoot(payload));

    // The post-state of the block holds the header of its payload
    const {transactions, withdrawals, ...headerFields} = payload;
    const postState = {
      ...state,
      forkName: ForkName.fulu,
      isExecutionStateType: true,
      isExecutionEnabled: () => true,
      latestExecutionPayloadHeader: {
        ...headerFields,
        transactionsRoot: ssz.fulu.ExecutionPayload.fields.transactions.hashTreeRoot(transactions),
        withdrawalsRoot: ssz.fulu.ExecutionPayload.fields.withdrawals.hashTreeRoot(withdrawals),
      },
    } as unknown as IBeaconStateView;

    const protoBlock = forkChoice.onBlock(
      block,
      postState,
      0,
      0,
      childSlot,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );

    expect(protoBlock.executionPayloadBlockHash).toBe(toHex(payload.blockHash));
    expect(protoBlock.executionPayloadRoot).toBe(payloadRoot);
    expect(forkChoice.getBlockHexAndPayloadRoot(protoBlock.blockRoot, payloadRoot)).not.toBeNull();
    expect(forkChoice.getBlockHexAndPayloadRoot(protoBlock.blockRoot, toHex(payload.blockHash))).toBeNull();
  });
});
