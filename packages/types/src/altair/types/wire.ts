import {BitVector} from "@chainsafe/ssz";
import {AttestationSubnets} from "../../phase0/types";
import {BLSPubkey, Epoch, Root, Uint64, ValidatorIndex} from "../../primitive/types";

export type SyncSubnets = BitVector;

export interface Metadata {
  seqNumber: Uint64;
  attnets: AttestationSubnets;
  syncnets: SyncSubnets;
}

/**
 * From https://github.com/ethereum/eth2.0-APIs/pull/136
 */
export interface SyncCommitteeSubscription {
  validatorIndex: ValidatorIndex;
  syncCommitteeIndices: number[];
  untilEpoch: Epoch;
}

export interface SyncCommitteeByValidatorIndices {
  /** all of the validator indices in the current sync committee */
  validators: ValidatorIndex[];
  // TODO: This property will likely be deprecated
  /** Subcommittee slices of the current sync committee */
  validatorAggregates: ValidatorIndex[];
}

/**
 * From https://github.com/ethereum/eth2.0-APIs/pull/134
 */
export interface SyncDuty {
  pubkey: BLSPubkey;
  /** Index of validator in validator registry. */
  validatorIndex: ValidatorIndex;
  /** The indices of the validator in the sync committee. */
  validatorSyncCommitteeIndices: number[];
}

export interface SyncDutiesApi {
  data: SyncDuty[];
  dependentRoot: Root;
}
