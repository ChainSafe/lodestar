/**
 * @module sszTypes/generators
 */

import {SimpleContainerType} from "@chainsafe/ssz-type-schema";
import {IBeaconSSZTypes} from "../interface";

export const ValidatorDuty = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["validatorPubkey", ssz.BLSPubkey],
    ["committeeIndex", ssz.CommitteeIndex],
    ["attestationSlot", ssz.Slot],
    ["blockProductionSlot", ssz.Slot],
  ],
});

export const SyncingStatus = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["startingBlock", ssz.uint64],
    ["currentBlock", ssz.uint64],
    ["highestBlock", ssz.uint64],
  ],
});

export const AggregateAndProof = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["index", ssz.ValidatorIndex],
    ["selectionProof", ssz.BLSSignature],
    ["aggregate", ssz.Attestation],
  ],
});
