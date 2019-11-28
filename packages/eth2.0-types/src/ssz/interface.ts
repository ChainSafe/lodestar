import {AnyContainerType, AnySSZType} from "@chainsafe/ssz-type-schema";
import * as t from "../types";

export interface IBeaconSSZTypes {
  // primitive
  bool: AnySSZType<t.bool>;
  bytes4: AnySSZType<t.bytes4>;
  bytes8: AnySSZType<t.bytes8>;
  bytes32: AnySSZType<t.bytes32>;
  bytes48: AnySSZType<t.bytes48>;
  bytes96: AnySSZType<t.bytes96>;
  uint8: AnySSZType<t.uint8>;
  uint16: AnySSZType<t.uint16>;
  uint24: AnySSZType<t.uint24>;
  number64: AnySSZType<t.number64>;
  uint64: AnySSZType<t.uint64>;
  uint256: AnySSZType<t.uint256>;
  Slot: AnySSZType<t.Slot>;
  Epoch: AnySSZType<t.Epoch>;
  Shard: AnySSZType<t.Shard>;
  ValidatorIndex: AnySSZType<t.ValidatorIndex>;
  Gwei: AnySSZType<t.Gwei>;
  Hash: AnySSZType<t.Hash>;
  Version: AnySSZType<t.Version>;
  BLSPubkey: AnySSZType<t.BLSPubkey>;
  BLSSignature: AnySSZType<t.BLSSignature>;
  // misc
  Fork: AnyContainerType<t.Fork>;
  Checkpoint: AnyContainerType<t.Checkpoint>;
  Validator: AnyContainerType<t.Validator>;
  Crosslink: AnyContainerType<t.Crosslink>;
  AttestationData: AnyContainerType<t.AttestationData>;
  AttestationDataAndCustodyBit: AnyContainerType<t.AttestationDataAndCustodyBit>;
  IndexedAttestation: AnyContainerType<t.IndexedAttestation>;
  PendingAttestation: AnyContainerType<t.PendingAttestation>;
  Eth1Data: AnyContainerType<t.Eth1Data>;
  HistoricalBatch: AnyContainerType<t.HistoricalBatch>;
  DepositData: AnyContainerType<t.DepositData>;
  CompactCommittee: AnyContainerType<t.CompactCommittee>;
  BeaconBlockHeader: AnyContainerType<t.BeaconBlockHeader>;
  FFGData: AnyContainerType<t.FFGData>;
  MerkleTree: AnyContainerType<t.MerkleTree>;
  // operations
  ProposerSlashing: AnyContainerType<t.ProposerSlashing>;
  AttesterSlashing: AnyContainerType<t.AttesterSlashing>;
  Attestation: AnyContainerType<t.Attestation>;
  Deposit: AnyContainerType<t.Deposit>;
  VoluntaryExit: AnyContainerType<t.VoluntaryExit>;
  Transfer: AnyContainerType<t.Transfer>;
  // block
  BeaconBlockBody: AnyContainerType<t.BeaconBlockBody>;
  BeaconBlock: AnyContainerType<t.BeaconBlock>;
  // state
  BeaconState: AnyContainerType<t.BeaconState>;
  // wire
  Hello: AnyContainerType<t.Hello>;
  Goodbye: AnyContainerType<t.Goodbye>;
  BeaconBlocksByRangeRequest: AnyContainerType<t.BeaconBlocksByRangeRequest>;
  BeaconBlocksByRangeResponse: AnyContainerType<t.BeaconBlocksByRangeResponse>;
  BeaconBlocksByRootRequest: AnyContainerType<t.BeaconBlocksByRootRequest>;
  BeaconBlocksByRootResponse: AnyContainerType<t.BeaconBlocksByRootResponse>;
}

export const typeNames: (keyof IBeaconSSZTypes)[] = [
  // primitive
  /*
  "bool",
  "bytes",
  "bytes4",
  "bytes8",
  "bytes32",
  "bytes48",
  "bytes96",
  "uint8",
  "uint16",
  "uint24",
  "number64",
  "uint64",
  "uint256",
  "Slot",
  "Epoch",
  "Shard",
  "ValidatorIndex",
  "Gwei",
  "BLSPubkey",
  "BLSSignature",
   */
  // misc
  "Fork",
  "Checkpoint",
  "Validator",
  "Crosslink",
  "AttestationData",
  "AttestationDataAndCustodyBit",
  "IndexedAttestation",
  "PendingAttestation",
  "Eth1Data",
  "HistoricalBatch",
  "DepositData",
  "CompactCommittee",
  "BeaconBlockHeader",
  "FFGData",
  "MerkleTree",
  // operations
  "ProposerSlashing",
  "AttesterSlashing",
  "Attestation",
  "Deposit",
  "VoluntaryExit",
  "Transfer",
  // block
  "BeaconBlockBody",
  "BeaconBlock",
  // state
  "BeaconState",
  // wire
  "Hello",
  "Goodbye",
  "BeaconBlocksByRangeRequest",
  "BeaconBlocksByRangeResponse",
  "BeaconBlocksByRootRequest",
  "BeaconBlocksByRootResponse",
];
