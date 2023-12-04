import {EpochDifference, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {Epoch, RootHex} from "@lodestar/types";

/**
 * Get dependent root of a shuffling given attestation epoch and head block.
 */
export function getShufflingDependentRoot(
  forkChoice: IForkChoice,
  attEpoch: Epoch,
  blockEpoch: Epoch,
  attHeadBlock: ProtoBlock
): RootHex {
  let shufflingDependentRoot: RootHex;
  if (blockEpoch === attEpoch) {
    // current shuffling, this is equivalent to `headState.currentShuffling`
    // given blockEpoch = attEpoch = n
    //        epoch:       (n-2)   (n-1)     n     (n+1)
    //               |-------|-------|-------|-------|
    // attHeadBlock     ------------------------^
    // shufflingDependentRoot ------^
    shufflingDependentRoot = forkChoice.getDependentRoot(attHeadBlock, EpochDifference.previous);
  } else if (blockEpoch === attEpoch - 1) {
    // next shuffling, this is equivalent to `headState.nextShuffling`
    // given blockEpoch = n-1, attEpoch = n
    //        epoch:       (n-2)   (n-1)     n     (n+1)
    //               |-------|-------|-------|-------|
    // attHeadBlock     -------------------^
    // shufflingDependentRoot ------^
    shufflingDependentRoot = forkChoice.getDependentRoot(attHeadBlock, EpochDifference.current);
  } else if (blockEpoch < attEpoch - 1) {
    // this never happens with default chain option of maxSkipSlots = 32, however we still need to handle it
    // check the verifyHeadBlockAndTargetRoot() function above
    // given blockEpoch = n-2, attEpoch = n
    //        epoch:       (n-2)   (n-1)     n     (n+1)
    //               |-------|-------|-------|-------|
    // attHeadBlock     -----------^
    // shufflingDependentRoot -----^
    shufflingDependentRoot = attHeadBlock.blockRoot;
    // use lodestar_gossip_attestation_head_slot_to_attestation_slot metric to track this case
  } else {
    // blockEpoch > attEpoch
    // should not happen, handled in verifyAttestationTargetRoot
    throw Error(`attestation epoch ${attEpoch} is before head block epoch ${blockEpoch}`);
  }

  return shufflingDependentRoot;
}
