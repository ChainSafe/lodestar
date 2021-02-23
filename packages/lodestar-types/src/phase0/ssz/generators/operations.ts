/**
 * @module sszTypes/generators
 */

import {ContainerType, VectorType} from "@chainsafe/ssz";

import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../constants";
import {IPhase0SSZTypes} from "../interface";

export const ProposerSlashing = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      signedHeader1: ssz.SignedBeaconBlockHeader,
      signedHeader2: ssz.SignedBeaconBlockHeader,
    },
  });

export const AttesterSlashing = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      attestation1: ssz.IndexedAttestation,
      attestation2: ssz.IndexedAttestation,
    },
  });

export const Attestation = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      aggregationBits: ssz.CommitteeBits,
      data: ssz.AttestationData,
      signature: ssz.BLSSignature,
    },
  });

export const Deposit = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      proof: new VectorType({
        elementType: ssz.Bytes32,
        length: DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      }),
      data: ssz.DepositData,
    },
  });

export const VoluntaryExit = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      epoch: ssz.Epoch,
      validatorIndex: ssz.ValidatorIndex,
    },
  });

export const SignedVoluntaryExit = (ssz: IPhase0SSZTypes): ContainerType =>
  new ContainerType({
    fields: {
      message: ssz.VoluntaryExit,
      signature: ssz.BLSSignature,
    },
  });
