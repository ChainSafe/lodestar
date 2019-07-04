/**
 * @module sszTypes/generators
 */

import {SimpleContainerType} from "@chainsafe/ssz";

import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../../constants";

import {BeaconSSZTypes} from "../interface";

export const ProposerSlashing = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "ProposerSlashing",
  fields: [
    ["proposerIndex", ssz.ValidatorIndex],
    ["header1", ssz.BeaconBlockHeader],
    ["header2", ssz.BeaconBlockHeader],
  ],
});

export const AttesterSlashing = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "AttesterSlashing",
  fields: [
    ["attestation1", ssz.IndexedAttestation],
    ["attestation2", ssz.IndexedAttestation],
  ],
});

export const Attestation = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "Attestation",
  fields: [
    ["aggregationBitfield", ssz.bytes],
    ["data", ssz.AttestationData],
    ["custodyBitfield", ssz.bytes],
    ["signature", ssz.BLSSignature],
  ],
});

export const Deposit = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "Deposit",
  fields: [
    ["proof", [ssz.bytes32, DEPOSIT_CONTRACT_TREE_DEPTH]],
    ["data", ssz.DepositData],
  ],
});

export const VoluntaryExit = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "VoluntaryExit",
  fields: [
    ["epoch", ssz.Epoch],
    ["validatorIndex", ssz.ValidatorIndex],
    ["signature", ssz.BLSSignature],
  ],
});

export const Transfer = (ssz: BeaconSSZTypes): SimpleContainerType => ({
  name: "Transfer",
  fields: [
    ["sender", ssz.ValidatorIndex],
    ["recipient", ssz.ValidatorIndex],
    ["amount", ssz.Gwei],
    ["fee", ssz.Gwei],
    ["slot", ssz.Slot],
    ["pubkey", ssz.BLSPubkey],
    ["signature", ssz.BLSSignature],
  ],
});
