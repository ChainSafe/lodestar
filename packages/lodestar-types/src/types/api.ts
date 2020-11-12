/* eslint-disable @typescript-eslint/interface-name-prefix */
import {Checkpoint, SignedBeaconBlockHeader, Validator} from "./misc";
import {
  BLSPubkey,
  BLSSignature,
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

export interface ValidatorResponse {
  index: ValidatorIndex;
  // BLS public key
  pubkey: BLSPubkey;
  balance: Gwei;
  validator: Validator;
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
