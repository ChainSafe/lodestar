import {ForkAll, ForkBlobs, ForkExecution, ForkLightClient, ForkName, ForkPreBlobs} from "@lodestar/params";
import {ts as phase0} from "./phase0/index.js";
import {ts as altair} from "./altair/index.js";
import {ts as bellatrix} from "./bellatrix/index.js";
import {ts as capella} from "./capella/index.js";
import {ts as deneb} from "./deneb/index.js";
import {Slot} from "./primitive/types.js";

export * from "./primitive/types.js";
export type {phase0, altair, bellatrix, capella, deneb};

/** Common non-spec type to represent roots as strings */
export type RootHex = string;

/** Handy enum to represent the block production source */
export enum ProducedBlockSource {
  builder = "builder",
  engine = "engine",
}

export type SlotRootHex = {slot: Slot; root: RootHex};
export type SlotOptionalRoot = {slot: Slot; root?: RootHex};

type MergeTypes<D extends Record<string, unknown>, U extends Record<string, unknown>> = {
  [K in keyof D | keyof U]: K extends keyof U ? U[K] : K extends keyof D ? D[K] : never;
};

type phase0Types = phase0;
type altairFullTypes = MergeTypes<phase0, altair>;
type bellatrixFullTypes = MergeTypes<altairFullTypes, bellatrix>;
type capellaFullTypes = MergeTypes<bellatrixFullTypes, capella>;
type denebFullTypes = MergeTypes<capellaFullTypes, deneb>;

type TypesByFork = {
  [ForkName.phase0]: phase0Types;
  [ForkName.altair]: altairFullTypes;
  [ForkName.bellatrix]: bellatrixFullTypes;
  [ForkName.capella]: capellaFullTypes;
  [ForkName.deneb]: denebFullTypes;
};

export type TypesFor<F extends ForkName, K extends keyof TypesByFork[F] | void = void> = K extends void
  ? TypesByFork[F]
  : TypesByFork[F][Exclude<K, void>];

export type BeaconBlockHeader<F extends ForkAll = ForkAll> = TypesByFork[F]["BeaconBlockHeader"];
export type SignedBeaconBlockHeader<F extends ForkAll = ForkAll> = TypesByFork[F]["SignedBeaconBlockHeader"];

export type BeaconBlock<F extends ForkAll = ForkAll> = TypesByFork[F]["BeaconBlock"];
export type BlindedBeaconBlock<F extends ForkExecution = ForkExecution> = TypesByFork[F]["BlindedBeaconBlock"];

export type SignedBeaconBlock<F extends ForkAll = ForkAll> = TypesByFork[F]["SignedBeaconBlock"];
export type SignedBlindedBeaconBlock<F extends ForkExecution = ForkExecution> =
  TypesByFork[F]["SignedBlindedBeaconBlock"];

export type BeaconBlockBody<F extends ForkAll = ForkAll> = TypesByFork[F]["BeaconBlockBody"];
export type BlindedBeaconBlockBody<F extends ForkExecution = ForkExecution> = TypesByFork[F]["BlindedBeaconBlockBody"];

export type BlockContents<F extends ForkBlobs = ForkBlobs> = TypesByFork[F]["BlockContents"];
export type SignedBlockContents<F extends ForkBlobs = ForkBlobs> = TypesByFork[F]["SignedBlockContents"];
export type SignedOrUnsignedBlockContents<F extends ForkBlobs = ForkBlobs> = BlockContents<F> | SignedBlockContents<F>;

export type BeaconBlockOrContents<FB extends ForkPreBlobs = ForkPreBlobs, FC extends ForkBlobs = ForkBlobs> =
  | BeaconBlock<FB>
  | BlockContents<FC>;

export type SignedBeaconBlockOrContents<FB extends ForkPreBlobs = ForkPreBlobs, FC extends ForkBlobs = ForkBlobs> =
  | SignedBeaconBlock<FB>
  | SignedBlockContents<FC>;

export type ExecutionPayload<F extends ForkExecution = ForkExecution> = TypesByFork[F]["ExecutionPayload"];
export type ExecutionPayloadHeader<F extends ForkExecution = ForkExecution> = TypesByFork[F]["ExecutionPayloadHeader"];

export type BlobsBundle<F extends ForkBlobs = ForkBlobs> = TypesByFork[F]["BlobsBundle"];
export type Contents<F extends ForkBlobs = ForkBlobs> = TypesByFork[F]["Contents"];
export type ExecutionPayloadAndBlobsBundle<F extends ForkBlobs = ForkBlobs> =
  TypesByFork[F]["ExecutionPayloadAndBlobsBundle"];

export type LightClientHeader<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["LightClientHeader"];
export type LightClientBootstrap<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["LightClientBootstrap"];
export type LightClientUpdate<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["LightClientUpdate"];
export type LightClientFinalityUpdate<F extends ForkLightClient = ForkLightClient> =
  TypesByFork[F]["LightClientFinalityUpdate"];
export type LightClientOptimisticUpdate<F extends ForkLightClient = ForkLightClient> =
  TypesByFork[F]["LightClientOptimisticUpdate"];
export type LightClientStore<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["LightClientStore"];
export type SyncCommittee<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["SyncCommittee"];
export type SyncAggregate<F extends ForkLightClient = ForkLightClient> = TypesByFork[F]["SyncAggregate"];

export type BeaconState<F extends ForkName = ForkAll> = TypesByFork[F]["BeaconState"];

export type Metadata<F extends ForkName = ForkAll> = TypesByFork[F]["Metadata"];

export type BuilderBid<F extends ForkExecution = ForkExecution> = TypesByFork[F]["BuilderBid"];
export type SignedBuilderBid<F extends ForkExecution = ForkExecution> = TypesByFork[F]["SignedBuilderBid"];
export type SSEPayloadAttributes<F extends ForkExecution = ForkExecution> = TypesByFork[F]["SSEPayloadAttributes"];
