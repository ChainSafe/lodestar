import {AnyContainerType, AnySSZType} from "@chainsafe/ssz";

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
  Shard: AnySSZType;
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
  Crosslink: AnyContainerType;
  AttestationData: AnyContainerType;
  AttestationDataAndCustodyBit: AnyContainerType;
  IndexedAttestation: AnyContainerType;
  PendingAttestation: AnyContainerType;
  Eth1Data: AnyContainerType;
  HistoricalBatch: AnyContainerType;
  DepositData: AnyContainerType;
  CompactCommittee: AnyContainerType;
  BeaconBlockHeader: AnyContainerType;
  FFGData: AnyContainerType;
  MerkleTree: AnyContainerType;
  // operations
  ProposerSlashing: AnyContainerType;
  AttesterSlashing: AnyContainerType;
  Attestation: AnyContainerType;
  Deposit: AnyContainerType;
  VoluntaryExit: AnyContainerType;
  Transfer: AnyContainerType;
  // block
  BeaconBlockBody: AnyContainerType;
  BeaconBlock: AnyContainerType;
  // state
  BeaconState: AnyContainerType;
  // wire
  BlockRootSlot: AnyContainerType;
  WireRequest: AnyContainerType;
  WireResponse: AnyContainerType;
  Hello: AnyContainerType;
  Goodbye: AnyContainerType;
  Status: AnyContainerType;
  BeaconBlockRootsRequest: AnyContainerType;
  BeaconBlockRootsResponse: AnyContainerType;
  BeaconBlockHeadersRequest: AnyContainerType;
  BeaconBlockHeadersResponse: AnyContainerType;
  BeaconBlockBodiesRequest: AnyContainerType;
  BeaconBlockBodiesResponse: AnyContainerType;
  BeaconStatesRequest: AnyContainerType;
  BeaconStatesResponse: AnyContainerType;
  // for hobbits
  HobbitsHello: AnyContainerType;
  HobbitsStatus: AnyContainerType;
  HobbitsGetBlockHeaders: AnyContainerType;
  HobbitsGetBlockBodies: AnyContainerType;
  HobbitsBlockBodies: AnyContainerType;
  HobbitsGetAttestation: AnyContainerType;
  HobbitsAttestation: AnyContainerType;

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
  "BlockRootSlot",
  "WireRequest",
  "WireResponse",
  "Hello",
  "Goodbye",
  "Status",
  "BeaconBlockRootsRequest",
  "BeaconBlockRootsResponse",
  "BeaconBlockHeadersRequest",
  "BeaconBlockHeadersResponse",
  "BeaconBlockBodiesRequest",
  "BeaconBlockBodiesResponse",
  "BeaconStatesRequest",
  "BeaconStatesResponse",
  // for hobbits
  "HobbitsHello",
  "HobbitsStatus",
  "HobbitsGetBlockHeaders",
  "HobbitsGetBlockBodies",
  "HobbitsBlockBodies",
  "HobbitsGetAttestation",
  "HobbitsAttestation"
];
