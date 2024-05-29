import {CompositeType, CompositeView, CompositeViewDU, ContainerType, ValueOf} from "@chainsafe/ssz";
import {ForkAll, ForkBlobs, ForkExecution, ForkLightClient, ForkName} from "@lodestar/params";
import {ts as phase0} from "./phase0/index.js";
import {ts as altair} from "./altair/index.js";
import {ts as bellatrix} from "./bellatrix/index.js";
import {ts as capella} from "./capella/index.js";
import {ts as deneb} from "./deneb/index.js";
import {Slot} from "./primitive/types.js";
import {allForks} from "./sszTypes.js";

export * from "./primitive/types.js";
export {ts as phase0} from "./phase0/index.js";
export {ts as altair} from "./altair/index.js";
export {ts as bellatrix} from "./bellatrix/index.js";
export {ts as capella} from "./capella/index.js";
export {ts as deneb} from "./deneb/index.js";

/** Common non-spec type to represent roots as strings */
export type RootHex = string;

/** Handy enum to represent the block production source */
export enum ProducedBlockSource {
  builder = "builder",
  engine = "engine",
}

export type SlotRootHex = {slot: Slot; root: RootHex};
export type SlotOptionalRoot = {slot: Slot; root?: RootHex};

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

type TypesByFork = {
  [ForkName.phase0]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: phase0.BeaconBlock;
    BeaconBlockBody: phase0.BeaconBlockBody;
    BeaconState: phase0.BeaconState;
    SignedBeaconBlock: phase0.SignedBeaconBlock;
    Metadata: phase0.Metadata;
  };
  [ForkName.altair]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: altair.BeaconBlock;
    BeaconBlockBody: altair.BeaconBlockBody;
    BeaconState: altair.BeaconState;
    SignedBeaconBlock: altair.SignedBeaconBlock;
    Metadata: altair.Metadata;
    LightClientHeader: altair.LightClientHeader;
    LightClientBootstrap: altair.LightClientBootstrap;
    LightClientUpdate: altair.LightClientUpdate;
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate;
    LightClientOptimisticUpdate: altair.LightClientOptimisticUpdate;
    LightClientStore: altair.LightClientStore;
  };
  [ForkName.bellatrix]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: bellatrix.BeaconBlock;
    BeaconBlockBody: bellatrix.BeaconBlockBody;
    BeaconState: bellatrix.BeaconState;
    SignedBeaconBlock: bellatrix.SignedBeaconBlock;
    Metadata: altair.Metadata;
    LightClientHeader: altair.LightClientHeader;
    LightClientBootstrap: altair.LightClientBootstrap;
    LightClientUpdate: altair.LightClientUpdate;
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate;
    LightClientOptimisticUpdate: altair.LightClientOptimisticUpdate;
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
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: capella.BeaconBlock;
    BeaconBlockBody: capella.BeaconBlockBody;
    BeaconState: capella.BeaconState;
    SignedBeaconBlock: capella.SignedBeaconBlock;
    Metadata: altair.Metadata;
    LightClientHeader: capella.LightClientHeader;
    LightClientBootstrap: capella.LightClientBootstrap;
    LightClientUpdate: capella.LightClientUpdate;
    LightClientFinalityUpdate: capella.LightClientFinalityUpdate;
    LightClientOptimisticUpdate: capella.LightClientOptimisticUpdate;
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
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: deneb.BeaconBlock;
    BeaconBlockBody: deneb.BeaconBlockBody;
    BeaconState: deneb.BeaconState;
    SignedBeaconBlock: deneb.SignedBeaconBlock;
    Metadata: altair.Metadata;
    LightClientHeader: deneb.LightClientHeader;
    LightClientBootstrap: deneb.LightClientBootstrap;
    LightClientUpdate: deneb.LightClientUpdate;
    LightClientFinalityUpdate: deneb.LightClientFinalityUpdate;
    LightClientOptimisticUpdate: deneb.LightClientOptimisticUpdate;
    LightClientStore: deneb.LightClientStore;
    BlindedBeaconBlock: deneb.BlindedBeaconBlock;
    BlindedBeaconBlockBody: deneb.BlindedBeaconBlockBody;
    SignedBlindedBeaconBlock: deneb.SignedBlindedBeaconBlock;
    ExecutionPayload: deneb.ExecutionPayload;
    ExecutionPayloadHeader: deneb.ExecutionPayloadHeader;
    BuilderBid: deneb.BuilderBid;
    SignedBuilderBid: deneb.SignedBuilderBid;
    SSEPayloadAttributes: deneb.SSEPayloadAttributes;
    BlockContents: {block: BeaconBlock<ForkBlobs>; kzgProofs: deneb.KZGProofs; blobs: deneb.Blobs};
    SignedBlockContents: {
      signedBlock: SignedBeaconBlock<ForkBlobs>;
      kzgProofs: deneb.KZGProofs;
      blobs: deneb.Blobs;
    };
    ExecutionPayloadAndBlobsBundle: deneb.ExecutionPayloadAndBlobsBundle;
    BlobsBundle: deneb.BlobsBundle;
    Contents: deneb.Contents;
  };
};

type SSZTypesByFork = {
  [F in keyof typeof allForks]: {
    [T in keyof (typeof allForks)[F]]: (typeof allForks)[F][T];
  };
};

type SSZBlindedTypesByFork = {
  bellatrix: {
    BeaconBlockBody: (typeof allForks)["bellatrix"]["BlindedBeaconBlockBody"];
    BeaconBlock: (typeof allForks)["bellatrix"]["BlindedBeaconBlock"];
    SignedBeaconBlock: (typeof allForks)["bellatrix"]["SignedBlindedBeaconBlock"];
  };
  capella: {
    BeaconBlockBody: (typeof allForks)["capella"]["BlindedBeaconBlockBody"];
    BeaconBlock: (typeof allForks)["bellatrix"]["BlindedBeaconBlock"];
    SignedBeaconBlock: (typeof allForks)["bellatrix"]["SignedBlindedBeaconBlock"];
  };
  deneb: {
    BeaconBlockBody: (typeof allForks)["deneb"]["BlindedBeaconBlockBody"];
    BeaconBlock: (typeof allForks)["deneb"]["BlindedBeaconBlock"];
    SignedBeaconBlock: (typeof allForks)["deneb"]["SignedBlindedBeaconBlock"];
  };
};

export type TypesFor<F extends ForkName, K extends keyof TypesByFork[F] | void = void> = K extends void
  ? TypesByFork[F]
  : TypesByFork[F][Exclude<K, void>];

export type SSZTypesFor<F extends ForkName, K extends keyof SSZTypesByFork[F] | void = void> = K extends void
  ? // It compiles fine, need to debug the error
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    {[K2 in keyof SSZTypesByFork[F]]: AllForksTypeOf<SSZTypesByFork[F][K2]>}
  : // It compiles fine, need to debug the error
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    AllForksTypeOf<SSZTypesByFork[F][Exclude<K, void>]>;

export type SSZInstanceTypesFor<F extends ForkName, K extends keyof SSZTypesByFork[F]> = CompositeViewDU<
  // It compiles fine, need to debug the error
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  SSZTypesByFork[F][K]
>;

export type SSZBlindedTypesFor<
  F extends ForkExecution,
  K extends keyof SSZBlindedTypesByFork[F] | void = void,
> = K extends void
  ? // It compiles fine, need to debug the error
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    {[K2 in keyof SSZTypesByFork[F]]: AllForksTypeOf<SSZBlindedTypesByFork[F][K2]>}
  : // It compiles fine, need to debug the error
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    AllForksTypeOf<SSZBlindedTypesByFork[F][Exclude<K, void>]>;

export type FullOrBlinded = "full" | "blinded";
export type SignedUnsigned = "signed" | "unsigned";

export type BeaconBlockHeader<F extends ForkName = ForkAll> = TypesByFork[F]["BeaconBlockHeader"];

export type BeaconBlock<F extends ForkName = ForkAll, B extends FullOrBlinded = "full"> = B extends "full"
  ? TypesByFork[F]["BeaconBlock"]
  : F extends ForkExecution
    ? TypesByFork[F]["BlindedBeaconBlock"]
    : never;

export type BeaconBlockBody<F extends ForkName = ForkAll, B extends FullOrBlinded = "full"> = B extends "full"
  ? TypesByFork[F]["BeaconBlockBody"]
  : F extends ForkExecution
    ? TypesByFork[F]["BlindedBeaconBlockBody"]
    : never;

export type SignedBeaconBlockHeader<F extends ForkName = ForkAll> = TypesByFork[F]["SignedBeaconBlockHeader"];

export type SignedBeaconBlock<F extends ForkName = ForkAll, B extends FullOrBlinded = "full"> = B extends "full"
  ? TypesByFork[F]["SignedBeaconBlock"]
  : F extends ForkExecution
    ? TypesByFork[F]["SignedBlindedBeaconBlock"]
    : never;

export type BlockContents<F extends ForkBlobs = ForkBlobs, S extends SignedUnsigned = "signed"> = S extends "signed"
  ? TypesByFork[F]["SignedBlockContents"]
  : TypesByFork[F]["BlockContents"];

export type BeaconBlockOrContents<F extends ForkBlobs = ForkBlobs> =
  | BeaconBlock<F, "full">
  | BlockContents<F, "unsigned">;

export type SignedBeaconBlockOrContents<F extends ForkBlobs = ForkBlobs> =
  | SignedBeaconBlock<F, "full">
  | BlockContents<F, "signed">;

export type ExecutionPayload<
  F extends ForkExecution = ForkExecution,
  B extends FullOrBlinded = "full",
> = B extends "full" ? TypesByFork[F]["ExecutionPayload"] : TypesByFork[F]["ExecutionPayloadHeader"];

export type BeaconState<F extends ForkName = ForkAll> = TypesByFork[F]["BeaconState"];

export type Metadata<F extends ForkName = ForkAll> = TypesByFork[F]["Metadata"];

export type BuilderBid<
  F extends ForkExecution = ForkExecution,
  S extends SignedUnsigned = "signed",
> = S extends "signed" ? TypesByFork[F]["SignedBuilderBid"] : TypesByFork[F]["BuilderBid"];

export type SSEPayloadAttributes<F extends ForkExecution = ForkExecution> = TypesByFork[F]["SSEPayloadAttributes"];

export type LightClientHeader<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["LightClientHeader"];

export type LightClientBootstrap<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["LightClientBootstrap"];

export type LightClientUpdate<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["LightClientUpdate"];

export type LightClientFinalityUpdate<F extends ForkLightClient = ForkLightClient> =
  TypesByFork[F]["LightClientFinalityUpdate"];

export type LightClientOptimisticUpdate<F extends ForkLightClient = ForkLightClient> =
  TypesByFork[F]["LightClientOptimisticUpdate"];

export type LightClientStore<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["LightClientStore"];

export type ExecutionPayloadAndBlobsBundle<F extends ForkBlobs = ForkBlobs> =
  TypesByFork[F]["ExecutionPayloadAndBlobsBundle"];

export type BlobsBundle<F extends ForkBlobs = ForkBlobs> = TypesByFork[F]["BlobsBundle"];

export type Contents<F extends ForkBlobs = ForkBlobs> = TypesByFork[F]["Contents"];
