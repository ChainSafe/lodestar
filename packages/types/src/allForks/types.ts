import {CompositeType, ContainerType, ValueOf, CompositeView, CompositeViewDU} from "@chainsafe/ssz";
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

// Re-export union types for types that are _known_ to differ

export type BeaconBlockBody =
  | phase0.BeaconBlockBody
  | altair.BeaconBlockBody
  | bellatrix.BeaconBlockBody
  | capella.BeaconBlockBody
  | deneb.BeaconBlockBody;
export type BeaconBlock =
  | phase0.BeaconBlock
  | altair.BeaconBlock
  | bellatrix.BeaconBlock
  | capella.BeaconBlock
  | deneb.BeaconBlock;
export type SignedBeaconBlock =
  | phase0.SignedBeaconBlock
  | altair.SignedBeaconBlock
  | bellatrix.SignedBeaconBlock
  | capella.SignedBeaconBlock
  | deneb.SignedBeaconBlock;
export type BeaconState =
  | phase0.BeaconState
  | altair.BeaconState
  | bellatrix.BeaconState
  | capella.BeaconState
  | deneb.BeaconState;
export type Metadata = phase0.Metadata | altair.Metadata;

// For easy reference in the assemble block for building payloads
export type ExecutionBlockBody = bellatrix.BeaconBlockBody | capella.BeaconBlockBody | deneb.BeaconBlockBody;

// These two additional types will also change bellatrix forward
export type ExecutionPayload = bellatrix.ExecutionPayload | capella.ExecutionPayload | deneb.ExecutionPayload;
export type ExecutionPayloadHeader =
  | bellatrix.ExecutionPayloadHeader
  | capella.ExecutionPayloadHeader
  | deneb.ExecutionPayloadHeader;

export type LightClientHeader = altair.LightClientHeader | capella.LightClientHeader;

// Blinded types that will change across forks
export type BlindedBeaconBlockBody =
  | bellatrix.BlindedBeaconBlockBody
  | capella.BlindedBeaconBlockBody
  | deneb.BlindedBeaconBlockBody;
export type BlindedBeaconBlock = bellatrix.BlindedBeaconBlock | capella.BlindedBeaconBlock | deneb.BlindedBeaconBlock;
export type SignedBlindedBeaconBlock =
  | bellatrix.SignedBlindedBeaconBlock
  | capella.SignedBlindedBeaconBlock
  | deneb.SignedBlindedBeaconBlock;

// Full or blinded types
export type FullOrBlindedExecutionPayload =
  | bellatrix.FullOrBlindedExecutionPayload
  | capella.FullOrBlindedExecutionPayload;
export type FullOrBlindedBeaconBlockBody = BeaconBlockBody | BlindedBeaconBlockBody;
export type FullOrBlindedBeaconBlock = BeaconBlock | BlindedBeaconBlock;
export type FullOrBlindedSignedBeaconBlock = SignedBeaconBlock | SignedBlindedBeaconBlock;

export type BuilderBid = bellatrix.BuilderBid | capella.BuilderBid | deneb.BuilderBid;
export type SignedBuilderBid = bellatrix.SignedBuilderBid | capella.SignedBuilderBid | deneb.SignedBuilderBid;

export type SignedBeaconBlockAndBlobsSidecar = deneb.SignedBeaconBlockAndBlobsSidecar;
/**
 * Types known to change between forks
 */
export type AllForksTypes = {
  BeaconBlockBody: BeaconBlockBody;
  BeaconBlock: BeaconBlock;
  SignedBeaconBlock: SignedBeaconBlock;
  BeaconState: BeaconState;
  Metadata: Metadata;
  ExecutionPayload: ExecutionPayload;
  ExecutionPayloadHeader: ExecutionPayloadHeader;
  LightClientHeader: LightClientHeader;
  BuilderBid: BuilderBid;
  SignedBuilderBid: SignedBuilderBid;
  SignedBeaconBlockAndBlobsSidecar: SignedBeaconBlockAndBlobsSidecar;
};

export type AllForksBlindedTypes = {
  BeaconBlockBody: BlindedBeaconBlockBody;
  BeaconBlock: BlindedBeaconBlock;
  SignedBeaconBlock: SignedBlindedBeaconBlock;
};

export type AllForksLightClient = {
  LightClientHeader: LightClientHeader;
};

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
  LightClientHeader: AllForksTypeOf<typeof altairSsz.LightClientHeader | typeof capellaSsz.LightClientHeader>;
};

export type AllForksBlobsSSZTypes = {
  SignedBeaconBlockAndBlobsSidecar: AllForksTypeOf<typeof denebSsz.SignedBeaconBlockAndBlobsSidecar>;
};
