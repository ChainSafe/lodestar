/* eslint-disable @typescript-eslint/interface-name-prefix */
import {
  BLSPubkey,
  BLSSignature,
  Bytes32,
  CommitteeIndex, Epoch,
  Gwei,
  Number64,
  Slot,
  Uint64,
  ValidatorIndex
} from "./primitive";
import {Fork, Validator} from "./misc";

export interface SubscribeToCommitteeSubnetPayload {
  slot: Slot;
  slotSignature: BLSSignature;
  attestationCommitteeIndex: CommitteeIndex;
  aggregatorPubkey: BLSPubkey;
}

export interface ForkResponse {
  chainId: Uint64;
  fork: Fork;
}

export interface AttesterDuty {
  // The validator's public key, uniquely identifying them
  validatorPubkey: BLSPubkey;
  // used to determine if validator is aggregator
  aggregatorModulo: Number64;
  // The slot at which the validator must attest
  attestationSlot: Slot;

  committeeIndex: CommitteeIndex;
}

export interface SyncingStatus {
  // The block at which syncing started (will only be reset, after the sync reached his head)
  startingBlock: Uint64;
  // Current Block
  currentBlock: Uint64;
  // The estimated highest block, or current target block number
  highestBlock: Uint64;
}

export interface ValidatorResponse {
  index: ValidatorIndex;
  // BLS public key
  pubkey: BLSPubkey;
  // Commitment to pubkey for withdrawals
  withdrawalCredentials: Bytes32;
  // Balance at stake
  effectiveBalance: Gwei;
  // Was the validator slashed
  slashed: boolean;
  // When criteria for activation were met
  activationEligibilityEpoch: Epoch;
  // Epoch when validator activated
  activationEpoch: Epoch;
  // Epoch when validator exited
  exitEpoch: Epoch;
  // When validator can withdraw or transfer funds
  withdrawableEpoch: Epoch;
}