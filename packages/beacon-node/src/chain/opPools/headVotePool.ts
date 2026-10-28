import {Signature, aggregateSignatures} from "@chainsafe/lodestar-z/blst";
import {BitArray} from "@chainsafe/ssz";
import {MAX_HEAD_VOTES, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex, eip8453} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "./types.js";

/** Head votes of one slot for one (block root, payload status), one signature per voter */
type HeadVoteGroup = {
  data: eip8453.HeadVoteData;
  signatures: Map<ValidatorIndex, Uint8Array>;
};

export type HeadVotesForBlock = {
  headVotes: eip8453.HeadVote[];
  headVoteSupport: BitArray[];
};

/**
 * [EIP8453] Unaggregated head votes received over gossip or the API, aggregated at block production into
 * `HeadVote`s with their support bits, as validator.md "Head votes" describes. Votes are kept for the
 * previous and current epoch, which is the inclusion window of `process_head_vote`.
 */
export class HeadVotePool {
  private readonly votesBySlot = new Map<Slot, Map<string, HeadVoteGroup>>();
  private lowestPermissibleSlot = 0;

  add(message: eip8453.HeadVoteMessage, dataRootHex: RootHex): InsertOutcome {
    const {slot} = message.data;
    if (slot < this.lowestPermissibleSlot) {
      throw new OpPoolError({
        code: OpPoolErrorCode.SLOT_TOO_LOW,
        slot,
        lowestPermissibleSlot: this.lowestPermissibleSlot,
      });
    }
    let groups = this.votesBySlot.get(slot);
    if (groups === undefined) {
      groups = new Map();
      this.votesBySlot.set(slot, groups);
    }
    let group = groups.get(dataRootHex);
    if (group === undefined) {
      group = {data: message.data, signatures: new Map()};
      groups.set(dataRootHex, group);
    }
    if (group.signatures.has(message.validatorIndex)) {
      return InsertOutcome.AlreadyKnown;
    }
    group.signatures.set(message.validatorIndex, message.signature);
    return InsertOutcome.NewData;
  }

  /**
   * Aggregates for a block at `blockSlot`: votes of `blockSlot - 1` first, with support for voters whose block
   * the proposer knows (`isSupportedBlock`), then older votes of the previous and current epoch with no support.
   */
  /**
   * Aggregate the pool's votes for a block at `blockSlot`: every vote of the previous slot (they may carry support
   * and record participation), and from older slots only the voters `keepOlderVoter` admits, which the proposer
   * uses to drop votes that already left their trace in the state. Older votes for other blocks add nothing on
   * chain, so the proposer should admit only same-slot voters whose participation bit is still unset.
   */
  getHeadVotesForBlock(
    blockSlot: Slot,
    isSupportedBlock: (rootHex: RootHex, voteSlot: Slot) => boolean,
    keepOlderVoter: (data: eip8453.HeadVoteData, validatorIndex: ValidatorIndex) => boolean = () => true
  ): HeadVotesForBlock {
    const headVotes: eip8453.HeadVote[] = [];
    const headVoteSupport: BitArray[] = [];
    const blockEpoch = computeEpochAtSlot(blockSlot);
    const earliestSlot = Math.max(0, (blockEpoch - 1) * SLOTS_PER_EPOCH);
    for (let slot = blockSlot - 1; slot >= earliestSlot && headVotes.length < MAX_HEAD_VOTES; slot--) {
      const groups = this.votesBySlot.get(slot);
      if (groups === undefined) continue;
      for (const group of groups.values()) {
        if (headVotes.length >= MAX_HEAD_VOTES) break;
        const previousSlot = slot === blockSlot - 1;
        const voterIndices = Array.from(group.signatures.keys())
          .filter((index) => previousSlot || keepOlderVoter(group.data, index))
          .sort((a, b) => a - b);
        if (voterIndices.length === 0) continue;
        const signatures = voterIndices.map((index) => Signature.fromBytes(group.signatures.get(index) as Uint8Array));
        headVotes.push({
          voterIndices,
          data: group.data,
          signature: (signatures.length === 1 ? signatures[0] : aggregateSignatures(signatures)).toBytes(),
        });
        const supported = previousSlot && isSupportedBlock(toRootHex(group.data.beaconBlockRoot), slot);
        headVoteSupport.push(BitArray.fromBoolArray(voterIndices.map(() => supported)));
      }
    }
    return {headVotes, headVoteSupport};
  }

  /** Drop votes older than the previous epoch of `currentSlot` */
  prune(currentSlot: Slot): void {
    const epoch = computeEpochAtSlot(currentSlot);
    this.lowestPermissibleSlot = Math.max(0, (epoch - 1) * SLOTS_PER_EPOCH);
    for (const slot of this.votesBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) this.votesBySlot.delete(slot);
    }
  }

  getVoteCount(): number {
    let count = 0;
    for (const groups of this.votesBySlot.values()) {
      for (const group of groups.values()) count += group.signatures.size;
    }
    return count;
  }
}
