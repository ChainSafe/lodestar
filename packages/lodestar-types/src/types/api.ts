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
} from "./primitive";
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
  WAITING_FOR_ELIGIBILITY = "waiting_for_eligibility",
  WAITING_FOR_FINALITY = "waiting_for_finality",
  WAITING_IN_QUEUE = "waiting_in_queue",
  STANDBY_FOR_ACTIVE = "standby_for_active",
  ACTIVE = "active",
  ACTIVE_AWAITING_VOLUNTARY_EXIT = "active_awaiting_voluntary_exit",
  ACTIVE_AWAITING_SLASHED_EXIT = "active_awaiting_slashed_exit",
  EXITED_VOLUNTARILY = "exited_voluntarily",
  EXITED_SLASHED = "exited_slashed",
  WITHDRAWABLE_VOLUNTARILY = "withdrawable_voluntarily",
  WITHDRAWABLE_SLASHED = "withdrawable_slashed",
  WITHDRAWN_VOLUNTARILY = "withdrawn_voluntarily",
  WITHDRAWN_SLASHED = "withdrawn_slashed",
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
