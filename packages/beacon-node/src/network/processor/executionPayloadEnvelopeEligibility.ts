import {ForkSeq, GENESIS_SLOT} from "@lodestar/params";
import {Slot} from "@lodestar/types";

export function canKnownBlockRequireExecutionPayloadEnvelope(
  forkSeqAtSlot: (slot: Slot) => ForkSeq,
  knownBlock: {slot: Slot} | null
): boolean {
  if (knownBlock === null) {
    return true;
  }

  return knownBlock.slot > GENESIS_SLOT && forkSeqAtSlot(knownBlock.slot) >= ForkSeq.gloas;
}
