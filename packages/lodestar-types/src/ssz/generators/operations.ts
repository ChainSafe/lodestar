/**
 * @module sszTypes/generators
 */

import {ContainerType, VectorType} from "@chainsafe/ssz";

import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../constants";
import {IBeaconSSZTypes} from "../interface";

export const ProposerSlashing = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    proposerIndex: ssz.ValidatorIndex,
    signedHeader1: ssz.SignedBeaconBlockHeader,
    signedHeader2: ssz.SignedBeaconBlockHeader,
  },
});

export const AttesterSlashing = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    attestation1: ssz.IndexedAttestation,
    attestation2: ssz.IndexedAttestation,
  },
});

export const Attestation = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    aggregationBits: ssz.CommitteeBits,
    data: ssz.AttestationData,
    signature: ssz.BLSSignature,
  },
});

export const Deposit = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    proof: new VectorType({
      elementType: ssz.Bytes32,
      length: DEPOSIT_CONTRACT_TREE_DEPTH + 1,
    }),
    data: ssz.DepositData,
  },
});

export const VoluntaryExit = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    epoch: ssz.Epoch,
    validatorIndex: ssz.ValidatorIndex,
  },
});

export const SignedVoluntaryExit = (ssz: IBeaconSSZTypes): ContainerType => new ContainerType({
  fields: {
    message: ssz.VoluntaryExit,
    signature: ssz.BLSSignature,
  },
});
