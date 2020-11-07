import {ChainEventEmitter, computeAnchorCheckpoint, LodestarForkChoice} from "../../../../src/chain";
import {generateState} from "../../../utils/state";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {
  BeaconState,
  Checkpoint,
  IndexedAttestation,
  SignedBeaconBlock,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {generateSignedBlock} from "../../../utils/block";
import {computeEpochAtSlot, getTemporaryBlockHeader, processSlots} from "@chainsafe/lodestar-beacon-state-transition";
import {expect} from "chai";
import {List} from "@chainsafe/ssz";

describe("LodestarForkChoice", function () {
  let forkChoice: LodestarForkChoice;
  const anchorState = generateState();
  // Jan 01 2020
  anchorState.genesisTime = 157783680;

  beforeEach(() => {
    const emitter = new ChainEventEmitter();
    const currentSlot = 0;
    forkChoice = new LodestarForkChoice({config, emitter, currentSlot, anchorState});
  });

  describe("getHead", function () {
    /**
     * slot 32(checkpoint) - orphaned (34)
     *                     \
     *                       parent (33) - child (35)
     */
    it("should not consider orphaned block as head", () => {
      const {blockHeader} = computeAnchorCheckpoint(config, anchorState);
      const finalizedRoot = config.types.BeaconBlockHeader.hashTreeRoot(blockHeader);
      const targetBlock = generateSignedBlock({message: {slot: 32}});
      targetBlock.message.parentRoot = finalizedRoot;
      const targetState = runStateTransition(anchorState, targetBlock);
      targetBlock.message.stateRoot = config.types.BeaconState.hashTreeRoot(targetState);
      const {block: parentBlock, state: parentState} = makeChild({block: targetBlock, state: targetState}, 33);
      const {block: orphanedBlock, state: orphanedState} = makeChild({block: targetBlock, state: targetState}, 34);
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
  });
});

// lightweight state transtion function for this test
function runStateTransition(preState: BeaconState, signedBlock: SignedBeaconBlock): BeaconState {
  // Clone state because process slots and block are not pure
  const postState = config.types.BeaconState.clone(preState);
  // Process slots (including those with no blocks) since block
  processSlots(config, postState, signedBlock.message.slot);
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
