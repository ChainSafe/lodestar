import {AnyContainerType, AnySSZType} from "@chainsafe/ssz-type-schema";

export interface IBeaconSSZTypes {
  // primitive
  bool: AnySSZType;
  bytes4: AnySSZType;
  bytes8: AnySSZType;
  bytes32: AnySSZType;
  bytes48: AnySSZType;
  bytes96: AnySSZType;
  uint8: AnySSZType;
  uint16: AnySSZType;
  uint24: AnySSZType;
  number64: AnySSZType;
  uint64: AnySSZType;
  uint256: AnySSZType;
  Slot: AnySSZType;
  Epoch: AnySSZType;
  CommitteeIndex: AnySSZType;
  ValidatorIndex: AnySSZType;
  Gwei: AnySSZType;
  Hash: AnySSZType;
  Version: AnySSZType;
  BLSPubkey: AnySSZType;
  BLSSignature: AnySSZType;
  // misc
  Fork: AnyContainerType;
  Checkpoint: AnyContainerType;
  Validator: AnyContainerType;
  AttestationData: AnyContainerType;
  IndexedAttestation: AnyContainerType;
  PendingAttestation: AnyContainerType;
  Eth1Data: AnyContainerType;
  HistoricalBatch: AnyContainerType;
  DepositData: AnyContainerType;
  BeaconBlockHeader: AnyContainerType;
  FFGData: AnyContainerType;
  MerkleTree: AnyContainerType;
  // operations
  ProposerSlashing: AnyContainerType;
  AttesterSlashing: AnyContainerType;
  Attestation: AnyContainerType;
  Deposit: AnyContainerType;
  VoluntaryExit: AnyContainerType;
  // block
  BeaconBlockBody: AnyContainerType;
  BeaconBlock: AnyContainerType;
  // state
  BeaconState: AnyContainerType;
  // wire
  Hello: AnyContainerType;
  Goodbye: AnyContainerType;
  BeaconBlocksByRangeRequest: AnyContainerType;
  BeaconBlocksByRangeResponse: AnyContainerType;
  BeaconBlocksByRootRequest: AnyContainerType;
  BeaconBlocksByRootResponse: AnyContainerType;
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
  "CommitteeIndex",
  "ValidatorIndex",
  "Gwei",
  "BLSPubkey",
  "BLSSignature",
   */
  // misc
  "Fork",
  "Checkpoint",
  "Validator",
  "AttestationData",
  "IndexedAttestation",
  "PendingAttestation",
  "Eth1Data",
  "HistoricalBatch",
  "DepositData",
  "BeaconBlockHeader",
  "FFGData",
  "MerkleTree",
  // operations
  "ProposerSlashing",
  "AttesterSlashing",
  "Attestation",
  "Deposit",
  "VoluntaryExit",
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
