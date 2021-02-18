import {ChainEventEmitter, computeAnchorCheckpoint, LodestarForkChoice} from "../../../../src/chain";
import {generateState} from "../../../utils/state";
import {config} from "@chainsafe/lodestar-config/minimal";
import {
  BeaconState,
  Checkpoint,
  IndexedAttestation,
  SignedBeaconBlock,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {generateSignedBlock} from "../../../utils/block";
import {computeEpochAtSlot, getTemporaryBlockHeader, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {expect} from "chai";
import {List} from "@chainsafe/ssz";

describe("LodestarForkChoice", function () {
  let forkChoice: LodestarForkChoice;
  const anchorState = generateState();
  // Jan 01 2020
  anchorState.genesisTime = 1577836800;

  beforeEach(() => {
    const emitter = new ChainEventEmitter();
    const currentSlot = 0;
    forkChoice = new LodestarForkChoice({config, emitter, currentSlot, anchorState});
  });

  describe("forkchoice", function () {
    /**
     * slot 32(checkpoint) - orphaned (33)
     *                     \
     *                       parent (34) - child (35)
     */
    it("getHead - should not consider orphaned block as head", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = config.types.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const targetBlock = generateSignedBlock({message: {slot: 32}});
      targetBlock.message.parentRoot = finalizedRoot;
      const targetState = runStateTransition(anchorState, targetBlock);
      targetBlock.message.stateRoot = config.types.BeaconState.hashTreeRoot(targetState);
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 33);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 34);
      const {block: childBlock, state: childState} = makeChild({block: parentBlock, state: parentState}, 35);
      const parentBlockHex = config.types.BeaconBlock.hashTreeRoot(parentBlock.message);
      const orphanedBlockHex = config.types.BeaconBlock.hashTreeRoot(orphanedBlock.message);
      // forkchoice tie-break condition is based on root hex
      expect(orphanedBlockHex > parentBlockHex).to.be.true;
      forkChoice.updateTime(35);
      // 3 validators involved
      const justifiedBalances = [BigInt(1), BigInt(2), BigInt(3)];
      forkChoice.onBlock(targetBlock.message, targetState, justifiedBalances);
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
      const source: Checkpoint = {
        root: finalizedRoot,
        epoch: computeEpochAtSlot(config, blockHeader.slot),
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
      const finalizedRoot = config.types.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const block08 = generateSignedBlock({message: {slot: 8}});
      block08.message.parentRoot = finalizedRoot;
      const state08 = runStateTransition(anchorState, block08);
      block08.message.stateRoot = config.types.BeaconState.hashTreeRoot(state08);

      const {block: block12, state: state12} = makeChild({block: block08, state: state08}, 12);
      const {block: block16, state: state16} = makeChild({block: block12, state: state12}, 16);
      state16.currentJustifiedCheckpoint = {root: config.types.BeaconBlock.hashTreeRoot(block08.message), epoch: 1};
      const {block: block20, state: state20} = makeChild({block: block16, state: state16}, 20);
      const {block: block24, state: state24} = makeChild({block: block20, state: state20}, 24);
      state24.finalizedCheckpoint = {root: config.types.BeaconBlock.hashTreeRoot(block08.message), epoch: 1};
      state24.currentJustifiedCheckpoint = {root: config.types.BeaconBlock.hashTreeRoot(block16.message), epoch: 2};
      const {block: block28, state: state28} = makeChild({block: block24, state: state24}, 28);
      const {block: block32, state: state32} = makeChild({block: block28, state: state28}, 32);
      state32.finalizedCheckpoint = {root: config.types.BeaconBlock.hashTreeRoot(block16.message), epoch: 2};
      state32.currentJustifiedCheckpoint = {root: config.types.BeaconBlock.hashTreeRoot(block24.message), epoch: 3};
      forkChoice.updateTime(128);
      // 3 validators involved
      const justifiedBalances = [BigInt(1), BigInt(2), BigInt(3)];
      forkChoice.onBlock(block08.message, state08, justifiedBalances);
      forkChoice.onBlock(block12.message, state12, justifiedBalances);
      forkChoice.onBlock(block16.message, state16, justifiedBalances);
      forkChoice.onBlock(block20.message, state20, justifiedBalances);
      forkChoice.onBlock(block24.message, state24, justifiedBalances);
      forkChoice.onBlock(block28.message, state28, justifiedBalances);
      expect(
        forkChoice.iterateBlockSummaries(config.types.BeaconBlock.hashTreeRoot(block16.message)).length
      ).to.be.equal(4);
      expect(
        forkChoice.iterateBlockSummaries(config.types.BeaconBlock.hashTreeRoot(block24.message)).length
      ).to.be.equal(6);
      expect(forkChoice.getBlock(config.types.BeaconBlock.hashTreeRoot(block08.message))).to.be.not.null;
      expect(forkChoice.getBlock(config.types.BeaconBlock.hashTreeRoot(block12.message))).to.be.not.null;
      expect(forkChoice.hasBlock(config.types.BeaconBlock.hashTreeRoot(block08.message))).to.be.true;
      expect(forkChoice.hasBlock(config.types.BeaconBlock.hashTreeRoot(block12.message))).to.be.true;
      forkChoice.onBlock(block32.message, state32, justifiedBalances);
      forkChoice.prune(config.types.BeaconBlock.hashTreeRoot(block16.message));
      expect(
        forkChoice.iterateBlockSummaries(config.types.BeaconBlock.hashTreeRoot(block16.message)).length
      ).to.be.equal(1);
      expect(
        forkChoice.iterateBlockSummaries(config.types.BeaconBlock.hashTreeRoot(block24.message)).length
      ).to.be.equal(3);
      expect(forkChoice.getBlock(config.types.BeaconBlock.hashTreeRoot(block08.message))).to.be.null;
      expect(forkChoice.getBlock(config.types.BeaconBlock.hashTreeRoot(block12.message))).to.be.null;
      expect(forkChoice.hasBlock(config.types.BeaconBlock.hashTreeRoot(block08.message))).to.be.false;
      expect(forkChoice.hasBlock(config.types.BeaconBlock.hashTreeRoot(block12.message))).to.be.false;
    });

    /**
     * slot 32(checkpoint) - orphaned (33)
     *                     \
     *                       parent (34) - child (35)
     */
    it("iterateNonAncestors - should get non ancestor nodes", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = config.types.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const targetBlock = generateSignedBlock({message: {slot: 32}});
      targetBlock.message.parentRoot = finalizedRoot;
      const targetState = runStateTransition(anchorState, targetBlock);
      targetBlock.message.stateRoot = config.types.BeaconState.hashTreeRoot(targetState);
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 33);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 34);
      const {block: childBlock, state: childState} = makeChild({block: parentBlock, state: parentState}, 35);
      forkChoice.updateTime(35);
      // 3 validators involved
      const justifiedBalances = [BigInt(1), BigInt(2), BigInt(3)];
      forkChoice.onBlock(targetBlock.message, targetState, justifiedBalances);
      forkChoice.onBlock(orphanedBlock.message, orphanedState);
      forkChoice.onBlock(parentBlock.message, parentState);
      forkChoice.onBlock(childBlock.message, childState);
      const childBlockRoot = config.types.BeaconBlock.hashTreeRoot(childBlock.message);
      // the old way to get non canonical blocks
      const nonCanonicalSummaries = forkChoice
        .forwardIterateBlockSummaries()
        .filter(
          (summary) =>
            summary.slot < childBlock.message.slot && !forkChoice.isDescendant(summary.blockRoot, childBlockRoot)
        );
      // compare to iterateNonAncestors api
      expect(forkChoice.iterateNonAncestors(childBlockRoot)).to.be.deep.equal(nonCanonicalSummaries);
    });
  });
});

// lightweight state transtion function for this test
function runStateTransition(preState: BeaconState, signedBlock: SignedBeaconBlock): BeaconState {
  // Clone state because process slots and block are not pure
  const postState = config.types.BeaconState.clone(preState);
  // Process slots (including those with no blocks) since block
  phase0.processSlots(config, postState, signedBlock.message.slot);
  // processBlock
  postState.latestBlockHeader = getTemporaryBlockHeader(config, signedBlock.message);
  return config.types.BeaconState.clone(postState);
}

// create a child block/state from a parent block/state and a provided slot
function makeChild(
  parent: {block: SignedBeaconBlock; state: BeaconState},
  slot: Slot
): {block: SignedBeaconBlock; state: BeaconState} {
  const childBlock = generateSignedBlock({message: {slot}});
  const parentRoot = config.types.BeaconBlock.hashTreeRoot(parent.block.message);
  childBlock.message.parentRoot = parentRoot;
  const childState = runStateTransition(parent.state, childBlock);
  return {block: childBlock, state: childState};
}

function createIndexedAttestation(
  source: Checkpoint,
  target: SignedBeaconBlock,
  block: SignedBeaconBlock,
  validatorIndex: ValidatorIndex
): IndexedAttestation {
  return {
    attestingIndices: [validatorIndex] as List<number>,
    data: {
      slot: block.message.slot,
      index: 0,
      beaconBlockRoot: config.types.BeaconBlock.hashTreeRoot(block.message),
      source,
      target: createCheckpoint(target),
    },
    signature: Buffer.alloc(96),
  };
}

function createCheckpoint(block: SignedBeaconBlock): Checkpoint {
  return {
    root: config.types.BeaconBlock.hashTreeRoot(block.message),
    epoch: computeEpochAtSlot(config, block.message.slot),
  };
}
