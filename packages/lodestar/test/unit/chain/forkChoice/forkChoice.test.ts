import {ChainEventEmitter, computeAnchorCheckpoint, initializeForkChoice} from "../../../../src/chain";
import {generateState} from "../../../utils/state";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";
import {config} from "@chainsafe/lodestar-config/default";
import {Slot, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {generateSignedBlock} from "../../../utils/block";
import {
  allForks,
  computeEpochAtSlot,
  getTemporaryBlockHeader,
  phase0,
  CachedBeaconStateAllForks,
  createCachedBeaconState,
  getEffectiveBalanceIncrementsZeroed,
} from "@chainsafe/lodestar-beacon-state-transition";
import {expect} from "chai";
import {List, toHexString, TreeBacked} from "@chainsafe/ssz";
import {generateValidators} from "../../../utils/validator";

describe("LodestarForkChoice", function () {
  let forkChoice: ForkChoice;
  const anchorState = generateState(
    {
      slot: 0,
      validators: generateValidators(3, {
        effectiveBalance: MAX_EFFECTIVE_BALANCE,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      }),
      balances: Array.from({length: 3}, () => 0) as List<number>,
      // Jan 01 2020
      genesisTime: 1577836800,
    },
    config
  );

  // 3 validators involved
  const justifiedBalances = getEffectiveBalanceIncrementsZeroed(3);
  justifiedBalances[0] = 1;
  justifiedBalances[1] = 2;
  justifiedBalances[2] = 3;

  const hashBlock = (block: phase0.BeaconBlock): string => toHexString(ssz.phase0.BeaconBlock.hashTreeRoot(block));

  let state: CachedBeaconStateAllForks;

  before(() => {
    state = createCachedBeaconState(config, anchorState);
  });

  beforeEach(() => {
    const emitter = new ChainEventEmitter();
    const currentSlot = 40;
    forkChoice = initializeForkChoice(config, emitter, currentSlot, state, false);
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
      const targetBlock = generateSignedBlock({message: {slot: 32}});
      targetBlock.message.parentRoot = finalizedRoot;
      //
      const targetState = runStateTransition(anchorState, targetBlock);
      targetBlock.message.stateRoot = config.getForkTypes(targetState.slot).BeaconState.hashTreeRoot(targetState);
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 36);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 37);
      const {block: childBlock, state: childState} = makeChild({block: parentBlock, state: parentState}, 38);
      const parentBlockHex = ssz.phase0.BeaconBlock.hashTreeRoot(parentBlock.message);
      const orphanedBlockHex = ssz.phase0.BeaconBlock.hashTreeRoot(orphanedBlock.message);
      // forkchoice tie-break condition is based on root hex
      expect(orphanedBlockHex > parentBlockHex).to.be.true;
      forkChoice.updateTime(childBlock.message.slot);

      forkChoice.onBlock(targetBlock.message, targetState, {justifiedBalances, blockDelaySec: 0});
      forkChoice.onBlock(orphanedBlock.message, orphanedState);
      let head = forkChoice.getHead();
      expect(head.slot).to.be.equal(orphanedBlock.message.slot);
      forkChoice.onBlock(parentBlock.message, parentState);
      // tie break condition causes head to be orphaned block (based on hex root comparison)
      head = forkChoice.getHead();
      expect(head.slot).to.be.equal(orphanedBlock.message.slot);
      forkChoice.onBlock(childBlock.message, childState);
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
      const block08 = generateSignedBlock({message: {slot: 8}});
      block08.message.parentRoot = finalizedRoot;
      const state08 = runStateTransition(anchorState, block08);
      block08.message.stateRoot = config.getForkTypes(state08.slot).BeaconState.hashTreeRoot(state08);

      const {block: block12, state: state12} = makeChild({block: block08, state: state08}, 12);
      const {block: block16, state: state16} = makeChild({block: block12, state: state12}, 16);
      state16.currentJustifiedCheckpoint = {
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block08.message),
        epoch: 1,
      };
      const {block: block20, state: state20} = makeChild({block: block16, state: state16}, 20);
      const {block: block24, state: state24} = makeChild({block: block20, state: state20}, 24);
      state24.finalizedCheckpoint = {root: ssz.phase0.BeaconBlock.hashTreeRoot(block08.message), epoch: 1};
      state24.currentJustifiedCheckpoint = {
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block16.message),
        epoch: 2,
      };
      const {block: block28, state: state28} = makeChild({block: block24, state: state24}, 28);
      const {block: block32, state: state32} = makeChild({block: block28, state: state28}, 32);
      state32.finalizedCheckpoint = {root: ssz.phase0.BeaconBlock.hashTreeRoot(block16.message), epoch: 2};
      state32.currentJustifiedCheckpoint = {
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block24.message),
        epoch: 3,
      };
      forkChoice.updateTime(128);

      forkChoice.onBlock(block08.message, state08, {justifiedBalances, blockDelaySec: 0});
      forkChoice.onBlock(block12.message, state12, {justifiedBalances, blockDelaySec: 0});
      forkChoice.onBlock(block16.message, state16, {justifiedBalances, blockDelaySec: 0});
      forkChoice.onBlock(block20.message, state20, {justifiedBalances, blockDelaySec: 0});
      forkChoice.onBlock(block24.message, state24, {justifiedBalances, blockDelaySec: 0});
      forkChoice.onBlock(block28.message, state28, {justifiedBalances, blockDelaySec: 0});
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
      expect(forkChoice.hasBlockHex(hashBlock(block08.message))).to.be.true;
      expect(forkChoice.hasBlockHex(hashBlock(block12.message))).to.be.true;
      forkChoice.onBlock(block32.message, state32, {justifiedBalances, blockDelaySec: 0});
      forkChoice.prune(hashBlock(block16.message));
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block16.message)).length).to.be.equal(
        0,
        "getAllAncestorBlocks should not return finalized block"
      );
      expect(forkChoice.getAllAncestorBlocks(hashBlock(block24.message)).length).to.be.equal(
        2,
        "getAllAncestorBlocks should return 2 blocks"
      );
      expect(forkChoice.getBlockHex(hashBlock(block08.message))).to.be.null;
      expect(forkChoice.getBlockHex(hashBlock(block12.message))).to.be.null;
      expect(forkChoice.hasBlockHex(hashBlock(block08.message))).to.be.false;
      expect(forkChoice.hasBlockHex(hashBlock(block12.message))).to.be.false;
    });

    /**
     * slot 32(checkpoint) - orphaned (33)
     *                     \
     *                       parent (34) - child (35)
     */
    it("getAllNonAncestorBlocks - should get non ancestor nodes", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const targetBlock = generateSignedBlock({message: {slot: 32}});
      targetBlock.message.parentRoot = finalizedRoot;
      const targetState = runStateTransition(anchorState, targetBlock);
      targetBlock.message.stateRoot = config.getForkTypes(targetState.slot).BeaconState.hashTreeRoot(targetState);
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 33);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 34);
      const {block: childBlock, state: childState} = makeChild({block: parentBlock, state: parentState}, 35);
      forkChoice.updateTime(35);

      forkChoice.onBlock(targetBlock.message, targetState, {justifiedBalances, blockDelaySec: 0});
      forkChoice.onBlock(orphanedBlock.message, orphanedState);
      forkChoice.onBlock(parentBlock.message, parentState);
      forkChoice.onBlock(childBlock.message, childState);
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
  });
});

// lightweight state transtion function for this test
function runStateTransition(
  preState: TreeBacked<allForks.BeaconState>,
  signedBlock: phase0.SignedBeaconBlock
): TreeBacked<allForks.BeaconState> {
  // Clone state because process slots and block are not pure
  const postState = preState.clone();
  // Process slots (including those with no blocks) since block
  allForks.processSlots(createCachedBeaconState(config, postState), signedBlock.message.slot);
  // processBlock
  postState.latestBlockHeader = getTemporaryBlockHeader(config, signedBlock.message);
  return postState;
}

// create a child block/state from a parent block/state and a provided slot
function makeChild(
  parent: {block: phase0.SignedBeaconBlock; state: TreeBacked<allForks.BeaconState>},
  slot: Slot
): {block: phase0.SignedBeaconBlock; state: TreeBacked<allForks.BeaconState>} {
  const childBlock = generateSignedBlock({message: {slot}});
  const parentRoot = ssz.phase0.BeaconBlock.hashTreeRoot(parent.block.message);
  childBlock.message.parentRoot = parentRoot;
  const childState = runStateTransition(parent.state, childBlock);
  return {block: childBlock, state: childState};
}

export function createIndexedAttestation(
  source: phase0.Checkpoint,
  target: phase0.SignedBeaconBlock,
  block: phase0.SignedBeaconBlock,
  validatorIndex: ValidatorIndex
): phase0.IndexedAttestation {
  return {
    attestingIndices: [validatorIndex] as List<number>,
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
