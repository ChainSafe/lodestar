/* eslint-disable @typescript-eslint/interface-name-prefix */
import {
  BLSPubkey,
  BLSSignature,
  CommitteeIndex,
  Gwei,
  Number64,
  Slot,
  Uint64,
  ValidatorIndex,
  Root,
  Version,
  Epoch,
} from "./primitive";
import {Fork, SignedBeaconBlockHeader, Validator} from "./misc";

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
  validatorPubkey: BLSPubkey;
  // used to determine if validator is aggregator
  aggregatorModulo: Number64;
  // The slot at which the validator must attest
  attestationSlot: Slot;

  committeeIndex: CommitteeIndex;
}

export interface ProposerDuty {
  slot: Slot;
  proposerPubkey: BLSPubkey;
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
