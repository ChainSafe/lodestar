import {ChainEventEmitter, computeAnchorCheckpoint, LodestarForkChoice} from "../../../../src/chain";
import {generateState} from "../../../utils/state";
import {config} from "@chainsafe/lodestar-config/minimal";
import {Gwei, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {generateSignedBlock} from "../../../utils/block";
import {
  computeEpochAtSlot,
  getTemporaryBlockHeader,
  phase0,
  CachedBeaconState,
  createCachedBeaconState,
  FAR_FUTURE_EPOCH,
} from "@chainsafe/lodestar-beacon-state-transition";
import {expect} from "chai";
import {List} from "@chainsafe/ssz";
import {generateValidators} from "../../../utils/validator";

describe("LodestarForkChoice", function () {
  let forkChoice: LodestarForkChoice;
  const anchorState = generateState(
    {
      slot: 0,
      validators: generateValidators(3, {
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      }),
      balances: Array.from({length: 3}, () => BigInt(0)) as List<Gwei>,
      // Jan 01 2020
      genesisTime: 1577836800,
    },
    config
  );

  let state: CachedBeaconState<phase0.BeaconState>;

  before(() => {
    state = createCachedBeaconState(config, anchorState);
  });

  beforeEach(() => {
    const emitter = new ChainEventEmitter();
    const currentSlot = 0;
    forkChoice = new LodestarForkChoice({
      config,
      emitter,
      currentSlot,
      state,
    });
  });

  describe("forkchoice", function () {
    /**
     * slot 32(checkpoint) - orphaned (36)
     *                     \
     *                       parent (37) - child (38)
     */
    it("getHead - should not consider orphaned block as head", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = config.types.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const targetBlock = generateSignedBlock({message: {slot: 32}});
      targetBlock.message.parentRoot = finalizedRoot;
      //
      const targetState = runStateTransition(anchorState, targetBlock);
      targetBlock.message.stateRoot = config.types.phase0.BeaconState.hashTreeRoot(targetState);
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 36);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 37);
      const {block: childBlock, state: childState} = makeChild({block: parentBlock, state: parentState}, 38);
      const parentBlockHex = config.types.phase0.BeaconBlock.hashTreeRoot(parentBlock.message);
      const orphanedBlockHex = config.types.phase0.BeaconBlock.hashTreeRoot(orphanedBlock.message);
      // forkchoice tie-break condition is based on root hex
      expect(orphanedBlockHex > parentBlockHex).to.be.true;
      forkChoice.updateTime(childBlock.message.slot);
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
      const source: phase0.Checkpoint = {
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
      const finalizedRoot = config.types.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const block08 = generateSignedBlock({message: {slot: 8}});
      block08.message.parentRoot = finalizedRoot;
      const state08 = runStateTransition(anchorState, block08);
      block08.message.stateRoot = config.types.phase0.BeaconState.hashTreeRoot(state08);

      const {block: block12, state: state12} = makeChild({block: block08, state: state08}, 12);
      const {block: block16, state: state16} = makeChild({block: block12, state: state12}, 16);
      state16.currentJustifiedCheckpoint = {
        root: config.types.phase0.BeaconBlock.hashTreeRoot(block08.message),
        epoch: 1,
      };
      const {block: block20, state: state20} = makeChild({block: block16, state: state16}, 20);
      const {block: block24, state: state24} = makeChild({block: block20, state: state20}, 24);
      state24.finalizedCheckpoint = {root: config.types.phase0.BeaconBlock.hashTreeRoot(block08.message), epoch: 1};
      state24.currentJustifiedCheckpoint = {
        root: config.types.phase0.BeaconBlock.hashTreeRoot(block16.message),
        epoch: 2,
      };
      const {block: block28, state: state28} = makeChild({block: block24, state: state24}, 28);
      const {block: block32, state: state32} = makeChild({block: block28, state: state28}, 32);
      state32.finalizedCheckpoint = {root: config.types.phase0.BeaconBlock.hashTreeRoot(block16.message), epoch: 2};
      state32.currentJustifiedCheckpoint = {
        root: config.types.phase0.BeaconBlock.hashTreeRoot(block24.message),
        epoch: 3,
      };
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
        forkChoice.iterateBlockSummaries(config.types.phase0.BeaconBlock.hashTreeRoot(block16.message)).length
      ).to.be.equal(4);
      expect(
        forkChoice.iterateBlockSummaries(config.types.phase0.BeaconBlock.hashTreeRoot(block24.message)).length
      ).to.be.equal(6);
      expect(forkChoice.getBlock(config.types.phase0.BeaconBlock.hashTreeRoot(block08.message))).to.be.not.null;
      expect(forkChoice.getBlock(config.types.phase0.BeaconBlock.hashTreeRoot(block12.message))).to.be.not.null;
      expect(forkChoice.hasBlock(config.types.phase0.BeaconBlock.hashTreeRoot(block08.message))).to.be.true;
      expect(forkChoice.hasBlock(config.types.phase0.BeaconBlock.hashTreeRoot(block12.message))).to.be.true;
      forkChoice.onBlock(block32.message, state32, justifiedBalances);
      forkChoice.prune(config.types.phase0.BeaconBlock.hashTreeRoot(block16.message));
      expect(
        forkChoice.iterateBlockSummaries(config.types.phase0.BeaconBlock.hashTreeRoot(block16.message)).length
      ).to.be.equal(1);
      expect(
        forkChoice.iterateBlockSummaries(config.types.phase0.BeaconBlock.hashTreeRoot(block24.message)).length
      ).to.be.equal(3);
      expect(forkChoice.getBlock(config.types.phase0.BeaconBlock.hashTreeRoot(block08.message))).to.be.null;
      expect(forkChoice.getBlock(config.types.phase0.BeaconBlock.hashTreeRoot(block12.message))).to.be.null;
      expect(forkChoice.hasBlock(config.types.phase0.BeaconBlock.hashTreeRoot(block08.message))).to.be.false;
      expect(forkChoice.hasBlock(config.types.phase0.BeaconBlock.hashTreeRoot(block12.message))).to.be.false;
    });

    /**
     * slot 32(checkpoint) - orphaned (33)
     *                     \
     *                       parent (34) - child (35)
     */
    it("iterateNonAncestors - should get non ancestor nodes", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = config.types.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const targetBlock = generateSignedBlock({message: {slot: 32}});
      targetBlock.message.parentRoot = finalizedRoot;
      const targetState = runStateTransition(anchorState, targetBlock);
      targetBlock.message.stateRoot = config.types.phase0.BeaconState.hashTreeRoot(targetState);
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
      const childBlockRoot = config.types.phase0.BeaconBlock.hashTreeRoot(childBlock.message);
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
function runStateTransition(preState: phase0.BeaconState, signedBlock: phase0.SignedBeaconBlock): phase0.BeaconState {
  // Clone state because process slots and block are not pure
  const postState = config.types.phase0.BeaconState.clone(preState);
  // Process slots (including those with no blocks) since block
  phase0.processSlots(config, postState, signedBlock.message.slot);
  // processBlock
  postState.latestBlockHeader = getTemporaryBlockHeader(config, signedBlock.message);
  return config.types.phase0.BeaconState.clone(postState);
}

// create a child block/state from a parent block/state and a provided slot
function makeChild(
  parent: {block: phase0.SignedBeaconBlock; state: phase0.BeaconState},
  slot: Slot
): {block: phase0.SignedBeaconBlock; state: phase0.BeaconState} {
  const childBlock = generateSignedBlock({message: {slot}});
  const parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(parent.block.message);
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
    attestingIndices: [validatorIndex] as List<number>,
    data: {
      slot: block.message.slot,
      index: 0,
      beaconBlockRoot: config.types.phase0.BeaconBlock.hashTreeRoot(block.message),
      source,
      target: createCheckpoint(target),
    },
    signature: Buffer.alloc(96),
  };
}

function createCheckpoint(block: phase0.SignedBeaconBlock): phase0.Checkpoint {
  return {
    root: config.types.phase0.BeaconBlock.hashTreeRoot(block.message),
    epoch: computeEpochAtSlot(config, block.message.slot),
  };
}
