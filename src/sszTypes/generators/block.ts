/**
 * @module sszTypes/generators
 */

import {SimpleContainerType} from "@chainsafe/ssz";

import {IBeaconSSZTypes} from "../interface";

export const BeaconBlockBody = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlockBody",
  fields: [
    ["randaoReveal", ssz.bytes96],
    ["eth1Data", ssz.Eth1Data],
    ["graffiti", ssz.bytes32],
    ["proposerSlashings", [ssz.ProposerSlashing]],
    ["attesterSlashings", [ssz.AttesterSlashing]],
    ["attestations", [ssz.Attestation]],
    ["deposits", [ssz.Deposit]],
    ["voluntaryExits", [ssz.VoluntaryExit]],
    ["transfers", [ssz.Transfer]],
  ],
});

export const BeaconBlock = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  name: "BeaconBlock",
  fields: [
    ["slot", ssz.Slot],
    ["parentRoot", ssz.bytes32],
    ["stateRoot", ssz.bytes32],
    ["body", ssz.BeaconBlockBody],
    ["signature", ssz.BLSSignature],
  ],
});
