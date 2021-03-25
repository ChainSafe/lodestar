import {Checkpoint, SignedBeaconBlockHeader, Validator} from "./misc";
import {
  BLSPubkey,
  BLSSignature,
  Bytes20,
  CommitteeIndex,
  Epoch,
  Gwei,
  Number64,
  Root,
  Slot,
  Uint64,
  ValidatorIndex,
  Version,
} from "../../primitive/types";
import {List} from "@chainsafe/ssz";

export interface SignedBeaconHeaderResponse {
  root: Root;
  canonical: boolean;
  header: SignedBeaconBlockHeader;
}

export interface SubscribeToCommitteeSubnetPayload {
  slot: Slot;
  slotSignature: BLSSignature;
  attestationCommitteeIndex: CommitteeIndex;
  aggregatorPubkey: BLSPubkey;
}

export interface AttesterDuty {
  // The validator's public key, uniquely identifying them
  pubkey: BLSPubkey;
  // Index of validator in validator registry
  validatorIndex: ValidatorIndex;
  committeeIndex: CommitteeIndex;
  // Number of validators in committee
  committeeLength: Number64;
  // Number of committees at the provided slot
  committeesAtSlot: Number64;
  // Index of validator in committee
  validatorCommitteeIndex: Number64;
  // The slot at which the validator must attest.
  slot: Slot;
}

export interface ProposerDuty {
  slot: Slot;
  validatorIndex: ValidatorIndex;
  pubkey: BLSPubkey;
}

export interface BeaconCommitteeSubscription {
  validatorIndex: number;
  committeeIndex: number;
  committeesAtSlot: number;
  slot: number;
  isAggregator: boolean;
}

export interface SyncingStatus {
  // Head slot node is trying to reach
  headSlot: Uint64;
  // How many slots node needs to process to reach head. 0 if synced.
  syncDistance: Uint64;
}

export interface Genesis {
  genesisTime: Uint64;
  genesisValidatorsRoot: Root;
  genesisForkVersion: Version;
}

export interface ChainHead {
  slot: Slot;
  block: Root;
  state: Root;
  epochTransition: boolean;
}

export interface BlockEventPayload {
  slot: Slot;
  block: Root;
}

export interface FinalizedCheckpoint {
  block: Root;
  state: Root;
  epoch: Epoch;
}

export interface ChainReorg {
  slot: Slot;
  depth: Number64;
  oldHeadBlock: Root;
  newHeadBlock: Root;
  oldHeadState: Root;
  newHeadState: Root;
  epoch: Epoch;
}

export interface FinalityCheckpoints {
  previousJustified: Checkpoint;
  currentJustified: Checkpoint;
  finalized: Checkpoint;
}

export interface ValidatorBalance {
  index: ValidatorIndex;
  balance: Gwei;
}

export interface BeaconCommitteeResponse {
  index: CommitteeIndex;
  slot: Slot;
  validators: List<ValidatorIndex>;
}

export enum ValidatorStatus {
  PENDING_INITIALIZED = "pending_initialized",
  PENDING_QUEUED = "pending_queued",
  ACTIVE_ONGOING = "active_ongoing",
  ACTIVE_EXITING = "active_exiting",
  ACTIVE_SLASHED = "active_slashed",
  EXITED_UNSLASHED = "exited_unslashed",
  EXITED_SLASHED = "exited_slashed",
  WITHDRAWAL_POSSIBLE = "withdrawal_possible",
  WITHDRAWAL_DONE = "withdrawal_done",
}

export interface ValidatorResponse {
  index: ValidatorIndex;
  balance: Gwei;
  status: ValidatorStatus;
  validator: Validator;
}

export interface Contract {
  chainId: Number64;
  address: Bytes20;
}
