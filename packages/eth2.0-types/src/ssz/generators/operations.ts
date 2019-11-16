/**
 * @module sszTypes/generators
 */

import {IBeaconParams} from "@chainsafe/eth2.0-params";
import {SimpleContainerType} from "@chainsafe/ssz-type-schema";

import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../constants";
import {IBeaconSSZTypes} from "../interface";

export const ProposerSlashing = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["proposerIndex", ssz.ValidatorIndex],
    ["header1", ssz.BeaconBlockHeader],
    ["header2", ssz.BeaconBlockHeader],
  ],
});

export const AttesterSlashing = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["attestation1", ssz.IndexedAttestation],
    ["attestation2", ssz.IndexedAttestation],
  ],
});

export const Attestation = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    ["aggregationBits", {
      elementType: ssz.bool,
      maxLength: params.MAX_VALIDATORS_PER_COMMITTEE,
    }],
    ["data", ssz.AttestationData],
    ["signature", ssz.BLSSignature],
  ],
});

export const Deposit = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["proof", {
      elementType: ssz.Hash,
      length: DEPOSIT_CONTRACT_TREE_DEPTH + 1,
    }],
    ["data", ssz.DepositData],
  ],
});

export const VoluntaryExit = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["epoch", ssz.Epoch],
    ["validatorIndex", ssz.ValidatorIndex],
    ["signature", ssz.BLSSignature],
  ],
});
