import {ContainerType} from "@chainsafe/ssz";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as denebSsz} from "../deneb/index.js";

const {BLSSignature} = primitiveSsz;

export const ExecutionPayload = new ContainerType(
  {
    ...denebSsz.ExecutionPayload.fields,
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadHeader.fields,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    ...denebSsz.BeaconBlockBody.fields,
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...denebSsz.BeaconBlock.fields,
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

export const BeaconState = new ContainerType(
  {
    ...denebSsz.BeaconState.fields,
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
