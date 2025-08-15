import {BitVectorType, ContainerType, ListBasicType, ListCompositeType, VectorCompositeType} from "@chainsafe/ssz";
import {
  BUILDER_PENDING_WITHDRAWALS_LIMIT,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  MAX_PAYLOAD_ATTESTATIONS,
  PTC_SIZE,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@lodestar/params";

import {ssz as altairSsz} from "../altair/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as denebSsz} from "../deneb/index.js";
import {ssz as electraSsz} from "../electra/index.js";
import {ssz as fuluSsz} from "../fulu/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";
// biome-ignore lint/suspicious/noShadowRestrictedNames: We explicitly want `Boolean` name to be imported
import {BLSSignature, Boolean, Epoch, ExecutionAddress, Gwei} from "../sszTypes.js";

const {Root, Bytes32, Slot, UintNum64, ValidatorIndex} = primitiveSsz;

export const BuilderPendingWithdrawal = new ContainerType(
  {
    feeRecipient: ExecutionAddress,
    amount: Gwei,
    builderIndex: ValidatorIndex,
    withdrawableEpoch: Epoch,
  },
  {typeName: "BuilderPendingWithdrawal", jsonCase: "eth2"}
);

export const BuilderPendingPayment = new ContainerType(
  {
    weight: Gwei,
    withdrawal: BuilderPendingWithdrawal,
  },
  {typeName: "BuilderPendingPayment", jsonCase: "eth2"}
);

export const PayloadAttestationData = new ContainerType(
  {
    beaconBlockRoot: Root,
    slot: Slot,
    payloadPresent: Boolean,
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

export const PayloadAttestationMessage = new ContainerType(
  {
    validatorIndex: ValidatorIndex,
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  {typeName: "PayloadAttestationMessage", jsonCase: "eth2"}
);

export const IndexedPayloadAttestation = new ContainerType(
  {
    attestingIndices: new ListBasicType(ValidatorIndex, PTC_SIZE),
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  {typeName: "IndexedPayloadAttestation", jsonCase: "eth2"}
);

export const SignedExecutionPayloadHeader = new ContainerType(
  {
    message: electraSsz.ExecutionPayloadHeader,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadHeader", jsonCase: "eth2"}
);

export const ExecutionPayloadEnvelope = new ContainerType(
  {
    payload: electraSsz.ExecutionPayload,
    executionRequests: electraSsz.ExecutionRequests,
    builderIndex: ValidatorIndex,
    beaconBlockRoot: Root,
    slot: Slot,
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
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

// We are removing fields
export const BeaconBlockBody = new ContainerType(
  {
    randaoReveal: phase0Ssz.BeaconBlockBody.fields.randaoReveal,
    eth1Data: phase0Ssz.BeaconBlockBody.fields.eth1Data,
    graffiti: phase0Ssz.BeaconBlockBody.fields.graffiti,
    proposerSlashings: phase0Ssz.BeaconBlockBody.fields.proposerSlashings,
    attesterSlashings: new ListCompositeType(electraSsz.AttesterSlashing, MAX_ATTESTER_SLASHINGS_ELECTRA), // Modified in ELECTRA
    attestations: new ListCompositeType(electraSsz.Attestation, MAX_ATTESTATIONS_ELECTRA), // Modified in ELECTRA
    deposits: phase0Ssz.BeaconBlockBody.fields.deposits,
    voluntaryExits: phase0Ssz.BeaconBlockBody.fields.voluntaryExits,
    syncAggregate: altairSsz.BeaconBlockBody.fields.syncAggregate,
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    signedExecutionPayloadHeader: SignedExecutionPayloadHeader,
    payloadAttestation: new ListCompositeType(PayloadAttestation, MAX_PAYLOAD_ATTESTATIONS),
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...fuluSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in EIP7732
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // Modified in EIP7732
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    parentBlockHash: Bytes32,
    parentBlockRoot: Root,
    blockHash: Bytes32,
    feeRecipient: ExecutionAddress,
    gasLimit: UintNum64,
    builderIndex: ValidatorIndex,
    slot: Slot,
    value: Gwei,
    blobKzgCommitmentsRoot: Root,
  },
  {typeName: "ExeuctionPayloadHeader", jsonCase: "eth2"}
);

export const BeaconState = new ContainerType(
  {
    ...fuluSsz.BeaconState.fields,
    executionPayloadAvailability: new BitVectorType(SLOTS_PER_HISTORICAL_ROOT),
    builderPendingPayments: new VectorCompositeType(BuilderPendingPayment, 2 * SLOTS_PER_EPOCH),
    builderPendingWithdrawals: new ListCompositeType(BuilderPendingWithdrawal, BUILDER_PENDING_WITHDRAWALS_LIMIT),
    latestBlockHash: Bytes32,
    latestWithdrawalRoot: Root,
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);
