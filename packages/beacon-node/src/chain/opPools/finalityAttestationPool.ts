import {Signature, aggregateSignatures} from "@chainsafe/lodestar-z/blst";
import {BitArray} from "@chainsafe/ssz";
import {
  ATTESTATION_COMMITTEES_PER_ROUND,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_VALIDATORS_PER_AGGREGATE,
} from "@lodestar/params";
import {
  CachedBeaconStateEip8453,
  computeAttestationCommittee,
  computeEpochAtSlot,
  getActiveIndicesAtEpoch,
  isValidAttestationData,
} from "@lodestar/state-transition";
import {Epoch, RootHex, ValidatorIndex, eip8453} from "@lodestar/types";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "./types.js";

/** Finality gadget attestations of one epoch with identical data, one signature per attester per committee */
type AttestationGroup = {
  data: eip8453.AttestationData;
  byCommittee: Map<number, Map<ValidatorIndex, Uint8Array>>;
};

/**
 * [EIP8453] Unaggregated finality gadget attestations, aggregated at block production per (epoch, data) with
 * committee bits and aggregation bits over the concatenated committees (validator.md "FG attestations"). The
 * inclusion window is the finalized epoch to the current epoch, so older epochs are pruned.
 */
export class FinalityAttestationPool {
  private readonly groupsByEpoch = new Map<Epoch, Map<RootHex, AttestationGroup>>();
  private lowestPermissibleEpoch = 0;

  add(attestation: eip8453.SingleAttestation, dataRootHex: RootHex): InsertOutcome {
    const {epoch, committeeIndex, attesterIndex} = attestation;
    if (epoch < this.lowestPermissibleEpoch) {
      throw new OpPoolError({
        code: OpPoolErrorCode.SLOT_TOO_LOW,
        slot: epoch,
        lowestPermissibleSlot: this.lowestPermissibleEpoch,
      });
    }
    let groups = this.groupsByEpoch.get(epoch);
    if (groups === undefined) {
      groups = new Map();
      this.groupsByEpoch.set(epoch, groups);
    }
    let group = groups.get(dataRootHex);
    if (group === undefined) {
      group = {data: attestation.data, byCommittee: new Map()};
      groups.set(dataRootHex, group);
    }
    let committee = group.byCommittee.get(committeeIndex);
    if (committee === undefined) {
      committee = new Map();
      group.byCommittee.set(committeeIndex, committee);
    }
    if (committee.has(attesterIndex)) {
      return InsertOutcome.AlreadyKnown;
    }
    committee.set(attesterIndex, attestation.signature);
    return InsertOutcome.NewData;
  }

  /**
   * Aggregates whose data is still valid against `state`, from the finalized epoch to the state's epoch,
   * newest epoch first. Committees of one aggregate are grouped so the represented members stay within
   * `MAX_VALIDATORS_PER_AGGREGATE`.
   */
  getAttestationsForBlock(state: CachedBeaconStateEip8453): eip8453.Attestation[] {
    const attestations: eip8453.Attestation[] = [];
    const finalizedEpoch = computeEpochAtSlot(state.finalizedSlot);
    for (
      let epoch = state.epochCtx.epoch;
      epoch >= finalizedEpoch && attestations.length < MAX_ATTESTATIONS_ELECTRA;
      epoch--
    ) {
      const groups = this.groupsByEpoch.get(epoch);
      if (groups === undefined) continue;
      const activeIndices = getActiveIndicesAtEpoch(state, epoch);
      const committees = new Map<number, Uint32Array>();
      const committeeOf = (index: number): Uint32Array => {
        let committee = committees.get(index);
        if (committee === undefined) {
          committee = computeAttestationCommittee(activeIndices, epoch, index);
          committees.set(index, committee);
        }
        return committee;
      };
      for (const group of groups.values()) {
        if (!isValidAttestationData(state, group.data)) continue;
        const committeeIndices = Array.from(group.byCommittee.keys()).sort((a, b) => a - b);
        // Split into aggregates whose represented committees fit the size bound
        let chunk: number[] = [];
        let chunkSize = 0;
        const flush = (): void => {
          if (chunk.length === 0) return;
          attestations.push(this.aggregate(epoch, group, chunk, committeeOf));
          chunk = [];
          chunkSize = 0;
        };
        for (const committeeIndex of committeeIndices) {
          const size = committeeOf(committeeIndex).length;
          if (chunkSize + size > MAX_VALIDATORS_PER_AGGREGATE) flush();
          chunk.push(committeeIndex);
          chunkSize += size;
        }
        flush();
        if (attestations.length >= MAX_ATTESTATIONS_ELECTRA) break;
      }
    }
    return attestations.slice(0, MAX_ATTESTATIONS_ELECTRA);
  }

  private aggregate(
    epoch: Epoch,
    group: AttestationGroup,
    committeeIndices: number[],
    committeeOf: (index: number) => Uint32Array
  ): eip8453.Attestation {
    const committeeBits = BitArray.fromBitLen(ATTESTATION_COMMITTEES_PER_ROUND);
    const bits: boolean[] = [];
    const signatures: Signature[] = [];
    for (const committeeIndex of committeeIndices) {
      committeeBits.set(committeeIndex, true);
      const signers = group.byCommittee.get(committeeIndex) as Map<ValidatorIndex, Uint8Array>;
      for (const validatorIndex of committeeOf(committeeIndex)) {
        const signature = signers.get(validatorIndex);
        bits.push(signature !== undefined);
        if (signature !== undefined) signatures.push(Signature.fromBytes(signature));
      }
    }
    return {
      aggregationBits: BitArray.fromBoolArray(bits),
      data: group.data,
      signature: (signatures.length === 1 ? signatures[0] : aggregateSignatures(signatures)).toBytes(),
      committeeBits,
      epoch,
    };
  }

  /** Drop epochs before `finalizedEpoch` */
  prune(finalizedEpoch: Epoch): void {
    this.lowestPermissibleEpoch = finalizedEpoch;
    for (const epoch of this.groupsByEpoch.keys()) {
      if (epoch < finalizedEpoch) this.groupsByEpoch.delete(epoch);
    }
  }

  getAttestationCount(): number {
    let count = 0;
    for (const groups of this.groupsByEpoch.values()) {
      for (const group of groups.values()) {
        for (const committee of group.byCommittee.values()) count += committee.size;
      }
    }
    return count;
  }
}
