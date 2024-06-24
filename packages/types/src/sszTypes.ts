import {CompositeType, CompositeView, CompositeViewDU, ContainerType, ValueOf} from "@chainsafe/ssz";
import {ForkBlobs, ForkExecution, ForkLightClient, ForkName} from "@lodestar/params";
import {ssz as phase0} from "./phase0/index.js";
import {ssz as altair} from "./altair/index.js";
import {ssz as bellatrix} from "./bellatrix/index.js";
import {ssz as capella} from "./capella/index.js";
import {ssz as deneb} from "./deneb/index.js";

export * from "./primitive/sszTypes.js";
export {phase0, altair, bellatrix, capella, deneb};

/**
 * Index the ssz types that differ by fork
 * A record of AllForksSSZTypes indexed by fork
 */
const typesByFork = {
  [ForkName.phase0]: {
    BeaconBlock: phase0.BeaconBlock,
    BeaconBlockBody: phase0.BeaconBlockBody,
    BeaconState: phase0.BeaconState,
    SignedBeaconBlock: phase0.SignedBeaconBlock,
    Metadata: phase0.Metadata,
  },
  [ForkName.altair]: {
    BeaconBlock: altair.BeaconBlock,
    BeaconBlockBody: altair.BeaconBlockBody,
    BeaconState: altair.BeaconState,
    SignedBeaconBlock: altair.SignedBeaconBlock,
    Metadata: altair.Metadata,
    LightClientHeader: altair.LightClientHeader,
    LightClientBootstrap: altair.LightClientBootstrap,
    LightClientUpdate: altair.LightClientUpdate,
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate,
    LightClientOptimisticUpdate: altair.LightClientOptimisticUpdate,
    LightClientStore: altair.LightClientStore,
  },
  [ForkName.bellatrix]: {
    BeaconBlock: bellatrix.BeaconBlock,
    BeaconBlockBody: bellatrix.BeaconBlockBody,
    BeaconState: bellatrix.BeaconState,
    SignedBeaconBlock: bellatrix.SignedBeaconBlock,
    Metadata: altair.Metadata,
    LightClientHeader: altair.LightClientHeader,
    LightClientBootstrap: altair.LightClientBootstrap,
    LightClientUpdate: altair.LightClientUpdate,
    LightClientFinalityUpdate: altair.LightClientFinalityUpdate,
    LightClientOptimisticUpdate: altair.LightClientOptimisticUpdate,
    LightClientStore: altair.LightClientStore,
    BlindedBeaconBlock: bellatrix.BlindedBeaconBlock,
    BlindedBeaconBlockBody: bellatrix.BlindedBeaconBlockBody,
    SignedBlindedBeaconBlock: bellatrix.SignedBlindedBeaconBlock,
    ExecutionPayload: bellatrix.ExecutionPayload,
    ExecutionPayloadHeader: bellatrix.ExecutionPayloadHeader,
    BuilderBid: bellatrix.BuilderBid,
    SignedBuilderBid: bellatrix.SignedBuilderBid,
    SSEPayloadAttributes: bellatrix.SSEPayloadAttributes,
  },
  [ForkName.capella]: {
    BeaconBlock: capella.BeaconBlock,
    BeaconBlockBody: capella.BeaconBlockBody,
    BeaconState: capella.BeaconState,
    SignedBeaconBlock: capella.SignedBeaconBlock,
    Metadata: altair.Metadata,
    LightClientHeader: capella.LightClientHeader,
    LightClientBootstrap: capella.LightClientBootstrap,
    LightClientUpdate: capella.LightClientUpdate,
    LightClientFinalityUpdate: capella.LightClientFinalityUpdate,
    LightClientOptimisticUpdate: capella.LightClientOptimisticUpdate,
    LightClientStore: capella.LightClientStore,
    BlindedBeaconBlock: capella.BlindedBeaconBlock,
    BlindedBeaconBlockBody: capella.BlindedBeaconBlockBody,
    SignedBlindedBeaconBlock: capella.SignedBlindedBeaconBlock,
    ExecutionPayload: capella.ExecutionPayload,
    ExecutionPayloadHeader: capella.ExecutionPayloadHeader,
    BuilderBid: capella.BuilderBid,
    SignedBuilderBid: capella.SignedBuilderBid,
    SSEPayloadAttributes: capella.SSEPayloadAttributes,
  },
  [ForkName.deneb]: {
    BeaconBlock: deneb.BeaconBlock,
    BeaconBlockBody: deneb.BeaconBlockBody,
    BeaconState: deneb.BeaconState,
    SignedBeaconBlock: deneb.SignedBeaconBlock,
    Metadata: altair.Metadata,
    LightClientHeader: deneb.LightClientHeader,
    LightClientBootstrap: deneb.LightClientBootstrap,
    LightClientUpdate: deneb.LightClientUpdate,
    LightClientFinalityUpdate: deneb.LightClientFinalityUpdate,
    LightClientOptimisticUpdate: deneb.LightClientOptimisticUpdate,
    LightClientStore: deneb.LightClientStore,
    BlindedBeaconBlock: deneb.BlindedBeaconBlock,
    BlindedBeaconBlockBody: deneb.BlindedBeaconBlockBody,
    SignedBlindedBeaconBlock: deneb.SignedBlindedBeaconBlock,
    ExecutionPayload: deneb.ExecutionPayload,
    ExecutionPayloadHeader: deneb.ExecutionPayloadHeader,
    BuilderBid: deneb.BuilderBid,
    SignedBuilderBid: deneb.SignedBuilderBid,
    SSEPayloadAttributes: deneb.SSEPayloadAttributes,
    ExecutionPayloadAndBlobsBundle: deneb.ExecutionPayloadAndBlobsBundle,
  },
};

const pick = <T extends Record<ForkName, unknown>, K extends keyof T>(obj: T, ...keys: K[]): Pick<T, K> =>
  Object.fromEntries(keys.filter((key) => key in obj).map((key) => [key, obj[key]])) as Pick<T, K>;

const executionForks: ForkExecution[] = [ForkName.bellatrix, ForkName.capella, ForkName.deneb];
const lightCLientForks: ForkLightClient[] = [ForkName.altair, ForkName.bellatrix, ForkName.capella, ForkName.deneb];
const blobsForks: ForkBlobs[] = [ForkName.deneb];

export const allForksExecution = pick(typesByFork, ...executionForks);
export const allForksLightClient = pick(typesByFork, ...lightCLientForks);
export const allForksBlobs = pick(typesByFork, ...blobsForks);

/**
 * A type of union of forks must accept as any parameter the UNION of all fork types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UnionSSZForksTypeOf<UnionOfForkTypes extends ContainerType<any>> = CompositeType<
  ValueOf<UnionOfForkTypes>,
  CompositeView<UnionOfForkTypes>,
  CompositeViewDU<UnionOfForkTypes>
>;

type SSZTypesByFork = {
  [F in keyof typeof typesByFork]: {
    [T in keyof (typeof typesByFork)[F]]: (typeof typesByFork)[F][T];
  };
};

export type SSZTypesFor<F extends ForkName, K extends keyof SSZTypesByFork[F] | void = void> = K extends void
  ? // It compiles fine, need to debug the error
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    {[K2 in keyof SSZTypesByFork[F]]: UnionSSZForksTypeOf<SSZTypesByFork[F][K2]>}
  : // It compiles fine, need to debug the error
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    UnionSSZForksTypeOf<SSZTypesByFork[F][Exclude<K, void>]>;

export function sszTypesFor<F extends ForkName, K extends keyof SSZTypesByFork[F] | void = void>(
  fork: F,
  typeName?: K
): SSZTypesFor<F, K> {
  return (
    typeName === undefined ? typesByFork[fork] : typesByFork[fork][typeName as keyof SSZTypesByFork[F]]
  ) as SSZTypesFor<F, K>;
}
