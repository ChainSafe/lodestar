import {ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {
  MAX_CONSOLIDATIONS,
  PENDING_BALANCE_DEPOSITS_LIMIT,
  PENDING_CONSOLIDATIONS_LIMIT,
  PENDING_PARTIAL_WITHDRAWALS_LIMIT,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as denebSsz} from "../deneb/index.js";

const {BLSSignature, Epoch, Gwei, ValidatorIndex, ExecutionAddress, BLSPubkey} = primitiveSsz;

export const ExecutionLayerWithdrawRequest = new ContainerType(
  {
    sourceAddress: ExecutionAddress,
    validatorPubkey: BLSPubkey,
    amount: Gwei,
  },
  {typeName: "ExecutionLayerWithdrawRequest", jsonCase: "eth2"}
);

export const ExecutionPayload = new ContainerType(
  {
    ...denebSsz.ExecutionPayload.fields,
    withdrawaRequests: new ListCompositeType(ExecutionLayerWithdrawRequest, 16), // TODO Electra: Pending finalizing the naming of this field and length limit
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadHeader.fields,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const Consolidation = new ContainerType(
  {
    sourceIndex: ValidatorIndex,
    targetIndex: ValidatorIndex,
    epoch: Epoch,
  },
  {typeName: "Consolidation", jsonCase: "eth2"}
);

export const SignedConsolidation = new ContainerType(
  {
    message: Consolidation,
    signature: BLSSignature,
  },
  {typeName: "SignedConsolidation", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload, // Modified in ELECTRA
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
    consolidations: new ListCompositeType(SignedConsolidation, MAX_CONSOLIDATIONS), // [New in Electra]
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...denebSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in ELECTRA
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

export const BlobSidecar = new ContainerType(
  {
    ...denebSsz.BlobSidecar.fields,
  },
  {typeName: "BlobSidecar", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = new ContainerType(
  {
    ...denebSsz.BlindedBeaconBlockBody.fields,
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    ...denebSsz.BlindedBeaconBlock.fields,
  },
  {typeName: "BlindedBeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = new ContainerType(
  {
    message: BlindedBeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlock", jsonCase: "eth2"}
);

export const BuilderBid = new ContainerType(
  {
    ...denebSsz.BuilderBid.fields,
  },
  {typeName: "BuilderBid", jsonCase: "eth2"}
);

export const SignedBuilderBid = new ContainerType(
  {
    message: BuilderBid,
    signature: BLSSignature,
  },
  {typeName: "SignedBuilderBid", jsonCase: "eth2"}
);

export const ExecutionPayloadAndBlobsBundle = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadAndBlobsBundle.fields,
  },
  {typeName: "ExecutionPayloadAndBlobsBundle", jsonCase: "eth2"}
);

export const PendingBalanceDeposit = new ContainerType(
  {
    index: ValidatorIndex,
    amount: Gwei,
  },
  {typeName: "PendingBalanceDeposit", jsonCase: "eth2"}
);

export const PartialWithdrawal = new ContainerType(
  {
    index: ValidatorIndex,
    amount: Gwei,
    withdrawableEpoch: Epoch,
  },
  {typeName: "PartialWithdrawal", jsonCase: "eth2"}
);

export const PendingConsolidation = new ContainerType(
  {
    sourceIndex: ValidatorIndex,
    targetIndex: ValidatorIndex,
  },
  {typeName: "PendingConsolidation", jsonCase: "eth2"}
);

// In EIP-7251, we spread deneb fields as new fields are appended at the end
export const BeaconState = new ContainerType(
  {
    ...denebSsz.BeaconState.fields,
    depositBalanceToConsume: Gwei, // [New in Electra]
    exitBalanceToConsume: Gwei, // [New in Electra]
    earliestExitEpoch: Epoch, // [New in Electra]
    consolidationBalanceToConsume: Gwei, // [New in Electra]
    earliestConsolidationEpoch: Epoch, // [New in Electra]
    pendingBalanceDeposits: new ListCompositeType(PendingBalanceDeposit, PENDING_BALANCE_DEPOSITS_LIMIT), // [New in Electra]
    pendingPartialWithdrawals: new ListCompositeType(PartialWithdrawal, PENDING_PARTIAL_WITHDRAWALS_LIMIT), // [New in Electra]
    pendingConsolidations: new ListCompositeType(PendingConsolidation, PENDING_CONSOLIDATIONS_LIMIT), // [New in Electra]
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const LightClientHeader = new ContainerType(
  {
    ...denebSsz.LightClientHeader.fields,
  },
  {typeName: "LightClientHeader", jsonCase: "eth2"}
);

export const LightClientBootstrap = new ContainerType(
  {
    ...denebSsz.LightClientBootstrap.fields,
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = new ContainerType(
  {
    ...denebSsz.LightClientUpdate.fields,
  },
  {typeName: "LightClientUpdate", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = new ContainerType(
  {
    ...denebSsz.LightClientFinalityUpdate.fields,
  },
  {typeName: "LightClientFinalityUpdate", jsonCase: "eth2"}
);

export const LightClientOptimisticUpdate = new ContainerType(
  {
    ...denebSsz.LightClientOptimisticUpdate.fields,
  },
  {typeName: "LightClientOptimisticUpdate", jsonCase: "eth2"}
);

export const LightClientStore = new ContainerType(
  {
    ...denebSsz.LightClientStore.fields,
  },
  {typeName: "LightClientStore", jsonCase: "eth2"}
);

export const SSEPayloadAttributes = new ContainerType(
  {
    ...denebSsz.SSEPayloadAttributes.fields,
  },
  {typeName: "SSEPayloadAttributes", jsonCase: "eth2"}
);
