import {EpochDifference, IForkChoiceRead, ProtoBlock} from "@lodestar/fork-choice";
import {Epoch, RootHex} from "@lodestar/types";

/**
 * Get dependent root of a shuffling given a message epoch and a proto block.
 *
 * Pre-gloas, this is used for attestation validation
 * Post-gloas, this is also used for execution_payload_bid validation because post-fulu,
 * a dependent root of a proposal duties is 1-epoch look ahead (instead of 0 as of pre-fulu)
 */
export function getShufflingDependentRoot(
  forkChoice: IForkChoiceRead,
  msgEpoch: Epoch,
  protoBlockEpoch: Epoch,
  protoBlock: ProtoBlock
): RootHex {
  let shufflingDependentRoot: RootHex;
  if (protoBlockEpoch === msgEpoch) {
    // current shuffling, this is equivalent to `headState.currentShuffling`
    // given protoBlockEpoch = msgEpoch = n
    //        epoch:       (n-2)   (n-1)     n     (n+1)
    //               |-------|-------|-------|-------|
    // protoBlock       ------------------------^
    // shufflingDependentRoot ------^
    shufflingDependentRoot = forkChoice.getDependentRoot(protoBlock, EpochDifference.previous);
  } else if (protoBlockEpoch === msgEpoch - 1) {
    // next shuffling, this is equivalent to `headState.nextShuffling`
    // given protoBlockEpoch = n-1, msgEpoch = n
    //        epoch:       (n-2)   (n-1)     n     (n+1)
    //               |-------|-------|-------|-------|
    // protoBlock       -------------------^
    // shufflingDependentRoot ------^
    shufflingDependentRoot = forkChoice.getDependentRoot(protoBlock, EpochDifference.current);
  } else if (protoBlockEpoch < msgEpoch - 1) {
    // this never happens with default chain option of maxSkipSlots = 32, however we still need to handle it
    // check the verifyHeadBlockAndTargetRoot() function above
    // given protoBlockEpoch = n-2, msgEpoch = n
    //        epoch:       (n-2)   (n-1)     n     (n+1)
    //               |-------|-------|-------|-------|
    // protoBlock       -----------^
    // shufflingDependentRoot -----^
    shufflingDependentRoot = protoBlock.blockRoot;
    // use lodestar_gossip_attestation_head_slot_to_attestation_slot metric to track this case
  } else {
    // protoBlockEpoch > msgEpoch
    // should not happen, handled in verifyAttestationTargetRoot
    throw Error(`message epoch ${msgEpoch} is before proto block epoch ${protoBlockEpoch}`);
  }

  return shufflingDependentRoot;
}
