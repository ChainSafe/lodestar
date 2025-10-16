import {ForkAll, ForkName, ForkPostAltair, ForkPostBellatrix, ForkPostDeneb, ForkPostElectra} from "@lodestar/params";
import {ts as altair} from "./altair/index.js";
import {ts as bellatrix} from "./bellatrix/index.js";
import {ts as capella} from "./capella/index.js";
import {ts as deneb} from "./deneb/index.js";
import {ts as electra} from "./electra/index.js";
import {ts as fulu} from "./fulu/index.js";
import {ts as gloas} from "./gloas/index.js";
import {ts as phase0} from "./phase0/index.js";
import {Slot} from "./primitive/types.js";

export {ts as altair} from "./altair/index.js";
export {ts as bellatrix} from "./bellatrix/index.js";
export {ts as capella} from "./capella/index.js";
export {ts as deneb} from "./deneb/index.js";
export {ts as electra} from "./electra/index.js";
export {ts as fulu} from "./fulu/index.js";
export {ts as gloas} from "./gloas/index.js";
export {ts as phase0} from "./phase0/index.js";
export * from "./primitive/types.js";

/** Common non-spec type to represent roots as strings */
export type RootHex = string;

/** Handy enum to represent the block production source */
export enum ProducedBlockSource {
  builder = "builder",
  engine = "engine",
}

export type WithBytes<T> = {
  data: T;
  /** SSZ serialized `data` bytes */
  bytes: Uint8Array;
};

export type WithOptionalBytes<T> = {
  data: T;
  /** SSZ serialized `data` bytes */
  bytes?: Uint8Array | null;
};

export type SlotRootHex = {slot: Slot; root: RootHex};
export type SlotOptionalRoot = {slot: Slot; root?: RootHex};
export type RootOptionalSlot = {root: RootHex; slot?: Slot};

type TypesByFork = {
  [ForkName.phase0]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: phase0.BeaconBlock;
    BeaconBlockBody: phase0.BeaconBlockBody;
    BeaconState: phase0.BeaconState;
    SignedBeaconBlock: phase0.SignedBeaconBlock;
    Metadata: phase0.Metadata;
    Status: phase0.Status;
    SingleAttestation: phase0.Attestation;
    Attestation: phase0.Attestation;
    IndexedAttestation: phase0.IndexedAttestation;
    IndexedAttestationBigint: phase0.IndexedAttestationBigint;
    AttesterSlashing: phase0.AttesterSlashing;
    AggregateAndProof: phase0.AggregateAndProof;
    SignedAggregateAndProof: phase0.SignedAggregateAndProof;
    BlockContents: {block: phase0.BeaconBlock};
    SignedBlockContents: {signedBlock: phase0.SignedBeaconBlock};
  };
  [ForkName.altair]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: altair.BeaconBlock;
    BeaconBlockBody: altair.BeaconBlockBody;
    BeaconState: altair.BeaconState;
    SignedBeaconBlock: altair.SignedBeaconBlock;
    Metadata: altair.Metadata;
    Status: phase0.Status;
    LightClientHeader: altair.LightClientHeader;
    LightClientBootstrap: altair.LightClientBootstrap;
    LightClientUpdate: altair.LightClientUpdate;
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate;
    LightClientOptimisticUpdate: altair.LightClientOptimisticUpdate;
    LightClientStore: altair.LightClientStore;
    SyncCommittee: altair.SyncCommittee;
    SyncAggregate: altair.SyncAggregate;
    SingleAttestation: phase0.Attestation;
    Attestation: phase0.Attestation;
    IndexedAttestation: phase0.IndexedAttestation;
    IndexedAttestationBigint: phase0.IndexedAttestationBigint;
    AttesterSlashing: phase0.AttesterSlashing;
    AggregateAndProof: phase0.AggregateAndProof;
    SignedAggregateAndProof: phase0.SignedAggregateAndProof;
    BlockContents: {block: altair.BeaconBlock};
    SignedBlockContents: {signedBlock: altair.SignedBeaconBlock};
  };
  [ForkName.bellatrix]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: bellatrix.BeaconBlock;
    BeaconBlockBody: bellatrix.BeaconBlockBody;
    BeaconState: bellatrix.BeaconState;
    SignedBeaconBlock: bellatrix.SignedBeaconBlock;
    Metadata: altair.Metadata;
    Status: phase0.Status;
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
    SyncCommittee: altair.SyncCommittee;
    SyncAggregate: altair.SyncAggregate;
    SingleAttestation: phase0.Attestation;
    Attestation: phase0.Attestation;
    IndexedAttestation: phase0.IndexedAttestation;
    IndexedAttestationBigint: phase0.IndexedAttestationBigint;
    AttesterSlashing: phase0.AttesterSlashing;
    AggregateAndProof: phase0.AggregateAndProof;
    SignedAggregateAndProof: phase0.SignedAggregateAndProof;
    BlockContents: {block: bellatrix.BeaconBlock};
    SignedBlockContents: {signedBlock: bellatrix.SignedBeaconBlock};
  };
  [ForkName.capella]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: capella.BeaconBlock;
    BeaconBlockBody: capella.BeaconBlockBody;
    BeaconState: capella.BeaconState;
    SignedBeaconBlock: capella.SignedBeaconBlock;
    Metadata: altair.Metadata;
    Status: phase0.Status;
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
    SyncCommittee: altair.SyncCommittee;
    SyncAggregate: altair.SyncAggregate;
    SingleAttestation: phase0.Attestation;
    Attestation: phase0.Attestation;
    IndexedAttestation: phase0.IndexedAttestation;
    IndexedAttestationBigint: phase0.IndexedAttestationBigint;
    AttesterSlashing: phase0.AttesterSlashing;
    AggregateAndProof: phase0.AggregateAndProof;
    SignedAggregateAndProof: phase0.SignedAggregateAndProof;
    BlockContents: {block: capella.BeaconBlock};
    SignedBlockContents: {signedBlock: capella.SignedBeaconBlock};
  };
  [ForkName.deneb]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: deneb.BeaconBlock;
    BeaconBlockBody: deneb.BeaconBlockBody;
    BeaconState: deneb.BeaconState;
    SignedBeaconBlock: deneb.SignedBeaconBlock;
    Metadata: altair.Metadata;
    Status: phase0.Status;
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
    BlockContents: deneb.BlockContents;
    SignedBlockContents: deneb.SignedBlockContents;
    ExecutionPayloadAndBlobsBundle: deneb.ExecutionPayloadAndBlobsBundle;
    BlobsBundle: deneb.BlobsBundle;
    SyncCommittee: altair.SyncCommittee;
    SyncAggregate: altair.SyncAggregate;
    SingleAttestation: phase0.Attestation;
    Attestation: phase0.Attestation;
    IndexedAttestation: phase0.IndexedAttestation;
    IndexedAttestationBigint: phase0.IndexedAttestationBigint;
    AttesterSlashing: phase0.AttesterSlashing;
    AggregateAndProof: phase0.AggregateAndProof;
    SignedAggregateAndProof: phase0.SignedAggregateAndProof;
  };
  [ForkName.electra]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: electra.BeaconBlock;
    BeaconBlockBody: electra.BeaconBlockBody;
    BeaconState: electra.BeaconState;
    SignedBeaconBlock: electra.SignedBeaconBlock;
    Metadata: altair.Metadata;
    Status: phase0.Status;
    LightClientHeader: deneb.LightClientHeader;
    LightClientBootstrap: electra.LightClientBootstrap;
    LightClientUpdate: electra.LightClientUpdate;
    LightClientFinalityUpdate: electra.LightClientFinalityUpdate;
    LightClientOptimisticUpdate: electra.LightClientOptimisticUpdate;
    LightClientStore: electra.LightClientStore;
    BlindedBeaconBlock: electra.BlindedBeaconBlock;
    BlindedBeaconBlockBody: electra.BlindedBeaconBlockBody;
    SignedBlindedBeaconBlock: electra.SignedBlindedBeaconBlock;
    ExecutionPayload: deneb.ExecutionPayload;
    ExecutionPayloadHeader: deneb.ExecutionPayloadHeader;
    BuilderBid: electra.BuilderBid;
    SignedBuilderBid: electra.SignedBuilderBid;
    SSEPayloadAttributes: electra.SSEPayloadAttributes;
    BlockContents: electra.BlockContents;
    SignedBlockContents: electra.SignedBlockContents;
    ExecutionPayloadAndBlobsBundle: deneb.ExecutionPayloadAndBlobsBundle;
    BlobsBundle: deneb.BlobsBundle;
    SyncCommittee: altair.SyncCommittee;
    SyncAggregate: altair.SyncAggregate;
    SingleAttestation: electra.SingleAttestation;
    Attestation: electra.Attestation;
    IndexedAttestation: electra.IndexedAttestation;
    IndexedAttestationBigint: electra.IndexedAttestationBigint;
    AttesterSlashing: electra.AttesterSlashing;
    AggregateAndProof: electra.AggregateAndProof;
    SignedAggregateAndProof: electra.SignedAggregateAndProof;
    ExecutionRequests: electra.ExecutionRequests;
  };
  [ForkName.fulu]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: electra.BeaconBlock;
    BeaconBlockBody: electra.BeaconBlockBody;
    BeaconState: fulu.BeaconState;
    SignedBeaconBlock: electra.SignedBeaconBlock;
    Metadata: fulu.Metadata;
    Status: fulu.Status;
    LightClientHeader: deneb.LightClientHeader;
    LightClientBootstrap: electra.LightClientBootstrap;
    LightClientUpdate: electra.LightClientUpdate;
    LightClientFinalityUpdate: electra.LightClientFinalityUpdate;
    LightClientOptimisticUpdate: electra.LightClientOptimisticUpdate;
    LightClientStore: electra.LightClientStore;
    BlindedBeaconBlock: electra.BlindedBeaconBlock;
    BlindedBeaconBlockBody: electra.BlindedBeaconBlockBody;
    SignedBlindedBeaconBlock: electra.SignedBlindedBeaconBlock;
    ExecutionPayload: deneb.ExecutionPayload;
    ExecutionPayloadHeader: deneb.ExecutionPayloadHeader;
    BuilderBid: electra.BuilderBid;
    SignedBuilderBid: electra.SignedBuilderBid;
    SSEPayloadAttributes: electra.SSEPayloadAttributes;
    BlockContents: fulu.BlockContents;
    SignedBlockContents: fulu.SignedBlockContents;
    ExecutionPayloadAndBlobsBundle: deneb.ExecutionPayloadAndBlobsBundle;
    BlobsBundle: fulu.BlobsBundle;
    SyncCommittee: altair.SyncCommittee;
    SyncAggregate: altair.SyncAggregate;
    SingleAttestation: electra.SingleAttestation;
    Attestation: electra.Attestation;
    IndexedAttestation: electra.IndexedAttestation;
    IndexedAttestationBigint: electra.IndexedAttestationBigint;
    AttesterSlashing: electra.AttesterSlashing;
    AggregateAndProof: electra.AggregateAndProof;
    SignedAggregateAndProof: electra.SignedAggregateAndProof;
    ExecutionRequests: electra.ExecutionRequests;
  };
  [ForkName.gloas]: {
    BeaconBlockHeader: phase0.BeaconBlockHeader;
    SignedBeaconBlockHeader: phase0.SignedBeaconBlockHeader;
    BeaconBlock: gloas.BeaconBlock;
    BeaconBlockBody: gloas.BeaconBlockBody;
    BeaconState: gloas.BeaconState;
    SignedBeaconBlock: gloas.SignedBeaconBlock;
    Metadata: fulu.Metadata;
    Status: fulu.Status;
    LightClientHeader: deneb.LightClientHeader;
    LightClientBootstrap: electra.LightClientBootstrap;
    LightClientUpdate: electra.LightClientUpdate;
    LightClientFinalityUpdate: electra.LightClientFinalityUpdate;
    LightClientOptimisticUpdate: electra.LightClientOptimisticUpdate;
    LightClientStore: electra.LightClientStore;
    BlindedBeaconBlock: electra.BlindedBeaconBlock;
    BlindedBeaconBlockBody: electra.BlindedBeaconBlockBody;
    SignedBlindedBeaconBlock: electra.SignedBlindedBeaconBlock;
    ExecutionPayload: deneb.ExecutionPayload;
    ExecutionPayloadHeader: deneb.ExecutionPayloadHeader;
    BuilderBid: electra.BuilderBid;
    SignedBuilderBid: electra.SignedBuilderBid;
    SSEPayloadAttributes: electra.SSEPayloadAttributes;
    BlockContents: fulu.BlockContents;
    SignedBlockContents: fulu.SignedBlockContents;
    ExecutionPayloadAndBlobsBundle: deneb.ExecutionPayloadAndBlobsBundle;
    BlobsBundle: fulu.BlobsBundle;
    SyncCommittee: altair.SyncCommittee;
    SyncAggregate: altair.SyncAggregate;
    SingleAttestation: electra.SingleAttestation;
    Attestation: electra.Attestation;
    IndexedAttestation: electra.IndexedAttestation;
    IndexedAttestationBigint: electra.IndexedAttestationBigint;
    AttesterSlashing: electra.AttesterSlashing;
    AggregateAndProof: electra.AggregateAndProof;
    SignedAggregateAndProof: electra.SignedAggregateAndProof;
    ExecutionRequests: electra.ExecutionRequests;
  };
};

export type TypesFor<F extends ForkName, K extends keyof TypesByFork[F] | void = void> = K extends void
  ? TypesByFork[F]
  : TypesByFork[F][Exclude<K, void>];

export type BeaconBlockHeader<F extends ForkAll = ForkAll> = TypesByFork[F]["BeaconBlockHeader"];
export type SignedBeaconBlockHeader<F extends ForkAll = ForkAll> = TypesByFork[F]["SignedBeaconBlockHeader"];

export type BeaconBlock<F extends ForkAll = ForkAll> = TypesByFork[F]["BeaconBlock"];
export type BlindedBeaconBlock<F extends ForkPostBellatrix = ForkPostBellatrix> = TypesByFork[F]["BlindedBeaconBlock"];

export type SignedBeaconBlock<F extends ForkAll = ForkAll> = TypesByFork[F]["SignedBeaconBlock"];
export type SignedBlindedBeaconBlock<F extends ForkPostBellatrix = ForkPostBellatrix> =
  TypesByFork[F]["SignedBlindedBeaconBlock"];

export type BeaconBlockBody<F extends ForkAll = ForkAll> = TypesByFork[F]["BeaconBlockBody"];
export type BlindedBeaconBlockBody<F extends ForkPostBellatrix = ForkPostBellatrix> =
  TypesByFork[F]["BlindedBeaconBlockBody"];

export type BlockContents<F extends ForkAll = ForkAll> = TypesByFork[F]["BlockContents"];
export type SignedBlockContents<F extends ForkAll = ForkAll> = TypesByFork[F]["SignedBlockContents"];
export type SignedOrUnsignedBlockContents<F extends ForkAll = ForkAll> = BlockContents<F> | SignedBlockContents<F>;

export type ExecutionPayload<F extends ForkPostBellatrix = ForkPostBellatrix> = TypesByFork[F]["ExecutionPayload"];
export type ExecutionPayloadHeader<F extends ForkPostBellatrix = ForkPostBellatrix> =
  TypesByFork[F]["ExecutionPayloadHeader"];
export type ExecutionRequests<F extends ForkPostElectra = ForkPostElectra> = TypesByFork[F]["ExecutionRequests"];

export type ExecutionPayloadAndBlobsBundle<F extends ForkPostDeneb = ForkPostDeneb> =
  TypesByFork[F]["ExecutionPayloadAndBlobsBundle"];
export type BlobsBundle<F extends ForkPostDeneb = ForkPostDeneb> = TypesByFork[F]["BlobsBundle"];

export type LightClientHeader<F extends ForkPostAltair = ForkPostAltair> = TypesByFork[F]["LightClientHeader"];
export type LightClientBootstrap<F extends ForkPostAltair = ForkPostAltair> = TypesByFork[F]["LightClientBootstrap"];
export type LightClientUpdate<F extends ForkPostAltair = ForkPostAltair> = TypesByFork[F]["LightClientUpdate"];
export type LightClientFinalityUpdate<F extends ForkPostAltair = ForkPostAltair> =
  TypesByFork[F]["LightClientFinalityUpdate"];
export type LightClientOptimisticUpdate<F extends ForkPostAltair = ForkPostAltair> =
  TypesByFork[F]["LightClientOptimisticUpdate"];
export type LightClientStore<F extends ForkPostAltair = ForkPostAltair> = TypesByFork[F]["LightClientStore"];
export type SyncCommittee<F extends ForkPostAltair = ForkPostAltair> = TypesByFork[F]["SyncCommittee"];
export type SyncAggregate<F extends ForkPostAltair = ForkPostAltair> = TypesByFork[F]["SyncAggregate"];

export type BeaconState<F extends ForkName = ForkAll> = TypesByFork[F]["BeaconState"];

export type Metadata<F extends ForkName = ForkAll> = TypesByFork[F]["Metadata"];
export type Status<F extends ForkName = ForkAll> = TypesByFork[F]["Status"];

export type BuilderBid<F extends ForkPostBellatrix = ForkPostBellatrix> = TypesByFork[F]["BuilderBid"];
export type SignedBuilderBid<F extends ForkPostBellatrix = ForkPostBellatrix> = TypesByFork[F]["SignedBuilderBid"];
export type SSEPayloadAttributes<F extends ForkPostBellatrix = ForkPostBellatrix> =
  TypesByFork[F]["SSEPayloadAttributes"];

export type Attestation<F extends ForkName = ForkAll> = TypesByFork[F]["Attestation"];
export type SingleAttestation<F extends ForkName = ForkAll> = TypesByFork[F]["SingleAttestation"];
export type IndexedAttestation<F extends ForkName = ForkAll> = TypesByFork[F]["IndexedAttestation"];
export type IndexedAttestationBigint<F extends ForkName = ForkAll> = TypesByFork[F]["IndexedAttestationBigint"];
export type AttesterSlashing<F extends ForkName = ForkAll> = TypesByFork[F]["AttesterSlashing"];
export type AggregateAndProof<F extends ForkName = ForkAll> = TypesByFork[F]["AggregateAndProof"];
export type SignedAggregateAndProof<F extends ForkName = ForkAll> = TypesByFork[F]["SignedAggregateAndProof"];
