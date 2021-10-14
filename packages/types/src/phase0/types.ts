import {BitList, List, Vector, BitVector} from "@chainsafe/ssz";
import {
  BLSPubkey,
  BLSSignature,
  Epoch,
  Root,
  Number64,
  Slot,
  ValidatorIndex,
  Version,
  CommitteeIndex,
  Bytes32,
  Domain,
  ForkDigest,
  Gwei,
  Uint64,
} from "../primitive/types";

export type AttestationSubnets = BitVector;

export interface BeaconBlockHeader {
  slot: Slot;
  proposerIndex: ValidatorIndex;
  parentRoot: Root;
  stateRoot: Root;
  bodyRoot: Root;
}

export interface SignedBeaconBlockHeader {
  message: BeaconBlockHeader;
  signature: BLSSignature;
}

export interface Checkpoint {
  epoch: Epoch;
  root: Root;
}

export interface DepositMessage {
  // BLS pubkey
  pubkey: BLSPubkey;
  // Withdrawal credentials
  withdrawalCredentials: Bytes32;
  // Amount in Gwei
  amount: Number64;
}

export interface DepositData {
  // BLS pubkey
  pubkey: BLSPubkey;
  // Withdrawal credentials
  withdrawalCredentials: Bytes32;
  // Amount in Gwei
  amount: Number64;
  // Signing over DepositMessage
  signature: BLSSignature;
}

export interface DepositEvent {
  depositData: DepositData;
  /// The block number of the log that included this `DepositData`.
  blockNumber: Number64;
  /// The index included with the deposit log.
  index: Number64;
}

export interface Eth1Data {
  // Root of the deposit tree
  depositRoot: Root;
  // Total number of deposits
  depositCount: Number64;
  // Block hash
  blockHash: Bytes32;
}

export interface Eth1DataOrdered {
  // block number for this eth1 data block hash
  blockNumber: Number64;
  // Root of the deposit tree
  depositRoot: Root;
  // Total number of deposits
  depositCount: Number64;
  // Block hash
  blockHash: Bytes32;
}

export interface Fork {
  // Previous fork version
  previousVersion: Version;
  // Current fork version
  currentVersion: Version;
  // Fork epoch number
  epoch: Epoch;
}

export interface ForkData {
  // Current fork version
  currentVersion: Version;
  // root of genesis validator list
  genesisValidatorsRoot: Root;
}

export interface ENRForkID {
  // Current fork digest
  forkDigest: ForkDigest;
  // next planned fork versin
  nextForkVersion: Version;
  // next fork epoch
  nextForkEpoch: Epoch;
}

export interface HistoricalBatch {
  // Block roots
  blockRoots: Vector<Root>;
  // State roots
  stateRoots: Vector<Root>;
}

export interface Validator {
  // BLS public key
  pubkey: BLSPubkey;
  // Commitment to pubkey for withdrawals
  withdrawalCredentials: Bytes32;
  // Balance at stake
  effectiveBalance: Number64;
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

export interface AttestationData {
  slot: Slot;
  index: CommitteeIndex;
  // LMD GHOST vote
  beaconBlockRoot: Root;
  // FFG vote
  source: Checkpoint;
  target: Checkpoint;
}

export interface IndexedAttestation {
  // Validator Indices
  attestingIndices: List<ValidatorIndex>;
  // Attestation Data
  data: AttestationData;
  // Aggregate signature
  signature: BLSSignature;
}

export interface PendingAttestation {
  // Attester aggregation bitfield
  aggregationBits: BitList;
  // Attestation data
  data: AttestationData;
  // Inclusion delay
  inclusionDelay: Slot;
  // Proposer index
  proposerIndex: ValidatorIndex;
}

export interface SigningData {
  objectRoot: Root;
  domain: Domain;
}

export interface Eth1Block {
  // Use blockHash to be consistent with the Eth1Data type
  blockHash: Bytes32;
  // Use blockNumber to be consistent with DepositEvent type
  blockNumber: Number64;
  timestamp: Number64;
}

export interface Attestation {
  // Attester participation bitfield
  aggregationBits: BitList;
  // Attestation data
  data: AttestationData;
  // BLS aggregate signature
  signature: BLSSignature;
}

export interface AttesterSlashing {
  // First attestation
  attestation1: IndexedAttestation;
  // Second attestation
  attestation2: IndexedAttestation;
}

export interface Deposit {
  // Branch in the deposit tree
  proof: Vector<Bytes32>;
  // Deposit data
  data: DepositData;
}

export interface ProposerSlashing {
  // First block header
  signedHeader1: SignedBeaconBlockHeader;
  // Second block header
  signedHeader2: SignedBeaconBlockHeader;
}

export interface VoluntaryExit {
  // Minimum epoch for processing exit
  epoch: Epoch;
  // Index of the exiting validator
  validatorIndex: ValidatorIndex;
}

export interface SignedVoluntaryExit {
  message: VoluntaryExit;
  // Validator signature
  signature: BLSSignature;
}

export interface BeaconBlockBody {
  randaoReveal: BLSSignature;
  eth1Data: Eth1Data;
  graffiti: Bytes32;
  proposerSlashings: List<ProposerSlashing>;
  attesterSlashings: List<AttesterSlashing>;
  attestations: List<Attestation>;
  deposits: List<Deposit>;
  voluntaryExits: List<SignedVoluntaryExit>;
}

export interface BeaconBlock {
  // Header
  slot: Slot;
  proposerIndex: ValidatorIndex;
  parentRoot: Root;
  stateRoot: Root;
  body: BeaconBlockBody;
}

export interface SignedBeaconBlock {
  message: BeaconBlock;
  signature: BLSSignature;
}

export interface BeaconState {
  // Misc
  genesisTime: Number64;
  genesisValidatorsRoot: Root;
  slot: Slot;
  fork: Fork; // For versioning hard forks

  // History
  latestBlockHeader: BeaconBlockHeader;
  blockRoots: Vector<Root>;
  stateRoots: Vector<Root>;
  historicalRoots: List<Root>;

  // Eth1
  eth1Data: Eth1Data;
  eth1DataVotes: List<Eth1Data>;
  eth1DepositIndex: Number64;

  // Registry
  validators: List<Validator>;
  balances: List<Number64>;

  // Shuffling
  randaoMixes: Vector<Bytes32>;

  // Slashings
  slashings: Vector<Gwei>; // Balances penalized at every withdrawal period

  // Attestations
  previousEpochAttestations: List<PendingAttestation>;
  currentEpochAttestations: List<PendingAttestation>;

  // Finality
  justificationBits: BitVector;
  previousJustifiedCheckpoint: Checkpoint;
  currentJustifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
}

export interface CommitteeAssignment {
  validators: List<ValidatorIndex>;
  committeeIndex: CommitteeIndex;
  slot: Slot;
}

export interface AggregateAndProof {
  aggregatorIndex: ValidatorIndex;
  aggregate: Attestation;
  selectionProof: BLSSignature;
}

export interface SignedAggregateAndProof {
  message: AggregateAndProof;
  signature: BLSSignature;
}

export interface Status {
  forkDigest: ForkDigest;
  finalizedRoot: Root;
  finalizedEpoch: Epoch;
  headRoot: Root;
  headSlot: Slot;
}

export type Goodbye = Uint64;

export type Ping = Uint64;

export interface Metadata {
  seqNumber: Uint64;
  attnets: AttestationSubnets;
}

export interface BeaconBlocksByRangeRequest {
  startSlot: Slot;
  count: Number64;
  step: Number64;
}

export type BeaconBlocksByRootRequest = List<Root>;

export interface Genesis {
  genesisTime: Uint64;
  genesisValidatorsRoot: Root;
  genesisForkVersion: Version;
}
