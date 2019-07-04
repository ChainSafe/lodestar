import {AnyContainerType, AnySSZType} from "@chainsafe/ssz";

export interface BeaconSSZTypes {
  // primitive
  bool: AnySSZType;
  bytes: AnySSZType;
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
  BLSPubkey: AnySSZType;
  BLSSignature: AnySSZType;
  // misc
  Fork: AnyContainerType;
  Crosslink: AnyContainerType;
  Eth1Data: AnyContainerType;
  AttestationData: AnyContainerType;
  AttestationDataAndCustodyBit: AnyContainerType;
  IndexedAttestation: AnyContainerType;
  DepositData: AnyContainerType;
  BeaconBlockHeader: AnyContainerType;
  Validator: AnyContainerType;
  PendingAttestation: AnyContainerType;
  HistoricalBatch: AnyContainerType;
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
}

export const typeNames: (keyof BeaconSSZTypes)[] = [
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
  "Crosslink",
  "Eth1Data",
  "AttestationData",
  "AttestationDataAndCustodyBit",
  "IndexedAttestation",
  "DepositData",
  "BeaconBlockHeader",
  "Validator",
  "PendingAttestation",
  "HistoricalBatch",
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
]
