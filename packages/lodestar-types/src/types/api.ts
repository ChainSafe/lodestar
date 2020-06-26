/* eslint-disable @typescript-eslint/interface-name-prefix */
import {BLSPubkey, BLSSignature, CommitteeIndex, Gwei, Number64, Slot, Uint64, ValidatorIndex, Root} from "./primitive";
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

export interface ForkResponse {
  chainId: Uint64;
  fork: Fork;
  genesisValidatorsRoot: Root;
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
  balance: Gwei;
  validator: Validator;
}
