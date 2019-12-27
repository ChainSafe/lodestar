/**
 * @module sszTypes/generators
 */

import {SimpleContainerType} from "@chainsafe/ssz-type-schema";
import {IBeaconSSZTypes} from "../interface";
import {IBeaconParams} from "@chainsafe/eth2.0-params";

export const ValidatorDuty = (ssz: IBeaconSSZTypes): SimpleContainerType => ({
  fields: [
    ["validatorPubkey", ssz.BLSPubkey],
    ["committeeIndex", ssz.CommitteeIndex],
    ["attestationSlot", ssz.Slot],
  ],
});

export const CommitteeAssignment = (ssz: IBeaconSSZTypes, params: IBeaconParams): SimpleContainerType => ({
  fields: [
    ["validators", {
      elementType: ssz.ValidatorIndex,
      maxLength: params.MAX_VALIDATORS_PER_COMMITTEE,
    }],
    ["committeeIndex", ssz.CommitteeIndex],
    ["slot", ssz.Slot],
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
    ["aggregatorIndex", ssz.ValidatorIndex],
    ["aggregate", ssz.Attestation],
    ["selectionProof", ssz.BLSSignature],
  ],
});
