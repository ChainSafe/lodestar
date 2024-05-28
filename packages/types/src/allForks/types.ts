import {ForkBlobs, ForkExecution, ForkLightClient, ForkName} from "@lodestar/params";
import {ts as phase0} from "../phase0/index.js";
import {ts as altair} from "../altair/index.js";
import {ts as bellatrix} from "../bellatrix/index.js";
import {ts as capella} from "../capella/index.js";
import {ts as deneb} from "../deneb/index.js";

type AllForkTypes = {
  [ForkName.phase0]: {
    BeaconBlock: phase0.BeaconBlock;
    BeaconBlockBody: phase0.BeaconBlockBody;
    BeaconState: phase0.BeaconState;
    SignedBeaconBlock: phase0.SignedBeaconBlock;
    Metadata: phase0.Metadata;
  };
  [ForkName.altair]: {
    BeaconBlock: altair.BeaconBlock;
    BeaconBlockBody: altair.BeaconBlockBody;
    BeaconState: altair.BeaconState;
    SignedBeaconBlock: altair.SignedBeaconBlock;
    Metadata: altair.Metadata;
    LightClientHeader: altair.LightClientHeader;
    LightClientBootstrap: altair.LightClientBootstrap;
    LightClientUpdate: altair.LightClientUpdate;
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate;
    LightClientStore: altair.LightClientStore;
  };
  [ForkName.bellatrix]: {
    BeaconBlock: bellatrix.BeaconBlock;
    BeaconBlockBody: bellatrix.BeaconBlockBody;
    BeaconState: bellatrix.BeaconState;
    SignedBeaconBlock: bellatrix.SignedBeaconBlock;
    Metadata: altair.Metadata;
    LightClientHeader: altair.LightClientHeader;
    LightClientBootstrap: altair.LightClientBootstrap;
    LightClientUpdate: altair.LightClientUpdate;
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate;
    LightClientStore: altair.LightClientStore;
    BlindedBeaconBlock: bellatrix.BlindedBeaconBlock;
    BlindedBeaconBlockBody: bellatrix.BlindedBeaconBlockBody;
    SignedBlindedBeaconBlock: bellatrix.SignedBlindedBeaconBlock;
    ExecutionPayload: bellatrix.ExecutionPayload;
    ExecutionPayloadHeader: bellatrix.ExecutionPayloadHeader;
    BuilderBid: bellatrix.BuilderBid;
    SignedBuilderBid: bellatrix.SignedBuilderBid;
    SSEPayloadAttributes: bellatrix.SSEPayloadAttributes;
  };
  [ForkName.capella]: {
    BeaconBlock: capella.BeaconBlock;
    BeaconBlockBody: capella.BeaconBlockBody;
    BeaconState: capella.BeaconState;
    SignedBeaconBlock: capella.SignedBeaconBlock;
    Metadata: altair.Metadata;
    LightClientHeader: capella.LightClientHeader;
    LightClientBootstrap: capella.LightClientBootstrap;
    LightClientUpdate: capella.LightClientUpdate;
    LightClientFinalityUpdate: capella.LightClientFinalityUpdate;
    LightClientStore: capella.LightClientStore;
    BlindedBeaconBlock: capella.BlindedBeaconBlock;
    BlindedBeaconBlockBody: capella.BlindedBeaconBlockBody;
    SignedBlindedBeaconBlock: capella.SignedBlindedBeaconBlock;
    ExecutionPayload: capella.ExecutionPayload;
    ExecutionPayloadHeader: capella.ExecutionPayloadHeader;
    BuilderBid: capella.BuilderBid;
    SignedBuilderBid: capella.SignedBuilderBid;
    SSEPayloadAttributes: capella.SSEPayloadAttributes;
  };
  [ForkName.deneb]: {
    BeaconBlock: deneb.BeaconBlock;
    BeaconBlockBody: deneb.BeaconBlockBody;
    BeaconState: deneb.BeaconState;
    SignedBeaconBlock: deneb.SignedBeaconBlock;
    Metadata: altair.Metadata;
    LightClientHeader: deneb.LightClientHeader;
    LightClientBootstrap: deneb.LightClientBootstrap;
    LightClientUpdate: deneb.LightClientUpdate;
    LightClientFinalityUpdate: deneb.LightClientFinalityUpdate;
    LightClientStore: deneb.LightClientStore;
    BlindedBeaconBlock: deneb.BlindedBeaconBlock;
    BlindedBeaconBlockBody: deneb.BlindedBeaconBlockBody;
    SignedBlindedBeaconBlock: deneb.SignedBlindedBeaconBlock;
    ExecutionPayload: deneb.ExecutionPayload;
    ExecutionPayloadHeader: deneb.ExecutionPayloadHeader;
    BuilderBid: deneb.BuilderBid;
    SignedBuilderBid: deneb.SignedBuilderBid;
    SSEPayloadAttributes: deneb.SSEPayloadAttributes;
    BlockContents: {block: BeaconBlock; kzgProofs: deneb.KZGProofs; blobs: deneb.Blobs};
    SignedBlockContents: {
      signedBlock: SignedBeaconBlock;
      kzgProofs: deneb.KZGProofs;
      blobs: deneb.Blobs;
    };
    ExecutionPayloadAndBlobsBundle: deneb.ExecutionPayloadAndBlobsBundle;
  };
};

export type FullOrBlinded = "full" | "blinded";

export type BeaconBlockBody<F extends ForkName = ForkName, B extends FullOrBlinded = "full"> = B extends "full"
  ? AllForkTypes[F]["BeaconBlockBody"]
  : F extends ForkExecution
    ? AllForkTypes[F]["BlindedBeaconBlockBody"]
    : never;

export type BeaconBlock<F extends ForkName = ForkName, B extends FullOrBlinded = "full"> = B extends "full"
  ? AllForkTypes[F]["BeaconBlock"]
  : F extends ForkExecution
    ? AllForkTypes[F]["BlindedBeaconBlock"]
    : never;

export type SignedBeaconBlock<F extends ForkName = ForkName, B extends FullOrBlinded = "full"> = B extends "full"
  ? AllForkTypes[F]["SignedBeaconBlock"]
  : F extends ForkExecution
    ? AllForkTypes[F]["SignedBlindedBeaconBlock"]
    : never;

export type BlockContents<
  F extends ForkBlobs = ForkBlobs,
  S extends "signed" | "unsigned" = "signed",
> = S extends "signed" ? AllForkTypes[F]["SignedBlockContents"] : AllForkTypes[F]["BlockContents"];

export type BeaconBlockOrContents<F extends ForkBlobs = ForkBlobs> =
  | BeaconBlock<F, "full">
  | BlockContents<F, "unsigned">;

export type SignedBeaconBlockOrContents<F extends ForkBlobs = ForkBlobs> =
  | SignedBeaconBlock<F, "full">
  | BlockContents<F, "signed">;

export type ExecutionPayload<
  F extends ForkExecution = ForkExecution,
  B extends FullOrBlinded = "full",
> = B extends "full" ? AllForkTypes[F]["ExecutionPayload"] : AllForkTypes[F]["ExecutionPayloadHeader"];

export type BeaconState<F extends ForkName = ForkName> = AllForkTypes[F]["BeaconState"];

export type Metadata<F extends ForkName = ForkName> = AllForkTypes[F]["Metadata"];

export type BuilderBid<
  F extends ForkExecution = ForkExecution,
  S extends "signed" | "unsigned" = "signed",
> = S extends "signed" ? AllForkTypes[F]["SignedBuilderBid"] : AllForkTypes[F]["BuilderBid"];

export type SSEPayloadAttributes<F extends ForkExecution = ForkExecution> = AllForkTypes[F]["SSEPayloadAttributes"];

export type LightClientHeader<F extends ForkLightClient = ForkLightClient> = AllForkTypes[F]["LightClientHeader"];

export type LightClientBootstrap<F extends ForkLightClient = ForkLightClient> = AllForkTypes[F]["LightClientBootstrap"];

export type LightClientUpdate<F extends ForkLightClient = ForkLightClient> = AllForkTypes[F]["LightClientUpdate"];

export type LightClientFinalityUpdate<F extends ForkLightClient = ForkLightClient> =
  AllForkTypes[F]["LightClientFinalityUpdate"];

export type LightClientStore<F extends ForkLightClient = ForkLightClient> = AllForkTypes[F]["LightClientStore"];

export type ExecutionPayloadAndBlobsBundle<F extends ForkBlobs = ForkBlobs> =
  AllForkTypes[F]["ExecutionPayloadAndBlobsBundle"];
