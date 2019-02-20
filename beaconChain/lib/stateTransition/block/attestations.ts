import assert from "assert";

import {serialize, treeHash} from "@chainsafesystems/ssz";

import {
  AttestationDataAndCustodyBit,
  BeaconBlock,
  BeaconState,
  Crosslink,
  PendingAttestation,
} from "../../../types";

import {
  Domain,
  MAX_ATTESTATIONS,
  MIN_ATTESTATION_INCLUSION_DELAY,
  SLOTS_PER_EPOCH,
  ZERO_HASH,
} from "../../../constants";

import {
  getAttestationParticipants,
  getBitfieldBit,
  getBlockRoot,
  getCrosslinkCommitteesAtSlot,
  getCurrentEpoch,
  getDomain,
  getEpochStartSlot,
  slotToEpoch,
} from "../../../helpers/stateTransitionHelpers";

import {blsAggregatePubkeys, blsVerifyMultiple} from "../../stubs/bls";

export default function processAttestations(state: BeaconState, block: BeaconBlock) {
  assert(block.body.attestations.length <= MAX_ATTESTATIONS);
  for (const attestation of block.body.attestations) {
    assert(attestation.data.slot.lte(state.slot.subn(MIN_ATTESTATION_INCLUSION_DELAY)) &&
      state.slot.subn(MIN_ATTESTATION_INCLUSION_DELAY).lt(attestation.data.slot.addn(SLOTS_PER_EPOCH)));
    const justifiedEpoch = slotToEpoch(attestation.data.slot.addn(1)).gte(getCurrentEpoch(state)) ?
      state.justifiedEpoch : state.previousJustifiedEpoch;
    assert(attestation.data.justifiedEpoch.eq(justifiedEpoch));
    assert(attestation.data.justifiedBlockRoot.equals(getBlockRoot(state, getEpochStartSlot(attestation.data.justifiedEpoch))));
    assert(serialize(state.latestCrosslinks[attestation.data.shard.toNumber()], Crosslink).eq(serialize(attestation.data.latestCrosslink), Crosslink) ||
      serialize(state.latestCrosslinks[attestation.data.shard.toNumber()], Crosslink).eq(
        serialize({
          epoch: slotToEpoch(attestation.data.slot),
          shardBlockRoot: attestation.data.shardBlockRoot,
        } as Crosslink, Crosslink)));

    // Remove this condition in Phase 1
    assert((attestation.custodyBitfield.equals(Buffer.alloc(attestation.custodyBitfield.length))));
    assert(attestation.aggregationBitfield.equals(Buffer.alloc(attestation.aggregationBitfield.length)));

    const crosslinkCommittee = getCrosslinkCommitteesAtSlot(state, attestation.data.slot)
      .filter(({shard}) => shard.eq(attestation.data.shard))
      .map(({validatorIndices}) => validatorIndices)[0];
    for (let i = 0; i < crosslinkCommittee.length; i++) {
      if (getBitfieldBit(attestation.aggregationBitfield, i) === 0b0) {
        assert(getBitfieldBit(attestation.custodyBitfield, i) === 0b0);
      }
    }
    const participants = getAttestationParticipants(state, attestation.data, attestation.aggregationBitfield);
    const custodyBit1Participants = getAttestationParticipants(state, attestation.data, attestation.custodyBitfield);
    const custodyBit0Participants = participants.filter((i) => custodyBit1Participants.find((i2) => i === i2));

    const custodyBitsVerified = blsVerifyMultiple(
      [
        blsAggregatePubkeys(custodyBit0Participants.map((i) => state.validatorRegistry[i].pubkey)),
        blsAggregatePubkeys(custodyBit1Participants.map((i) => state.validatorRegistry[i].pubkey)),
      ],
      [
        treeHash({ data: attestation.data, custodyBit: false } as AttestationDataAndCustodyBit),
        treeHash({ data: attestation.data, custodyBit: true } as AttestationDataAndCustodyBit),
      ],
      attestation.aggregateSignature,
      getDomain(state.fork, slotToEpoch(attestation.data.slot), Domain.ATTESTATION),
    );
    assert(custodyBitsVerified);
    // Remove the following conditional in Phase 1
    assert(attestation.data.shardBlockRoot.equals(ZERO_HASH));
    state.latestAttestations.push({
      data: attestation.data,
      aggregationBitfield: attestation.aggregationBitfield,
      custodyBitfield: attestation.custodyBitfield,
      inclusionSlot: state.slot,
    } as PendingAttestation);
  }
}
