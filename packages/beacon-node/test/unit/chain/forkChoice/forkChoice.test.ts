import {expect} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {CheckpointWithHex, ExecutionStatus, ForkChoice} from "@lodestar/fork-choice";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  getEffectiveBalanceIncrementsZeroed,
} from "@lodestar/state-transition";
import {phase0, Slot, ssz, ValidatorIndex} from "@lodestar/types";
import {getTemporaryBlockHeader, processSlots} from "@lodestar/state-transition";
import {ChainEventEmitter, computeAnchorCheckpoint, initializeForkChoice} from "../../../../src/chain/index.js";
import {generateSignedBlockAtSlot} from "../../../utils/typeGenerator.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {generateState} from "../../../utils/state.js";
import {generateValidators} from "../../../utils/validator.js";

describe("LodestarForkChoice", function () {
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

  // 3 validators involved
  const justifiedBalances = getEffectiveBalanceIncrementsZeroed(3);
  justifiedBalances[0] = 1;
  justifiedBalances[1] = 2;
  justifiedBalances[2] = 3;
  const executionStatus = ExecutionStatus.PreMerge;
  const blockDelaySec = 0;

  const hashBlock = (block: phase0.BeaconBlock): string => toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(block));

  let state: CachedBeaconStateAllForks;

  before(() => {
    state = createCachedBeaconStateTest(anchorState, config);
  });

  beforeEach(() => {
    const emitter = new ChainEventEmitter();
    const currentSlot = 16;
    forkChoice = initializeForkChoice(
      config,
      emitter,
      currentSlot,
      state,
      {},
      (_: CheckpointWithHex) => justifiedBalances
    );
  });

  describe("forkchoice", function () {
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
      const targetState = runStateTransition(anchorState, targetBlock);
      targetBlock.message.stateRoot = targetState.hashTreeRoot();
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 36);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 37);
      const {block: childBlock, state: childState} = makeChild({block: parentBlock, state: parentState}, 38);
      const parentBlockHex = ssz.phase0.BeaconBlock.hashTreeRoot(parentBlock.message);
      const orphanedBlockHex = ssz.phase0.BeaconBlock.hashTreeRoot(orphanedBlock.message);
      // forkchoice tie-break condition is based on root hex
      // eslint-disable-next-line chai-expect/no-inner-compare
      expect(orphanedBlockHex > parentBlockHex).to.equal(true);
      const currentSlot = childBlock.message.slot;
      forkChoice.updateTime(currentSlot);

      forkChoice.onBlock(targetBlock.message, targetState, blockDelaySec, currentSlot, executionStatus);
      forkChoice.onBlock(orphanedBlock.message, orphanedState, blockDelaySec, currentSlot, executionStatus);
      let head = forkChoice.getHead();
      expect(head.slot).to.be.equal(orphanedBlock.message.slot);
      forkChoice.onBlock(parentBlock.message, parentState, blockDelaySec, currentSlot, executionStatus);
      // tie break condition causes head to be orphaned block (based on hex root comparison)
      head = forkChoice.getHead();
      expect(head.slot).to.be.equal(orphanedBlock.message.slot);
      forkChoice.onBlock(childBlock.message, childState, blockDelaySec, currentSlot, executionStatus);
      head = forkChoice.getHead();
      // without vote, head gets stuck at orphaned block
      expect(head.slot).to.be.equal(orphanedBlock.message.slot);
      const source: phase0.Checkpoint = {
        root: finalizedRoot,
        epoch: computeEpochAtSlot(blockHeader.slot),
      };
      const attestation0 = createIndexedAttestation(source, targetBlock, orphanedBlock, 0);
      const attestation1 = createIndexedAttestation(source, targetBlock, parentBlock, 1);
      const attestation2 = createIndexedAttestation(source, targetBlock, childBlock, 2);
      forkChoice.onAttestation(attestation0);
      forkChoice.onAttestation(attestation1);
      forkChoice.onAttestation(attestation2);
      head = forkChoice.getHead();
      // with votes, head becomes the child block
      expect(head.slot).to.be.equal(childBlock.message.slot);
    });

    /**
     * finalized - slot 8 (finalized 1) - slot 12 - slot 16 (finalized 2) - slot 20 - slot 24 (finalized 3) - slot 28 - slot 32 (finalized 4)
     */
    it("prune - should prune old blocks", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const block08 = generateSignedBlockAtSlot(8);
      block08.message.parentRoot = finalizedRoot;
      const state08 = runStateTransition(anchorState, block08);
      block08.message.stateRoot = state08.hashTreeRoot();

      const {block: block12, state: state12} = makeChild({block: block08, state: state08}, 12);
      const {block: block16, state: state16} = makeChild({block: block12, state: state12}, 16);
      state16.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block08.message),
        epoch: 1,
      });
      const {block: block20, state: state20} = makeChild({block: block16, state: state16}, 20);
      const {block: block24, state: state24} = makeChild({block: block20, state: state20}, 24);
      state24.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block08.message),
        epoch: 1,
      });
      state24.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block16.message),
        epoch: 2,
      });
      const {block: block28, state: state28} = makeChild({block: block24, state: state24}, 28);
      const {block: block32, state: state32} = makeChild({block: block28, state: state28}, 32);
      state32.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block16.message),
        epoch: 2,
      });
      state32.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block24.message),
        epoch: 3,
      });
      const currentSlot = 128;
      forkChoice.updateTime(currentSlot);

      forkChoice.onBlock(block08.message, state08, blockDelaySec, currentSlot, executionStatus);
      forkChoice.onBlock(block12.message, state12, blockDelaySec, currentSlot, executionStatus);
      forkChoice.onBlock(block16.message, state16, blockDelaySec, currentSlot, executionStatus);
      forkChoice.onBlock(block20.message, state20, blockDelaySec, currentSlot, executionStatus);
      forkChoice.onBlock(block24.message, state24, blockDelaySec, currentSlot, executionStatus);
      forkChoice.onBlock(block28.message, state28, blockDelaySec, currentSlot, executionStatus);
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block16.message)).length).to.be.equal(
        3,
        "getAllAncestorBlocks should return 3 blocks"
      );
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block24.message)).length).to.be.equal(
        5,
        "getAllAncestorBlocks should return 5 blocks"
      );
      expect(forkChoice.getBlockHex(hashBlock(block08.message))).to.be.not.null;
      expect(forkChoice.getBlockHex(hashBlock(block12.message))).to.be.not.null;
      expect(forkChoice.hasBlockHex(hashBlock(block08.message))).to.equal(true);
      expect(forkChoice.hasBlockHex(hashBlock(block12.message))).to.equal(true);
      forkChoice.onBlock(block32.message, state32, blockDelaySec, currentSlot, executionStatus);
      forkChoice.prune(hashBlock(block16.message));
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block16.message)).length).to.be.equal(
        0,
        "getAllAncestorBlocks should not return finalized block"
      );
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block24.message)).length).to.be.equal(
        2,
        "getAllAncestorBlocks should return 2 blocks"
      );
      expect(forkChoice.getBlockHex(hashBlock(block08.message))).to.equal(null);
      expect(forkChoice.getBlockHex(hashBlock(block12.message))).to.equal(null);
      expect(forkChoice.hasBlockHex(hashBlock(block08.message))).to.equal(false);
      expect(forkChoice.hasBlockHex(hashBlock(block12.message))).to.equal(false);
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
      const targetState = runStateTransition(anchorState, targetBlock);
      targetBlock.message.stateRoot = targetState.hashTreeRoot();
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 33);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 34);
      const currentSlot = 35;
      const {block: childBlock, state: childState} = makeChild({block: parentBlock, state: parentState}, currentSlot);
      forkChoice.updateTime(currentSlot);
      forkChoice.onBlock(targetBlock.message, targetState, blockDelaySec, currentSlot, executionStatus);
      forkChoice.onBlock(orphanedBlock.message, orphanedState, blockDelaySec, currentSlot, executionStatus);
      forkChoice.onBlock(parentBlock.message, parentState, blockDelaySec, currentSlot, executionStatus);
      forkChoice.onBlock(childBlock.message, childState, blockDelaySec, currentSlot, executionStatus);
      const childBlockRoot = toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(childBlock.message));
      // the old way to get non canonical blocks
      const nonCanonicalSummaries = forkChoice
        .forwarditerateAncestorBlocks()
        .filter(
          (summary) =>
            summary.slot < childBlock.message.slot && !forkChoice.isDescendant(summary.blockRoot, childBlockRoot)
        );
      // compare to getAllNonAncestorBlocks api
      expect(forkChoice.getAllNonAncestorBlocks(childBlockRoot)).to.be.deep.equal(nonCanonicalSummaries);
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
      const blockDelaySec = 0;
      // C9 is the justified/finalized block
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      // C10
      const blockW = generateSignedBlockAtSlot(8);
      blockW.message.parentRoot = finalizedRoot;
      const stateW = runStateTransition(anchorState, blockW);
      blockW.message.stateRoot = stateW.hashTreeRoot();
      forkChoice.onBlock(blockW.message, stateW, blockDelaySec, blockW.message.slot, executionStatus);

      // X
      const {block: blockX, state: stateX} = makeChild({block: blockW, state: stateW}, 12);
      stateX.blockRoots.set(blockW.message.slot, ssz.phase0.BeaconBlock.hashTreeRoot(blockW.message));
      forkChoice.onBlock(blockX.message, stateX, blockDelaySec, blockX.message.slot, executionStatus);

      // Y, same epoch to X
      const {block: blockY, state: stateY} = makeChild({block: blockX, state: stateX}, 13);
      stateY.blockRoots.set(blockW.message.slot, ssz.phase0.BeaconBlock.hashTreeRoot(blockW.message));
      forkChoice.onBlock(blockY.message, stateY, blockDelaySec, blockY.message.slot, executionStatus);

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
        forkChoice.onAttestation(attestation);
      }

      // Z stays on next epoch, a child of X which potentially reorg Y
      const {block: blockZ, state: stateZ} = makeChild({block: blockX, state: stateX}, 16);
      // without unrealized checkpoints, Y would be filtered due to different justified checkpoint
      stateZ.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
        root: ssz.phase0.BeaconBlock.hashTreeRoot(blockW.message),
        epoch: computeEpochAtSlot(blockW.message.slot),
      });
      forkChoice.updateTime(blockZ.message.slot);
      forkChoice.onBlock(blockZ.message, stateZ, blockDelaySec, blockZ.message.slot, executionStatus);

      const head = forkChoice.updateHead();
      expect(head.blockRoot).to.be.equal(
        toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(blockY.message)),
        "blockY should be new head as it's a potential head and has same unrealized justified checkpoints & more attestations"
      );
    });
  });
});

// lightweight state transtion function for this test
function runStateTransition(
  preState: CachedBeaconStateAllForks,
  signedBlock: phase0.SignedBeaconBlock
): CachedBeaconStateAllForks {
  // Clone state because process slots and block are not pure
  const postState = preState.clone();
  // Process slots (including those with no blocks) since block
  processSlots(postState, signedBlock.message.slot);
  // processBlock
  postState.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU(
    getTemporaryBlockHeader(config, signedBlock.message)
  );
  return postState;
}

// create a child block/state from a parent block/state and a provided slot
function makeChild(
  parent: {block: phase0.SignedBeaconBlock; state: CachedBeaconStateAllForks},
  slot: Slot
): {block: phase0.SignedBeaconBlock; state: CachedBeaconStateAllForks} {
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
): phase0.IndexedAttestation {
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
