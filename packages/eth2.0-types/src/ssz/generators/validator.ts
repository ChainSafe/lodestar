/**
 * @module sszTypes/generators
 */

import {ContainerType} from "@chainsafe/ssz";

import {IBeaconSSZTypes} from "../interface";

export const ValidatorDuty = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: [
    ["validatorPubkey", ssz.BLSPubkey],
    ["committeeIndex", ssz.CommitteeIndex],
    ["attestationSlot", ssz.Slot],
  ],
});

export const CommitteeAssignment = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: [
    ["validators", ssz.CommitteeIndices],
    ["committeeIndex", ssz.CommitteeIndex],
    ["slot", ssz.Slot],
  ],
});

export const SyncingStatus = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: [
    ["startingBlock", ssz.Uint64],
    ["currentBlock", ssz.Uint64],
    ["highestBlock", ssz.Uint64],
  ],
});

export const AggregateAndProof = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: [
    ["aggregatorIndex", ssz.ValidatorIndex],
    ["aggregate", ssz.Attestation],
    ["selectionProof", ssz.BLSSignature],
  ],
});
