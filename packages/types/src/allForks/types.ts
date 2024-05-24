import {CompositeType, ContainerType, ValueOf, CompositeView, CompositeViewDU} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ts as phase0} from "../phase0/index.js";
import {ts as altair} from "../altair/index.js";
import {ts as bellatrix} from "../bellatrix/index.js";
import {ts as capella} from "../capella/index.js";
import {ts as deneb} from "../deneb/index.js";

import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as denebSsz} from "../deneb/index.js";

export type AllForks = ForkName[number];
export type ExecutionForks = ForkName.bellatrix | ForkName.capella;
export type LightClientForks = ForkName.altair | ForkName.capella | ForkName.deneb;
export type BlobsForks = ForkName.deneb;

/**
 * An AllForks type must accept as any parameter the UNION of all fork types.
 * The generic argument of `AllForksTypeOf` must be the union of the fork types:
 *
 *
 * For example, `allForks.BeaconState.defaultValue()` must return
 * ```
 * phase0.BeaconState | altair.BeaconState | bellatrix.BeaconState
 * ```
 *
 * And `allForks.BeaconState.serialize()` must accept as parameter
 * ```
 * phase0.BeaconState | altair.BeaconState | bellatrix.BeaconState
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AllForksTypeOf<UnionOfForkTypes extends ContainerType<any>> = CompositeType<
  ValueOf<UnionOfForkTypes>,
  CompositeView<UnionOfForkTypes>,
  CompositeViewDU<UnionOfForkTypes>
>;

/**
 * SSZ Types known to change between forks.
 *
 * Re-wrapping a union of fields in a new ContainerType allows to pass a generic block to .serialize()
 * - .serialize() requires a value with ONLY the common fork fields
 * - .deserialize() and ValueOf return a value with ONLY the general fork fields
 */
export type AllForksSSZTypes = {
  BeaconBlockBody: AllForksTypeOf<
    | typeof phase0Ssz.BeaconBlockBody
    | typeof altairSsz.BeaconBlockBody
    | typeof bellatrixSsz.BeaconBlockBody
    | typeof capellaSsz.BeaconBlockBody
    | typeof denebSsz.BeaconBlockBody
  >;
  BeaconBlock: AllForksTypeOf<
    | typeof phase0Ssz.BeaconBlock
    | typeof altairSsz.BeaconBlock
    | typeof bellatrixSsz.BeaconBlock
    | typeof capellaSsz.BeaconBlock
    | typeof denebSsz.BeaconBlock
  >;
  SignedBeaconBlock: AllForksTypeOf<
    | typeof phase0Ssz.SignedBeaconBlock
    | typeof altairSsz.SignedBeaconBlock
    | typeof bellatrixSsz.SignedBeaconBlock
    | typeof capellaSsz.SignedBeaconBlock
    | typeof denebSsz.SignedBeaconBlock
  >;
  BeaconState: AllForksTypeOf<
    | typeof phase0Ssz.BeaconState
    | typeof altairSsz.BeaconState
    | typeof bellatrixSsz.BeaconState
    | typeof capellaSsz.BeaconState
    | typeof denebSsz.BeaconState
  >;
  Metadata: AllForksTypeOf<typeof phase0Ssz.Metadata | typeof altairSsz.Metadata>;
};

export type AllForksExecutionSSZTypes = {
  BeaconBlockBody: AllForksTypeOf<
    typeof bellatrixSsz.BeaconBlockBody | typeof capellaSsz.BeaconBlockBody | typeof denebSsz.BeaconBlockBody
  >;
  BeaconBlock: AllForksTypeOf<
    typeof bellatrixSsz.BeaconBlock | typeof capellaSsz.BeaconBlock | typeof denebSsz.BeaconBlock
  >;
  SignedBeaconBlock: AllForksTypeOf<
    typeof bellatrixSsz.SignedBeaconBlock | typeof capellaSsz.SignedBeaconBlock | typeof denebSsz.SignedBeaconBlock
  >;
  BeaconState: AllForksTypeOf<
    typeof bellatrixSsz.BeaconState | typeof capellaSsz.BeaconState | typeof denebSsz.BeaconState
  >;
  ExecutionPayload: AllForksTypeOf<
    typeof bellatrixSsz.ExecutionPayload | typeof capellaSsz.ExecutionPayload | typeof denebSsz.ExecutionPayload
  >;
  ExecutionPayloadHeader: AllForksTypeOf<
    | typeof bellatrixSsz.ExecutionPayloadHeader
    | typeof capellaSsz.ExecutionPayloadHeader
    | typeof denebSsz.ExecutionPayloadHeader
  >;
  BuilderBid: AllForksTypeOf<
    typeof bellatrixSsz.BuilderBid | typeof capellaSsz.BuilderBid | typeof denebSsz.BuilderBid
  >;
  SignedBuilderBid: AllForksTypeOf<
    typeof bellatrixSsz.SignedBuilderBid | typeof capellaSsz.SignedBuilderBid | typeof denebSsz.SignedBuilderBid
  >;
  SSEPayloadAttributes: AllForksTypeOf<
    | typeof bellatrixSsz.SSEPayloadAttributes
    | typeof capellaSsz.SSEPayloadAttributes
    | typeof denebSsz.SSEPayloadAttributes
  >;
};

export type AllForksBlindedSSZTypes = {
  BeaconBlockBody: AllForksTypeOf<
    | typeof bellatrixSsz.BlindedBeaconBlockBody
    | typeof capellaSsz.BlindedBeaconBlock
    | typeof denebSsz.BlindedBeaconBlock
  >;
  BeaconBlock: AllForksTypeOf<
    typeof bellatrixSsz.BlindedBeaconBlock | typeof capellaSsz.BlindedBeaconBlock | typeof denebSsz.BlindedBeaconBlock
  >;
  SignedBeaconBlock: AllForksTypeOf<
    | typeof bellatrixSsz.SignedBlindedBeaconBlock
    | typeof capellaSsz.SignedBlindedBeaconBlock
    | typeof denebSsz.SignedBlindedBeaconBlock
  >;
};

export type AllForksLightClientSSZTypes = {
  BeaconBlock: AllForksTypeOf<
    | typeof altairSsz.BeaconBlock
    | typeof bellatrixSsz.BeaconBlock
    | typeof capellaSsz.BeaconBlock
    | typeof denebSsz.BeaconBlock
  >;
  BeaconBlockBody: AllForksTypeOf<
    | typeof altairSsz.BeaconBlockBody
    | typeof bellatrixSsz.BeaconBlockBody
    | typeof capellaSsz.BeaconBlockBody
    | typeof denebSsz.BeaconBlockBody
  >;
  LightClientHeader: AllForksTypeOf<
    typeof altairSsz.LightClientHeader | typeof capellaSsz.LightClientHeader | typeof denebSsz.LightClientHeader
  >;
  LightClientBootstrap: AllForksTypeOf<
    | typeof altairSsz.LightClientBootstrap
    | typeof capellaSsz.LightClientBootstrap
    | typeof denebSsz.LightClientBootstrap
  >;
  LightClientUpdate: AllForksTypeOf<
    typeof altairSsz.LightClientUpdate | typeof capellaSsz.LightClientUpdate | typeof denebSsz.LightClientUpdate
  >;
  LightClientFinalityUpdate: AllForksTypeOf<
    | typeof altairSsz.LightClientFinalityUpdate
    | typeof capellaSsz.LightClientFinalityUpdate
    | typeof denebSsz.LightClientFinalityUpdate
  >;
  LightClientOptimisticUpdate: AllForksTypeOf<
    | typeof altairSsz.LightClientOptimisticUpdate
    | typeof capellaSsz.LightClientOptimisticUpdate
    | typeof denebSsz.LightClientOptimisticUpdate
  >;
  LightClientStore: AllForksTypeOf<
    typeof altairSsz.LightClientStore | typeof capellaSsz.LightClientStore | typeof denebSsz.LightClientStore
  >;
};

export type AllForksBlobsSSZTypes = {
  BlobSidecar: AllForksTypeOf<typeof denebSsz.BlobSidecar>;
  ExecutionPayloadAndBlobsBundle: AllForksTypeOf<typeof denebSsz.ExecutionPayloadAndBlobsBundle>;
};

type AllForkTypes = {
  [ForkName.phase0]: {
    BeaconBlockBody: phase0.BeaconBlockBody;
    BeaconState: phase0.BeaconState;
    SignedBeaconBlock: phase0.SignedBeaconBlock;
    Metadata: phase0.Metadata;
  };
  [ForkName.altair]: {
    BeaconBlockBody: altair.BeaconBlockBody;
    BeaconState: altair.BeaconState;
    SignedBeaconBlock: altair.SignedBeaconBlock;
    Metadata: altair.Metadata;
  };
  [ForkName.bellatrix]: {
    BeaconBlockBody: bellatrix.BeaconBlockBody;
    BeaconState: bellatrix.BeaconState;
    SignedBeaconBlock: bellatrix.SignedBeaconBlock;
    Metadata: altair.Metadata;
  };
  [ForkName.capella]: {
    BeaconBlockBody: capella.BeaconBlockBody;
    BeaconState: capella.BeaconState;
    SignedBeaconBlock: capella.SignedBeaconBlock;
    Metadata: altair.Metadata;
  };
  [ForkName.deneb]: {
    BeaconBlockBody: deneb.BeaconBlockBody;
    BeaconState: deneb.BeaconState;
    SignedBeaconBlock: deneb.SignedBeaconBlock;
    Metadata: altair.Metadata;
  };
};

type AltairOnwardForkTypes = {
  [ForkName.altair]: {
    LightClientHeader: altair.LightClientHeader;
    LightClientBootstrap: altair.LightClientBootstrap;
    LightClientUpdate: altair.LightClientUpdate;
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate;
    LightClientStore: altair.LightClientStore;
  };
  [ForkName.bellatrix]: {
    LightClientHeader: altair.LightClientHeader;
    LightClientBootstrap: altair.LightClientBootstrap;
    LightClientUpdate: altair.LightClientUpdate;
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate;
    LightClientStore: altair.LightClientStore;
  };
  [ForkName.capella]: {
    LightClientHeader: capella.LightClientHeader;
    LightClientBootstrap: capella.LightClientBootstrap;
    LightClientUpdate: capella.LightClientUpdate;
    LightClientFinalityUpdate: capella.LightClientFinalityUpdate;
    LightClientStore: capella.LightClientStore;
  };
  [ForkName.deneb]: {
    LightClientHeader: deneb.LightClientHeader;
    LightClientBootstrap: deneb.LightClientBootstrap;
    LightClientUpdate: deneb.LightClientUpdate;
    LightClientFinalityUpdate: deneb.LightClientFinalityUpdate;
    LightClientStore: deneb.LightClientStore;
  };
};

type BellatrixOnwardForkTypes = {
  [ForkName.bellatrix]: {
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
    BlindedBeaconBlock: deneb.BlindedBeaconBlock;
    BlindedBeaconBlockBody: deneb.BlindedBeaconBlockBody;
    SignedBlindedBeaconBlock: deneb.SignedBlindedBeaconBlock;
    ExecutionPayload: deneb.ExecutionPayload;
    ExecutionPayloadHeader: deneb.ExecutionPayloadHeader;
    BuilderBid: deneb.BuilderBid;
    SignedBuilderBid: deneb.SignedBuilderBid;
    SSEPayloadAttributes: deneb.SSEPayloadAttributes;
  };
};

type DenebOnwardForkTypes = {
  [ForkName.deneb]: {
    BlockContents: {block: BeaconBlock; kzgProofs: deneb.KZGProofs; blobs: deneb.Blobs};
    SignedBlockContents: {
      signedBlock: SignedBeaconBlock;
      kzgProofs: deneb.KZGProofs;
      blobs: deneb.Blobs;
    };
    ExecutionPayloadAndBlobsBundle: deneb.ExecutionPayloadAndBlobsBundle;
  };
};

export type BlindedOrFull = "full" | "blinded";

export type BeaconBlockBody<F extends ForkName = ForkName, B extends BlindedOrFull = "full"> = B extends "full"
  ? AllForkTypes[F]["BeaconBlockBody"]
  : F extends keyof BellatrixOnwardForkTypes
    ? BellatrixOnwardForkTypes[F]["BlindedBeaconBlockBody"]
    : never;

export type BeaconBlock<F extends ForkName = ForkName, B extends BlindedOrFull = "full"> = B extends "full"
  ? AllForkTypes[F]["BeaconBlockBody"]
  : F extends keyof BellatrixOnwardForkTypes
    ? BellatrixOnwardForkTypes[F]["BlindedBeaconBlock"]
    : never;

export type SignedBeaconBlock<F extends ForkName = ForkName, B extends BlindedOrFull = "full"> = B extends "full"
  ? AllForkTypes[F]["SignedBeaconBlock"]
  : F extends keyof BellatrixOnwardForkTypes
    ? BellatrixOnwardForkTypes[F]["SignedBlindedBeaconBlock"]
    : never;

export type BeaconState<F extends ForkName> = AllForkTypes[F]["BeaconState"];

export type Metadata<F extends ForkName> = AllForkTypes[F]["Metadata"];

export type ExecutionPayload<F extends keyof BellatrixOnwardForkTypes> =
  BellatrixOnwardForkTypes[F]["ExecutionPayload"];

export type ExecutionPayloadHeader<F extends keyof BellatrixOnwardForkTypes> =
  BellatrixOnwardForkTypes[F]["ExecutionPayloadHeader"];

export type BuilderBid<F extends keyof BellatrixOnwardForkTypes, S extends "signed" | "unsigned"> = S extends "signed"
  ? BellatrixOnwardForkTypes[F]["SignedBuilderBid"]
  : BellatrixOnwardForkTypes[F]["BuilderBid"];

export type SSEPayloadAttributes<F extends keyof BellatrixOnwardForkTypes> =
  BellatrixOnwardForkTypes[F]["SSEPayloadAttributes"];

export type LightClientHeader<F extends keyof AltairOnwardForkTypes> = AltairOnwardForkTypes[F]["LightClientHeader"];

export type LightClientBootstrap<F extends keyof AltairOnwardForkTypes> =
  AltairOnwardForkTypes[F]["LightClientBootstrap"];

export type LightClientUpdate<F extends keyof AltairOnwardForkTypes> = AltairOnwardForkTypes[F]["LightClientUpdate"];

export type LightClientFinalityUpdate<F extends keyof AltairOnwardForkTypes> =
  AltairOnwardForkTypes[F]["LightClientFinalityUpdate"];

export type LightClientStore<F extends keyof AltairOnwardForkTypes> = AltairOnwardForkTypes[F]["LightClientStore"];

export type BlockContents<F extends keyof DenebOnwardForkTypes, S extends "signed" | "unsigned"> = S extends "signed"
  ? DenebOnwardForkTypes[F]["SignedBlockContents"]
  : DenebOnwardForkTypes[F]["BlockContents"];

export type BeaconBlockOrContents<F extends keyof DenebOnwardForkTypes> =
  | BeaconBlock<F, "full">
  | BlockContents<F, "unsigned">;

export type SignedBeaconBlockOrContents<F extends keyof DenebOnwardForkTypes> =
  | SignedBeaconBlock<F, "full">
  | BlockContents<F, "signed">;

export type ExecutionPayloadAndBlobsBundle<F extends keyof DenebOnwardForkTypes> =
  DenebOnwardForkTypes[F]["ExecutionPayloadAndBlobsBundle"];
