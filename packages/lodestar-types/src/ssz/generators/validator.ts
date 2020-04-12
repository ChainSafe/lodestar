/**
 * @module sszTypes/generators
 */
import {ContainerType} from "@chainsafe/ssz";
import {IBeaconSSZTypes} from "../interface";


export const CommitteeAssignment = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    validators: ssz.CommitteeIndices,
    committeeIndex: ssz.CommitteeIndex,
    slot: ssz.Slot,
  },
});

export const AggregateAndProof = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    aggregatorIndex: ssz.ValidatorIndex,
    aggregate: ssz.Attestation,
    selectionProof: ssz.BLSSignature,
  },
});

export const SignedAggregateAndProof = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    message: ssz.AggregateAndProof,
    signature: ssz.BLSSignature,
  },
});
