import {altair, phase0, Slot} from "@chainsafe/lodestar-types";
import {GossipValidationError} from "./gossipValidation";

export enum SyncCommitteeErrorCode {
  NOT_CURRENT_SLOT = "SYNC_COMMITTEE_ERROR_NOT_CURRENT_SLOT",
  UNKNOWN_BEACON_BLOCK_ROOT = "SYNC_COMMITTEE_ERROR_UNKNOWN_BEACON_BLOCK_ROOT",
  SYNC_COMMITTEE_ALREADY_KNOWN = "SYNC_COMMITTEE_ERROR_SYNC_COMMITTEE_ALREADY_KNOWN",
  VALIDATOR_NOT_IN_SYNC_COMMITTEE = "SYNC_COMMITTEE_ERROR_VALIDATOR_NOT_IN_SYNC_COMMITTEE",
  INVALID_SIGNATURE = "SYNC_COMMITTEE_INVALID_SIGNATURE",
  INVALID_SUB_COMMITTEE_INDEX = "SYNC_COMMITTEE_INVALID_SUB_COMMITTEE_INDEX",
  INVALID_AGGREGATOR = "SYNC_COMMITTEE_ERROR_INVALID_AGGREGATOR",
  AGGREGATOR_PUBKEY_UNKNOWN = "SYNC_COMMITTEE_ERROR_AGGREGATOR_PUBKEY_UNKNOWN",
}
export type SyncCommitteeErrorType =
  | {code: SyncCommitteeErrorCode.NOT_CURRENT_SLOT; slot: Slot; currentSlot: Slot}
  | {code: SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT; beaconBlockRoot: Uint8Array}
  | {code: SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN}
  | {code: SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE; validatorIndex: phase0.ValidatorIndex}
  | {code: SyncCommitteeErrorCode.INVALID_SIGNATURE}
  | {code: SyncCommitteeErrorCode.INVALID_SUB_COMMITTEE_INDEX; subCommitteeIndex: number}
  | {code: SyncCommitteeErrorCode.INVALID_AGGREGATOR; aggregatorIndex: phase0.ValidatorIndex}
  | {code: SyncCommitteeErrorCode.AGGREGATOR_PUBKEY_UNKNOWN; aggregatorIndex: phase0.ValidatorIndex};

export interface ISyncCommitteeJob {
  signature: altair.SyncCommitteeSignature;
  validSignature: boolean;
}

export interface IContributionAndProofJob {
  contributionAndProof: altair.SignedContributionAndProof;
  validSignature: boolean;
}

export class SyncCommitteeError extends GossipValidationError<SyncCommitteeErrorType> {}
