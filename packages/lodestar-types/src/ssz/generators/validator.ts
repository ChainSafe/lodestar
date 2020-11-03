/**
 * @module sszTypes/generators
 */
import {ContainerType} from "@chainsafe/ssz";
import {IBeaconSSZTypes} from "../interface";

export const CommitteeAssignment = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      validators: ssz.CommitteeIndices,
      committeeIndex: ssz.CommitteeIndex,
      slot: ssz.Slot,
    },
  });

export const AggregateAndProof = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      aggregatorIndex: ssz.ValidatorIndex,
      aggregate: ssz.Attestation,
      selectionProof: ssz.BLSSignature,
    },
  });

export const SignedAggregateAndProof = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      message: ssz.AggregateAndProof,
      signature: ssz.BLSSignature,
    },
  });

export const SlashingProtectionBlock = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      slot: ssz.Slot,
      signingRoot: ssz.Root,
    },
  });

export const SlashingProtectionAttestation = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      sourceEpoch: ssz.Epoch,
      targetEpoch: ssz.Epoch,
      signingRoot: ssz.Root,
    },
  });

export const SlashingProtectionAttestationLowerBound = (ssz: IBeaconSSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      minSourceEpoch: ssz.Epoch,
      minTargetEpoch: ssz.Epoch,
    },
  });
