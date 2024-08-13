import {ContainerType, ListCompositeType, BitVectorType, ListBasicType} from "@chainsafe/ssz";
import {PTC_SIZE, MAX_PAYLOAD_ATTESTATIONS, EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as denebSsz} from "../deneb/index.js";

const {BLSSignature, Root, Slot, Uint8, ValidatorIndex, Gwei, Boolean, UintNum64} = primitiveSsz;

export const PayloadAttestationData = new ContainerType(
  {
    beaconBlockRoot: Root,
    slot: Slot,
    payload_status: Uint8,
  },
  {typeName: "PayloadAttestationData", jsonCase: "eth2"}
);

export const PayloadAttestation = new ContainerType(
  {
    aggregationBits: new BitVectorType(PTC_SIZE),
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  {typeName: "PayloadAttestation", jsonCase: "eth2"}
);
export const PayloadAttestations = new ListCompositeType(PayloadAttestation, MAX_PAYLOAD_ATTESTATIONS);

export const PayloadAttestationMessage = new ContainerType(
  {
    validator_index: ValidatorIndex,
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  {typeName: "PayloadAttestationMessage", jsonCase: "eth2"}
);

export const AttestingIndices = new ListBasicType(ValidatorIndex, PTC_SIZE);
export const IndexedPayloadAttestation = new ContainerType(
  {
    attestingIndices: AttestingIndices,
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  {typeName: "IndexedPayloadAttestation", jsonCase: "eth2"}
);

export const ExecutionPayload = new ContainerType(
  {
    ...denebSsz.ExecutionPayload.fields,
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    parentBlockHash: Root,
    parentBlockRoot: Root,
    blockHash: Root,
    gasLimit: UintNum64,
    builderIndex: ValidatorIndex,
    slot: Slot,
    value: Gwei,
    blobKzgCommitmentsRoot: Root,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const SignedExecutionPayloadHeader = new ContainerType(
  {
    message: ExecutionPayloadHeader,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadHeader", jsonCase: "eth2"}
);

export const ExecutionPayloadEnvelope = new ContainerType(
  {
    payload: ExecutionPayload,
    builderIndex: ValidatorIndex,
    beaconBlockRoot: Root,
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
    payloadWithheld: Boolean,
    stateRoot: Root,
  },
  {typeName: "ExecutionPayloadEnvelope", jsonCase: "eth2"}
);

export const SignedExecutionPayloadEnvelope = new ContainerType(
  {
    message: ExecutionPayloadEnvelope,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadEnvelope", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    // execution related fields pre epbs are removed and instead
    ...altairSsz.BeaconBlockBody.fields,
    blsToExecutionChanges: capellaSsz.BLSToExecutionChanges,
    signedExecutionPayloadHeader: SignedExecutionPayloadHeader, // [New in EIP-7732]
    payloadAttestations: new ListCompositeType(PayloadAttestation, MAX_PAYLOAD_ATTESTATIONS), // [New in EIP-7732]
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...denebSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in EPBS
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = BeaconBlockBody;

export const BlindedBeaconBlock = BeaconBlock;

export const SignedBlindedBeaconBlock = SignedBeaconBlock;

export const BuilderBid = ExecutionPayloadHeader;
export const SignedBuilderBid = SignedExecutionPayloadHeader;

export const ExecutionPayloadAndBlobsBundle = new ContainerType(
  {
    executionPayload: ExecutionPayload,
    blobsBundle: denebSsz.BlobsBundle,
  },
  {typeName: "ExecutionPayloadAndBlobsBundle", jsonCase: "eth2"}
);

export const BeaconState = new ContainerType(
  {
    ...capellaSsz.BeaconState.fields,
    latestExecutionPayloadHeader: ExecutionPayloadHeader,
    // TODO electra fields once rebased on electra
    latestBlockHash: Root, // [New in EIP-7732]
    latestFullSlot: Slot, // [New in EIP-7732]
    latestWithdrawalsRoot: Root, // [New in EIP-7732]
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const LightClientHeader = new ContainerType(
  {
    beacon: phase0Ssz.BeaconBlockHeader,
    execution: ExecutionPayloadHeader,
    executionBranch: capellaSsz.LightClientHeader.fields.executionBranch,
  },
  {typeName: "LightClientHeader", jsonCase: "eth2"}
);

export const LightClientBootstrap = new ContainerType(
  {
    header: LightClientHeader,
    currentSyncCommittee: altairSsz.SyncCommittee,
    currentSyncCommitteeBranch: altairSsz.LightClientBootstrap.fields.currentSyncCommitteeBranch,
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    nextSyncCommittee: altairSsz.SyncCommittee,
    nextSyncCommitteeBranch: altairSsz.LightClientUpdate.fields.nextSyncCommitteeBranch,
    finalizedHeader: LightClientHeader,
    finalityBranch: altairSsz.LightClientUpdate.fields.finalityBranch,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientUpdate", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    finalizedHeader: LightClientHeader,
    finalityBranch: altairSsz.LightClientFinalityUpdate.fields.finalityBranch,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientFinalityUpdate", jsonCase: "eth2"}
);

export const LightClientOptimisticUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientOptimisticUpdate", jsonCase: "eth2"}
);

export const LightClientStore = new ContainerType(
  {
    snapshot: LightClientBootstrap,
    validUpdates: new ListCompositeType(LightClientUpdate, EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH),
  },
  {typeName: "LightClientStore", jsonCase: "eth2"}
);

export const SSEPayloadAttributes = new ContainerType(
  {
    ...denebSsz.SSEPayloadAttributes.fields,
  },
  {typeName: "SSEPayloadAttributes", jsonCase: "eth2"}
);

export const BlockContents = new ContainerType(
  {
    block: BeaconBlock,
    kzgProofs: denebSsz.KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

export const SignedBlockContents = new ContainerType(
  {
    signedBlock: SignedBeaconBlock,
    kzgProofs: denebSsz.KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "SignedBlockContents", jsonCase: "eth2"}
);
