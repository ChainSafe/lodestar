import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {
  CheckpointWithHex,
  ExecutionStatus,
  ForkChoice,
  ParentPayloadDependency,
  PayloadStatus,
  ProtoBlock,
} from "@lodestar/fork-choice";
import {FAR_FUTURE_EPOCH, ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  BeaconStateFulu,
  BeaconStateGloas,
  BeaconStateView,
  DataAvailabilityStatus,
  computeAnchorCheckpoint,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getEffectiveBalanceIncrementsZeroed,
  getTemporaryBlockHeader,
  processSlots,
} from "@lodestar/state-transition";
import {IndexedAttestation, Slot, ValidatorIndex, phase0, ssz} from "@lodestar/types";
import {ChainEventEmitter, initializeForkChoice} from "../../../../src/chain/index.js";
import {initDevState} from "../../../../src/node/utils/state.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {generateState} from "../../../utils/state.js";
import {generateSignedBlockAtSlot} from "../../../utils/typeGenerator.js";
import {
  generateGloasAnchorState,
  initForkChoiceFromUnfinalizedGloasState,
} from "../../../utils/unfinalizedForkChoice.js";
import {generateValidators} from "../../../utils/validator.js";

// We mock this package globally
vi.unmock("@lodestar/fork-choice");

describe("LodestarForkChoice", () => {
  let forkChoice: ForkChoice;
  const anchorState = createCachedBeaconStateTest(
    generateState(
      {
        slot: 0,
        validators: generateValidators(3, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
          withdrawableEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: 3}, () => 0),
        // Jan 01 2020
        genesisTime: 1577836800,
      },
      config
    ),
    config
  );
  const anchorStateView = new BeaconStateView(anchorState);

  // 3 validators involved
  const justifiedBalances = getEffectiveBalanceIncrementsZeroed(3);
  justifiedBalances[0] = 1;
  justifiedBalances[1] = 2;
  justifiedBalances[2] = 3;
  const executionStatus = ExecutionStatus.PreMerge;
  const dataAvailabilityStatus = DataAvailabilityStatus.PreData;
  const blockDelayMs = 0;

  const hashBlock = (block: phase0.BeaconBlock): string => toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(block));

  let state: BeaconStateView;

  beforeAll(() => {
    state = new BeaconStateView(createCachedBeaconStateTest(anchorState, config));
  });

  beforeEach(() => {
    const emitter = new ChainEventEmitter();
    const currentSlot = 16;
    forkChoice = initializeForkChoice(
      config,
      emitter,
      currentSlot,
      state,
      true,
      {},
      (_: CheckpointWithHex) => justifiedBalances,
      () => null,
      null
    );
  });

  describe("forkchoice", () => {
    /**
     * slot 32(checkpoint) - orphaned (36)
     *                     \
     *                       parent (37) - child (38)
     */
    it.skip("getHead - should not consider orphaned block as head", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const targetBlock = generateSignedBlockAtSlot(32);
      targetBlock.message.parentRoot = finalizedRoot;
      //
      const targetState = runStateTransition(anchorStateView, targetBlock);
      targetBlock.message.stateRoot = targetState.hashTreeRoot();
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 36);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 37);
      const {block: childBlock, state: childState} = makeChild({block: parentBlock, state: parentState}, 38);
      const parentBlockHex = ssz.phase0.BeaconBlock.hashTreeRoot(parentBlock.message);
      const orphanedBlockHex = ssz.phase0.BeaconBlock.hashTreeRoot(orphanedBlock.message);
      // forkchoice tie-break condition is based on root hex
      expect(orphanedBlockHex > parentBlockHex).toBe(true);
      const currentSlot = childBlock.message.slot;
      forkChoice.updateTime(currentSlot);

      forkChoice.onBlock(
        targetBlock.message,
        targetState,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.onBlock(
        orphanedBlock.message,
        orphanedState,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      let head = forkChoice.getHead();
      expect(head.slot).toBe(orphanedBlock.message.slot);
      forkChoice.onBlock(
        parentBlock.message,
        parentState,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      // tie break condition causes head to be orphaned block (based on hex root comparison)
      head = forkChoice.getHead();
      expect(head.slot).toBe(orphanedBlock.message.slot);
      forkChoice.onBlock(
        childBlock.message,
        childState,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      head = forkChoice.getHead();
      // without vote, head gets stuck at orphaned block
      expect(head.slot).toBe(orphanedBlock.message.slot);
      const source: phase0.Checkpoint = {
        root: finalizedRoot,
        epoch: computeEpochAtSlot(blockHeader.slot),
      };
      const attestation0 = createIndexedAttestation(source, targetBlock, orphanedBlock, 0);
      const attestation1 = createIndexedAttestation(source, targetBlock, parentBlock, 1);
      const attestation2 = createIndexedAttestation(source, targetBlock, childBlock, 2);
      forkChoice.onAttestation(attestation0, toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation0.data)));
      forkChoice.onAttestation(attestation1, toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation1.data)));
      forkChoice.onAttestation(attestation2, toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation2.data)));
      head = forkChoice.getHead();
      // with votes, head becomes the child block
      expect(head.slot).toBe(childBlock.message.slot);
    });

    /**
     * finalized - slot 8 (finalized 1) - slot 12 - slot 16 (finalized 2) - slot 20 - slot 24 (finalized 3) - slot 28 - slot 32 (finalized 4)
     */
    it("prune - should prune old blocks", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const block08 = generateSignedBlockAtSlot(8);
      block08.message.parentRoot = finalizedRoot;
      const state08 = runStateTransition(anchorStateView, block08);
      block08.message.stateRoot = state08.hashTreeRoot();

      const {block: block12, state: state12} = makeChild({block: block08, state: state08}, 12);
      const {block: block16, state: state16} = makeChild({block: block12, state: state12}, 16);
      state16.cachedState.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block08.message),
        epoch: 1,
      });
      const {block: block20, state: state20} = makeChild({block: block16, state: state16}, 20);
      const {block: block24, state: state24} = makeChild({block: block20, state: state20}, 24);
      state24.cachedState.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block08.message),
        epoch: 1,
      });
      state24.cachedState.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block16.message),
        epoch: 2,
      });
      const {block: block28, state: state28} = makeChild({block: block24, state: state24}, 28);
      const {block: block32, state: state32} = makeChild({block: block28, state: state28}, 32);
      state32.cachedState.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block16.message),
        epoch: 2,
      });
      state32.cachedState.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block24.message),
        epoch: 3,
      });
      const currentSlot = 128;
      forkChoice.updateTime(currentSlot);

      forkChoice.onBlock(
        block08.message,
        state08,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.onBlock(
        block12.message,
        state12,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.onBlock(
        block16.message,
        state16,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.onBlock(
        block20.message,
        state20,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.onBlock(
        block24.message,
        state24,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.onBlock(
        block28.message,
        state28,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block16.message), PayloadStatus.FULL)).toHaveLength(4);
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block24.message), PayloadStatus.FULL)).toHaveLength(6);
      expect(forkChoice.getBlockHexDefaultStatus(hashBlock(block08.message))).not.toBeNull();
      expect(forkChoice.getBlockHexDefaultStatus(hashBlock(block12.message))).not.toBeNull();
      expect(forkChoice.hasBlockHex(hashBlock(block08.message))).toBe(true);
      expect(forkChoice.hasBlockHex(hashBlock(block12.message))).toBe(true);
      forkChoice.onBlock(
        block32.message,
        state32,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.prune(hashBlock(block16.message));
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block16.message), PayloadStatus.FULL).length).toBeWithMessage(
        1,
        "getAllAncestorBlocks returns the finalized block itself as the last (boundary) node"
      );
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block24.message), PayloadStatus.FULL)).toHaveLength(3);
      expect(forkChoice.getBlockHexDefaultStatus(hashBlock(block08.message))).toBe(null);
      expect(forkChoice.getBlockHexDefaultStatus(hashBlock(block12.message))).toBe(null);
      expect(forkChoice.hasBlockHex(hashBlock(block08.message))).toBe(false);
      expect(forkChoice.hasBlockHex(hashBlock(block12.message))).toBe(false);
    });

    /**
     * slot 32(checkpoint) - orphaned (33)
     *                     \
     *                       parent (34) - child (35)
     */
    it("getAllNonAncestorBlocks - should get non ancestor nodes", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const targetBlock = generateSignedBlockAtSlot(32);
      targetBlock.message.parentRoot = finalizedRoot;
      const targetState = runStateTransition(anchorStateView, targetBlock);
      targetBlock.message.stateRoot = targetState.hashTreeRoot();
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 33);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 34);
      const currentSlot = 35;
      const {block: childBlock, state: childState} = makeChild({block: parentBlock, state: parentState}, currentSlot);
      forkChoice.updateTime(currentSlot);
      forkChoice.onBlock(
        targetBlock.message,
        targetState,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.onBlock(
        orphanedBlock.message,
        orphanedState,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.onBlock(
        parentBlock.message,
        parentState,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      forkChoice.onBlock(
        childBlock.message,
        childState,
        blockDelayMs,
        blockDelayMs,
        currentSlot,
        executionStatus,
        dataAvailabilityStatus
      );
      const childBlockRoot = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(childBlock.message));
      // the old way to get non canonical blocks
      const nonCanonicalSummaries = forkChoice
        .forwarditerateAncestorBlocks()
        .filter(
          (summary) =>
            summary.slot < childBlock.message.slot &&
            !forkChoice.isDescendant(summary.blockRoot, summary.payloadStatus, childBlockRoot, PayloadStatus.FULL)
        );
      // compare to getAllNonAncestorBlocks api
      expect(forkChoice.getAllNonAncestorBlocks(childBlockRoot, PayloadStatus.FULL)).toEqual(nonCanonicalSummaries);
    });

    /**
     * Reorg scenario
     *
     * Epoch 9      |Epoch 10                   |Epoch 11
     * |C9          |(W)C10 - - - - - X - - - - |Z
     * |            |                  \
     * |            |                   Y
     * With U = Unrealized Checkpoint, J = Justified Checkpoint
     *   U(X) = C10
     *   J(X) = C9
     *   U(Y) = C10
     *   J(Y) = C9
     *   J(Z) = C10
     *
     * To simplify, go with epoch 0, 1, 2 instead of 9, 10, 11
     */
    it.skip("should not filter blocks with unrealized checkpoints = store checkpoints", () => {
      const blockDelayMs = 0;
      // C9 is the justified/finalized block
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      // C10
      const blockW = generateSignedBlockAtSlot(8);
      blockW.message.parentRoot = finalizedRoot;
      const stateW = runStateTransition(anchorStateView, blockW);
      blockW.message.stateRoot = stateW.hashTreeRoot();
      forkChoice.onBlock(
        blockW.message,
        stateW,
        blockDelayMs,
        blockDelayMs,
        blockW.message.slot,
        executionStatus,
        dataAvailabilityStatus
      );

      // X
      const {block: blockX, state: stateX} = makeChild({block: blockW, state: stateW}, 12);
      stateX.cachedState.blockRoots.set(blockW.message.slot, ssz.phase0.BeaconBlock.hashTreeRoot(blockW.message));
      forkChoice.onBlock(
        blockX.message,
        stateX,
        blockDelayMs,
        blockDelayMs,
        blockX.message.slot,
        executionStatus,
        dataAvailabilityStatus
      );

      // Y, same epoch to X
      const {block: blockY, state: stateY} = makeChild({block: blockX, state: stateX}, 13);
      stateY.cachedState.blockRoots.set(blockW.message.slot, ssz.phase0.BeaconBlock.hashTreeRoot(blockW.message));
      forkChoice.onBlock(
        blockY.message,
        stateY,
        blockDelayMs,
        blockDelayMs,
        blockY.message.slot,
        executionStatus,
        dataAvailabilityStatus
      );

      // Y and Z are candidates for new head, make more attestations on Y
      forkChoice.updateTime(blockY.message.slot);
      const source: phase0.Checkpoint = {
        root: finalizedRoot,
        epoch: computeEpochAtSlot(blockHeader.slot),
      };
      for (const validatorIndex of [0, 1, 2]) {
        const attestation = {
          attestingIndices: [validatorIndex],
          data: {
            slot: blockY.message.slot,
            index: 0,
            beaconBlockRoot: ssz.phase0.BeaconBlock.hashTreeRoot(blockY.message),
            source,
            target: {
              epoch: computeEpochAtSlot(blockW.message.slot),
              root: ssz.phase0.BeaconBlock.hashTreeRoot(blockW.message),
            },
          },
          signature: Buffer.alloc(96),
        };
        forkChoice.onAttestation(attestation, toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation.data)));
      }

      // Z stays on next epoch, a child of X which potentially reorg Y
      const {block: blockZ, state: stateZ} = makeChild({block: blockX, state: stateX}, 16);
      // without unrealized checkpoints, Y would be filtered due to different justified checkpoint
      stateZ.cachedState.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(blockW.message),
        epoch: computeEpochAtSlot(blockW.message.slot),
      });
      forkChoice.updateTime(blockZ.message.slot);
      forkChoice.onBlock(
        blockZ.message,
        stateZ,
        blockDelayMs,
        blockDelayMs,
        blockZ.message.slot,
        executionStatus,
        dataAvailabilityStatus
      );

      const head = forkChoice.updateHead();
      expect(head.blockRoot).toBeWithMessage(
        toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(blockY.message)),
        "blockY should be new head as it's a potential head and has same unrealized justified checkpoints & more attestations"
      );
    });
  });
});

// lightweight state transtion function for this test
function runStateTransition(preState: BeaconStateView, signedBlock: phase0.SignedBeaconBlock): BeaconStateView {
  // Process slots (including those with no blocks) since block
  const postState = processSlots(preState.cachedState, signedBlock.message.slot);
  // processBlock
  postState.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU(
    getTemporaryBlockHeader(config, signedBlock.message)
  );
  return new BeaconStateView(postState);
}

// create a child block/state from a parent block/state and a provided slot
function makeChild(
  parent: {block: phase0.SignedBeaconBlock; state: BeaconStateView},
  slot: Slot
): {block: phase0.SignedBeaconBlock; state: BeaconStateView} {
  const childBlock = generateSignedBlockAtSlot(slot);
  const parentRoot = ssz.phase0.BeaconBlock.hashTreeRoot(parent.block.message);
  childBlock.message.parentRoot = parentRoot;
  const childState = runStateTransition(parent.state, childBlock);
  return {block: childBlock, state: childState};
}

function createIndexedAttestation(
  source: phase0.Checkpoint,
  target: phase0.SignedBeaconBlock,
  block: phase0.SignedBeaconBlock,
  validatorIndex: ValidatorIndex
): IndexedAttestation {
  return {
    attestingIndices: [validatorIndex],
    data: {
      slot: block.message.slot,
      index: 0,
      beaconBlockRoot: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      source,
      target: createCheckpoint(target),
    },
    signature: Buffer.alloc(96),
  };
}

function createCheckpoint(block: phase0.SignedBeaconBlock): phase0.Checkpoint {
  return {
    root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
    epoch: computeEpochAtSlot(block.message.slot),
  };
}

describe("LodestarForkChoice anchor payload root", () => {
  const blockHash = Buffer.alloc(32, 0x11);
  const otherPayloadRoot = toHexString(Buffer.alloc(32, 0x33));

  function getAnchorRoot(state: BeaconStateView): string {
    return toHexString(state.computeAnchorCheckpoint().checkpoint.root);
  }

  function initForkChoice(state: BeaconStateView, forkConfig: ChainForkConfig, isFinalizedState: boolean): ForkChoice {
    return initializeForkChoice(
      forkConfig,
      new ChainEventEmitter(),
      state.slot + 1,
      state,
      isFinalizedState,
      {},
      () => getEffectiveBalanceIncrementsZeroed(16),
      () => null,
      null
    );
  }

  describe.each([
    {name: "finalized", isFinalizedState: true},
    {name: "unfinalized", isFinalizedState: false},
  ])("$name state", ({isFinalizedState}) => {
    it("pre-gloas anchor is matched by the root of its payload only", () => {
      const forkConfig = getConfig(ForkName.fulu);
      const stateValue = generateState({slot: 0}, forkConfig) as BeaconStateFulu;
      stateValue.latestExecutionPayloadHeader.blockHash = blockHash;
      stateValue.latestExecutionPayloadHeader.blockNumber = 7;
      const payloadRoot = toHexString(stateValue.latestExecutionPayloadHeader.hashTreeRoot());
      const state = new BeaconStateView(createCachedBeaconStateTest(stateValue, forkConfig));

      const forkChoice = initForkChoice(state, forkConfig, isFinalizedState);
      const anchorRoot = getAnchorRoot(state);

      const anchor = forkChoice.getBlockHexAndPayloadRoot(anchorRoot, payloadRoot);
      expect(anchor?.payloadStatus).toBe(PayloadStatus.FULL);
      expect(anchor?.executionPayloadRoot).toBe(payloadRoot);
      expect(anchor?.executionPayloadBlockHash).toBe(toHexString(blockHash));
      expect(forkChoice.getBlockHexAndPayloadRoot(anchorRoot, otherPayloadRoot)).toBeNull();
      expect(forkChoice.getBlockHexAndPayloadRoot(anchorRoot, toHexString(blockHash))).toBeNull();
    });

    it("anchor from a state upgraded to gloas is matched by the last pre-gloas payload root", () => {
      const forkConfig = getConfig(ForkName.gloas);
      const stateValue = generateState({slot: 0}, forkConfig) as BeaconStateGloas;
      // Same as upgradeStateToGloas: the latest block is pre-gloas, the state builds on its payload and the
      // bid commits to that same payload
      const payloadRoot = Buffer.alloc(32, 0x22);
      stateValue.latestBlockHash = blockHash;
      stateValue.latestPayloadRoot = payloadRoot;
      stateValue.latestExecutionPayloadBid.blockHash = blockHash;
      stateValue.latestExecutionPayloadBid.payloadRoot = payloadRoot;
      const state = new BeaconStateView(createCachedBeaconStateTest(stateValue, forkConfig));

      const forkChoice = initForkChoice(state, forkConfig, isFinalizedState);
      const anchorRoot = getAnchorRoot(state);

      // No payload can be imported for the anchor, a block building on it builds on its EMPTY variant
      expect(forkChoice.getBlockHex(anchorRoot, PayloadStatus.FULL)).toBeNull();
      const anchor = forkChoice.getBlockHexAndPayloadRoot(anchorRoot, toHexString(payloadRoot));
      expect(anchor?.payloadStatus).toBe(PayloadStatus.EMPTY);
      expect(anchor?.executionPayloadRoot).toBe(toHexString(payloadRoot));
      expect(anchor?.executionPayloadBlockHash).toBe(toHexString(blockHash));
      expect(forkChoice.getBlockHexAndPayloadRoot(anchorRoot, otherPayloadRoot)).toBeNull();
    });
  });
});

/**
 * The anchor node is the only node whose bid and execution payload fields are not read from a block but derived
 * from a state. These tests go through the initialisation code of the node with states that are built by the
 * state transition where it matters (upgrade to gloas, genesis), and check what a child and the envelope of the
 * anchor do with the node.
 */
describe("LodestarForkChoice anchor variants", () => {
  const otherPayloadRoot = toHexString(Buffer.alloc(32, 0x33));
  const envelopeBlockHash = toHexString(Buffer.alloc(32, 0xee));

  function initForkChoice(state: BeaconStateView, forkConfig: ChainForkConfig, isFinalizedState: boolean): ForkChoice {
    return initializeForkChoice(
      forkConfig,
      new ChainEventEmitter(),
      state.slot + 1,
      state,
      isFinalizedState,
      {},
      () => getEffectiveBalanceIncrementsZeroed(state.validatorCount),
      () => null,
      null
    );
  }

  /** What the anchor state says about its latest block, read independently of the fork choice code */
  function readAnchor(state: BeaconStateView): {
    root: string;
    slot: Slot;
    latestBlockHash: string;
    latestPayloadRoot: string;
    bidPayloadRoot: string;
  } {
    const stateGloas = state.cachedState as BeaconStateGloas;
    return {
      root: toHexString(state.computeAnchorCheckpoint().checkpoint.root),
      slot: stateGloas.latestBlockHeader.slot,
      latestBlockHash: toHexString(stateGloas.latestBlockHash),
      latestPayloadRoot: toHexString(stateGloas.latestPayloadRoot),
      bidPayloadRoot: toHexString(stateGloas.latestExecutionPayloadBid.payloadRoot),
    };
  }

  /** Imports a gloas block on top of the anchor, with a bid that builds on the given payload */
  function importChild(
    forkChoice: ForkChoice,
    anchorRoot: string,
    slot: Slot,
    parentBlockHash: string,
    parentPayloadRoot: string
  ): ProtoBlock {
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.slot = slot;
    block.parentRoot = fromHexString(anchorRoot);
    block.body.signedExecutionPayloadBid.message.parentBlockHash = fromHexString(parentBlockHash);
    block.body.signedExecutionPayloadBid.message.parentPayloadRoot = fromHexString(parentPayloadRoot);
    block.body.signedExecutionPayloadBid.message.payloadRoot = Buffer.alloc(32, 0x44);
    // Fork choice reads the checkpoints and the target root from the post-state of the block
    const justifiedCheckpoint = forkChoice.getJustifiedCheckpoint();
    const finalizedCheckpoint = forkChoice.getFinalizedCheckpoint();
    const postState = {
      currentJustifiedCheckpoint: justifiedCheckpoint,
      finalizedCheckpoint,
      computeUnrealizedCheckpoints: () => ({justifiedCheckpoint, finalizedCheckpoint}),
      getBlockRootAtSlot: () => fromHexString(anchorRoot),
      isExecutionStateType: false,
    } as unknown as BeaconStateView;
    forkChoice.updateTime(slot);
    return forkChoice.onBlock(
      block,
      postState,
      0,
      0,
      slot,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.NotRequired
    );
  }

  /** The payload status of the variant of the parent which the PENDING node of `child` is attached to */
  function getAttachedParentVariant(forkChoice: ForkChoice, child: ProtoBlock): PayloadStatus | undefined {
    const protoArray = forkChoice["protoArray"];
    const parentIndex = protoArray.getNode(child.blockRoot, PayloadStatus.PENDING)?.parent;
    for (const status of [PayloadStatus.PENDING, PayloadStatus.EMPTY, PayloadStatus.FULL]) {
      if (
        parentIndex !== undefined &&
        protoArray.getNodeIndexByRootAndStatus(child.parentRoot, status) === parentIndex
      ) {
        return status;
      }
    }
    return undefined;
  }

  function importAnchorPayload(forkChoice: ForkChoice, anchorRoot: string): void {
    forkChoice.onExecutionPayload(
      anchorRoot,
      envelopeBlockHash,
      9,
      30_000_000,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
  }

  /** PENDING and EMPTY carry the payload the anchor block builds on, there is no FULL variant at start */
  function expectAnchorVariants(forkChoice: ForkChoice, anchor: ReturnType<typeof readAnchor>): void {
    for (const status of [PayloadStatus.PENDING, PayloadStatus.EMPTY]) {
      const node = forkChoice.getBlockHex(anchor.root, status);
      expect(node?.payloadStatus).toBe(status);
      expect(node?.isPlaceholder).toBeUndefined();
      expect(node?.executionPayloadRoot).toBe(anchor.latestPayloadRoot);
      expect(node?.executionPayloadBlockHash).toBe(anchor.latestBlockHash);
      expect(node?.parentPayloadRoot).toBe(anchor.latestPayloadRoot);
      expect(node?.parentBlockHash).toBe(anchor.latestBlockHash);
      expect(node?.payloadRoot).toBe(anchor.bidPayloadRoot);
    }
    expect(forkChoice.getBlockHex(anchor.root, PayloadStatus.FULL)).toBeNull();
    expect(forkChoice.getBlockHexAndPayloadRoot(anchor.root, anchor.latestPayloadRoot)?.payloadStatus).toBe(
      PayloadStatus.EMPTY
    );
    expect(forkChoice.getParentPayloadDependency(anchor.root, anchor.latestPayloadRoot)).toBe(
      ParentPayloadDependency.Ready
    );
    // The block hash of a payload is not its root
    expect(forkChoice.getBlockHexAndPayloadRoot(anchor.root, anchor.latestBlockHash)).toBeNull();
    expect(forkChoice.getParentPayloadDependency(anchor.root, otherPayloadRoot)).toBe(ParentPayloadDependency.Invalid);
  }

  /** The envelope of the anchor creates the FULL variant, with the payload root of the bid in the state */
  function expectAnchorFullVariant(forkChoice: ForkChoice, anchor: ReturnType<typeof readAnchor>): void {
    const full = forkChoice.getBlockHex(anchor.root, PayloadStatus.FULL);
    expect(full?.payloadStatus).toBe(PayloadStatus.FULL);
    expect(full?.executionPayloadRoot).toBe(anchor.bidPayloadRoot);
    expect(full?.executionPayloadBlockHash).toBe(envelopeBlockHash);
    // The other variants still carry the payload the anchor block builds on
    expect(forkChoice.getBlockHex(anchor.root, PayloadStatus.EMPTY)?.executionPayloadRoot).toBe(
      anchor.latestPayloadRoot
    );
    expect(forkChoice.getBlockHex(anchor.root, PayloadStatus.PENDING)?.executionPayloadRoot).toBe(
      anchor.latestPayloadRoot
    );
  }

  describe.each([
    {name: "finalized", isFinalizedState: true},
    {name: "unfinalized", isFinalizedState: false},
  ])("$name state", ({isFinalizedState}) => {
    describe("anchor from a state upgraded to gloas, the latest block is pre-gloas", () => {
      const gloasForkEpoch = 3;
      const forkConfig = getConfig(ForkName.gloas, gloasForkEpoch);
      const gloasForkSlot = computeStartSlotAtEpoch(gloasForkEpoch);
      const lastPayloadBlockHash = Buffer.alloc(32, 0x11);

      /**
       * A fulu genesis state advanced into gloas by the state transition, which upgrades it at the fork epoch
       * (`upgradeStateToGloas`). No block is imported on the way, the last pre-gloas payload is the genesis
       * payload. The block header and the checkpoints are then set to those of a chain with a latest block in
       * the last pre-gloas slot and justified and finalized checkpoints, as fork choice needs them
       */
      let upgradedState: {state: BeaconStateView; lastPayloadRoot: string} | undefined;
      function getUpgradedState(): {state: BeaconStateView; lastPayloadRoot: string} {
        // Advancing the state is slow, fork choice does not change it
        upgradedState ??= buildUpgradedState();
        return upgradedState;
      }

      function buildUpgradedState(): {state: BeaconStateView; lastPayloadRoot: string} {
        // Enough validators for every slot to have a committee, which the PTC of the upgraded state is sampled from
        const stateFulu = initDevState(forkConfig, 2 * SLOTS_PER_EPOCH, {
          eth1BlockHash: lastPayloadBlockHash,
        }) as BeaconStateFulu;
        // The root of a payload equals the root of its header
        const lastPayloadRoot = toHexString(stateFulu.latestExecutionPayloadHeader.hashTreeRoot());
        expect(toHexString(stateFulu.latestExecutionPayloadHeader.blockHash)).toBe(toHexString(lastPayloadBlockHash));

        const stateGloas = processSlots(
          createCachedBeaconStateTest(stateFulu, forkConfig),
          gloasForkSlot
        ) as BeaconStateGloas;
        stateGloas.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
          slot: gloasForkSlot - 1,
          proposerIndex: 0,
          parentRoot: Buffer.alloc(32, 0xa1),
          stateRoot: Buffer.alloc(32),
          bodyRoot: Buffer.alloc(32, 0xb0),
        });
        stateGloas.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
          epoch: 2,
          root: Buffer.alloc(32, 0xa2),
        });
        stateGloas.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: 1, root: Buffer.alloc(32, 0xa3)});
        stateGloas.commit();
        return {state: new BeaconStateView(createCachedBeaconStateTest(stateGloas, forkConfig)), lastPayloadRoot};
      }

      it("has PENDING and EMPTY variants on the last pre-gloas payload, which the bid commits to as well", () => {
        const {state, lastPayloadRoot} = getUpgradedState();
        const anchor = readAnchor(state);
        // What the anchor code has to derive, from the fulu state
        expect(anchor.slot).toBe(gloasForkSlot - 1);
        expect(anchor.latestPayloadRoot).toBe(lastPayloadRoot);
        expect(anchor.bidPayloadRoot).toBe(lastPayloadRoot);
        expect(anchor.latestBlockHash).toBe(toHexString(lastPayloadBlockHash));

        const forkChoice = initForkChoice(state, forkConfig, isFinalizedState);
        expectAnchorVariants(forkChoice, anchor);
      });

      it("the first gloas block builds on the EMPTY variant, it has no payload to wait for", () => {
        const {state} = getUpgradedState();
        const anchor = readAnchor(state);
        const forkChoice = initForkChoice(state, forkConfig, isFinalizedState);

        // The state is at the fork slot without a block, the first gloas block comes after it
        const child = importChild(
          forkChoice,
          anchor.root,
          gloasForkSlot + 1,
          anchor.latestBlockHash,
          anchor.bidPayloadRoot
        );
        expect(getAttachedParentVariant(forkChoice, child)).toBe(PayloadStatus.EMPTY);
        expect(child.executionPayloadRoot).toBe(anchor.latestPayloadRoot);
        expect(child.executionPayloadBlockHash).toBe(anchor.latestBlockHash);
      });

      it("an envelope imported on the anchor creates the FULL variant with the payload root of the bid", () => {
        const {state} = getUpgradedState();
        const anchor = readAnchor(state);
        const forkChoice = initForkChoice(state, forkConfig, isFinalizedState);

        importAnchorPayload(forkChoice, anchor.root);
        expectAnchorFullVariant(forkChoice, anchor);
      });
    });

    describe("gloas anchor", () => {
      const forkConfig = getConfig(ForkName.gloas);
      // A finalized anchor state is at the start of its epoch, an unfinalized one is anywhere
      const anchorSlot = 3 * SLOTS_PER_EPOCH + (isFinalizedState ? 0 : 5);

      it("has PENDING and EMPTY variants on the payload the anchor block builds on", () => {
        const state = generateGloasAnchorState(forkConfig, anchorSlot);
        const anchor = readAnchor(state);
        expect(anchor.bidPayloadRoot).not.toBe(anchor.latestPayloadRoot);

        const forkChoice = initForkChoice(state, forkConfig, isFinalizedState);
        expectAnchorVariants(forkChoice, anchor);
        // The payload of the anchor block is not imported, a block building on it has to wait for it
        expect(forkChoice.getBlockHexAndPayloadRoot(anchor.root, anchor.bidPayloadRoot)).toBeNull();
        expect(forkChoice.getParentPayloadDependency(anchor.root, anchor.bidPayloadRoot)).toBe(
          ParentPayloadDependency.AwaitingPayload
        );
      });

      it("anchor block was FULL: its envelope creates the FULL variant, which the child builds on", () => {
        const state = generateGloasAnchorState(forkConfig, anchorSlot);
        const anchor = readAnchor(state);
        const forkChoice = initForkChoice(state, forkConfig, isFinalizedState);

        // The child names the payload of the anchor block, there is no variant for it without the envelope
        expect(() =>
          importChild(forkChoice, anchor.root, anchorSlot + 1, envelopeBlockHash, anchor.bidPayloadRoot)
        ).toThrow();

        importAnchorPayload(forkChoice, anchor.root);
        expectAnchorFullVariant(forkChoice, anchor);
        expect(forkChoice.getParentPayloadDependency(anchor.root, anchor.bidPayloadRoot)).toBe(
          ParentPayloadDependency.Ready
        );

        const child = importChild(forkChoice, anchor.root, anchorSlot + 1, envelopeBlockHash, anchor.bidPayloadRoot);
        expect(getAttachedParentVariant(forkChoice, child)).toBe(PayloadStatus.FULL);
        expect(child.executionPayloadRoot).toBe(anchor.bidPayloadRoot);
        expect(child.executionPayloadBlockHash).toBe(envelopeBlockHash);
      });

      it("anchor block was EMPTY: the child builds on the EMPTY variant, with or without the envelope", () => {
        for (const withEnvelope of [false, true]) {
          const state = generateGloasAnchorState(forkConfig, anchorSlot);
          const anchor = readAnchor(state);
          const forkChoice = initForkChoice(state, forkConfig, isFinalizedState);
          if (withEnvelope) {
            importAnchorPayload(forkChoice, anchor.root);
            expectAnchorFullVariant(forkChoice, anchor);
          }

          // The child names the payload the anchor block builds on
          const child = importChild(
            forkChoice,
            anchor.root,
            anchorSlot + 1,
            anchor.latestBlockHash,
            anchor.latestPayloadRoot
          );
          expect(getAttachedParentVariant(forkChoice, child)).toBe(PayloadStatus.EMPTY);
          expect(child.executionPayloadRoot).toBe(anchor.latestPayloadRoot);
          expect(child.executionPayloadBlockHash).toBe(anchor.latestBlockHash);
        }
      });
    });
  });

  describe("gloas genesis", () => {
    const forkConfig = getConfig(ForkName.gloas);
    const eth1BlockHash = Buffer.alloc(32, 0xbb);

    function getGenesisState(): BeaconStateView {
      const stateValue = initDevState(forkConfig, 8, {eth1BlockHash}) as BeaconStateGloas;
      return new BeaconStateView(createCachedBeaconStateTest(stateValue, forkConfig));
    }

    it("has PENDING and EMPTY variants on the genesis payload, the genesis bid commits to no payload", () => {
      const state = getGenesisState();
      const anchor = readAnchor(state);
      expect(anchor.slot).toBe(0);
      expect(anchor.latestBlockHash).toBe(toHexString(eth1BlockHash));
      expect(anchor.bidPayloadRoot).toBe(toHexString(Buffer.alloc(32)));
      expect(anchor.latestPayloadRoot).not.toBe(anchor.bidPayloadRoot);

      const forkChoice = initForkChoice(state, forkConfig, true);
      expectAnchorVariants(forkChoice, anchor);
    });

    it("the first block builds on the EMPTY variant", () => {
      const state = getGenesisState();
      const anchor = readAnchor(state);
      const forkChoice = initForkChoice(state, forkConfig, true);

      const child = importChild(forkChoice, anchor.root, 1, anchor.latestBlockHash, anchor.latestPayloadRoot);
      expect(getAttachedParentVariant(forkChoice, child)).toBe(PayloadStatus.EMPTY);
      expect(child.executionPayloadRoot).toBe(anchor.latestPayloadRoot);
      expect(child.executionPayloadBlockHash).toBe(toHexString(eth1BlockHash));
    });

    it("an envelope imported on the anchor creates the FULL variant with the payload root of the bid", () => {
      const state = getGenesisState();
      const anchor = readAnchor(state);
      const forkChoice = initForkChoice(state, forkConfig, true);

      importAnchorPayload(forkChoice, anchor.root);
      expectAnchorFullVariant(forkChoice, anchor);
    });
  });
});

describe("LodestarForkChoice restarted from an unfinalized gloas state", () => {
  const otherPayloadRoot = toHexString(Buffer.alloc(32, 0x33));

  it("marks the ancestors of the head as placeholders, not the head", async () => {
    const {forkChoice, headRoot, parentRoot, justifiedRoot, finalizedRoot} =
      await initForkChoiceFromUnfinalizedGloasState();

    expect(forkChoice.getHead().blockRoot).toBe(headRoot);
    for (const status of [PayloadStatus.PENDING, PayloadStatus.EMPTY]) {
      expect(forkChoice.getBlockHex(headRoot, status)?.isPlaceholder).toBeUndefined();
      for (const root of [parentRoot, justifiedRoot, finalizedRoot]) {
        expect(forkChoice.getBlockHex(root, status)?.isPlaceholder).toBe(true);
      }
    }
  });

  it("the head is a real node: a payload its bid does not name is invalid", async () => {
    const {forkChoice, headRoot, headParentPayloadRoot, headPayloadRoot} =
      await initForkChoiceFromUnfinalizedGloasState();

    expect(forkChoice.getParentPayloadDependency(headRoot, headParentPayloadRoot)).toBe(ParentPayloadDependency.Ready);
    expect(forkChoice.getParentPayloadDependency(headRoot, headPayloadRoot)).toBe(
      ParentPayloadDependency.AwaitingPayload
    );
    expect(forkChoice.getParentPayloadDependency(headRoot, otherPayloadRoot)).toBe(ParentPayloadDependency.Invalid);
  });

  it.each(["parentRoot", "justifiedRoot", "finalizedRoot"] as const)(
    "a block that forks off the placeholder %s is never classified as invalid",
    async (ancestor) => {
      const restarted = await initForkChoiceFromUnfinalizedGloasState();
      const {forkChoice, headParentPayloadRoot, headPayloadRoot} = restarted;
      const ancestorRoot = restarted[ancestor];

      // The placeholder carries the bid fields of the head, the real block has another bid. A valid child of
      // the real block names a payload root which is neither `payloadRoot` nor `parentPayloadRoot` of the node
      expect(forkChoice.getBlockHexDefaultStatus(ancestorRoot)?.payloadRoot).toBe(headPayloadRoot);
      expect(forkChoice.getBlockHexDefaultStatus(ancestorRoot)?.parentPayloadRoot).toBe(headParentPayloadRoot);
      for (const parentPayloadRoot of [otherPayloadRoot, headPayloadRoot]) {
        expect(forkChoice.getBlockHexAndPayloadRoot(ancestorRoot, parentPayloadRoot)).toBeNull();
        expect(forkChoice.getParentPayloadDependency(ancestorRoot, parentPayloadRoot)).toBe(
          ParentPayloadDependency.AwaitingPayload
        );
      }
      // The head builds on the placeholders through the payload it names
      expect(forkChoice.getParentPayloadDependency(ancestorRoot, headParentPayloadRoot)).toBe(
        ParentPayloadDependency.Ready
      );
    }
  );

  it("does not create a FULL variant for a placeholder, its payload root is not the one of the block", async () => {
    const {forkChoice, parentRoot} = await initForkChoiceFromUnfinalizedGloasState();

    expect(() =>
      forkChoice.onExecutionPayload(
        parentRoot,
        toHexString(Buffer.alloc(32, 0xee)),
        9,
        30_000_000,
        ExecutionStatus.Syncing,
        DataAvailabilityStatus.Available
      )
    ).toThrow();
    expect(forkChoice.getBlockHex(parentRoot, PayloadStatus.FULL)).toBeNull();
  });
});
