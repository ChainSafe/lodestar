/**
 * @module sszTypes/generators
 */

import {IBeaconParams} from "@chainsafe/eth2.0-params";
import {SimpleContainerType} from "@chainsafe/ssz-type-schema";

import {IBeaconSSZTypes} from "../interface";

export const BeaconBlockBody = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    ["randaoReveal", ssz.BLSSignature],
    ["eth1Data", ssz.Eth1Data],
    ["graffiti", ssz.bytes32],
    ["proposerSlashings", {
      elementType: ssz.ProposerSlashing,
      maxLength: params.MAX_PROPOSER_SLASHINGS,
    }],
    ["attesterSlashings", {
      elementType: ssz.AttesterSlashing,
      maxLength: params.MAX_ATTESTER_SLASHINGS,
    }],
    ["attestations", {
      elementType: ssz.Attestation,
      maxLength: params.MAX_ATTESTATIONS,
    }],
    ["deposits", {
      elementType: ssz.Deposit,
      maxLength: params.MAX_DEPOSITS,
    }],
    ["voluntaryExits", {
      elementType: ssz.VoluntaryExit,
      maxLength: params.MAX_VOLUNTARY_EXITS,
    }],
    ["transfers", {
      elementType: ssz.Transfer,
      maxLength: params.MAX_TRANSFERS,
    }],
  ],
});

export const BeaconBlock = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["slot", ssz.Slot],
    ["parentRoot", ssz.Hash],
    ["stateRoot", ssz.Hash],
    ["body", ssz.BeaconBlockBody],
    ["signature", ssz.BLSSignature],
  ],
});
