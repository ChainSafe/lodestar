import {CompositeType, ContainerType, ValueOf, CompositeView, CompositeViewDU} from "@chainsafe/ssz";
import {ts as phase0} from "../phase0/index.js";
import {ts as altair} from "../altair/index.js";
import {ts as bellatrix} from "../bellatrix/index.js";
import {ts as capella} from "../capella/index.js";
import {ts as eip4844} from "../eip4844/index.js";

import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as eip4844Ssz} from "../eip4844/index.js";

// Re-export union types for types that are _known_ to differ

export type BeaconBlockBody =
  | phase0.BeaconBlockBody
  | altair.BeaconBlockBody
  | bellatrix.BeaconBlockBody
  | capella.BeaconBlockBody
  | eip4844.BeaconBlockBody;
export type BeaconBlock =
  | phase0.BeaconBlock
  | altair.BeaconBlock
  | bellatrix.BeaconBlock
  | capella.BeaconBlock
  | eip4844.BeaconBlock;
export type SignedBeaconBlock =
  | phase0.SignedBeaconBlock
  | altair.SignedBeaconBlock
  | bellatrix.SignedBeaconBlock
  | capella.SignedBeaconBlock
  | eip4844.SignedBeaconBlock;
export type BeaconState =
  | phase0.BeaconState
  | altair.BeaconState
  | bellatrix.BeaconState
  | capella.BeaconState
  | eip4844.BeaconState;
export type Metadata = phase0.Metadata | altair.Metadata;
export type Validator = phase0.Validator | capella.Validator;

// For easy reference in the assemble block for building payloads
export type ExecutionBlockBody = bellatrix.BeaconBlockBody | capella.BeaconBlockBody | eip4844.BeaconBlockBody;

// These two additional types will also change bellatrix forward
export type ExecutionPayload = bellatrix.ExecutionPayload | capella.ExecutionPayload | eip4844.ExecutionPayload;
export type ExecutionPayloadHeader =
  | bellatrix.ExecutionPayloadHeader
  | capella.ExecutionPayloadHeader
  | eip4844.ExecutionPayloadHeader;

// Blinded types that will change across forks
export type BlindedBeaconBlockBody =
  | bellatrix.BlindedBeaconBlockBody
  | capella.BlindedBeaconBlockBody
  | eip4844.BlindedBeaconBlockBody;
export type BlindedBeaconBlock = bellatrix.BlindedBeaconBlock | capella.BlindedBeaconBlock | eip4844.BlindedBeaconBlock;
export type SignedBlindedBeaconBlock =
  | bellatrix.SignedBlindedBeaconBlock
  | capella.SignedBlindedBeaconBlock
  | eip4844.SignedBlindedBeaconBlock;

// Full or blinded types
export type FullOrBlindedExecutionPayload = ExecutionPayload | ExecutionPayloadHeader;
export type FullOrBlindedBeaconBlockBody = BeaconBlockBody | BlindedBeaconBlockBody;
export type FullOrBlindedBeaconBlock = BeaconBlock | BlindedBeaconBlock;
export type FullOrBlindedSignedBeaconBlock = SignedBeaconBlock | SignedBlindedBeaconBlock;

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
};

export type AllForksBlindedTypes = {
  BeaconBlockBody: BlindedBeaconBlockBody;
  BeaconBlock: BlindedBeaconBlock;
  SignedBeaconBlock: SignedBlindedBeaconBlock;
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
    | typeof eip4844Ssz.BeaconBlockBody
  >;
  BeaconBlock: AllForksTypeOf<
    | typeof phase0Ssz.BeaconBlock
    | typeof altairSsz.BeaconBlock
    | typeof bellatrixSsz.BeaconBlock
    | typeof capellaSsz.BeaconBlock
    | typeof eip4844Ssz.BeaconBlock
  >;
  SignedBeaconBlock: AllForksTypeOf<
    | typeof phase0Ssz.SignedBeaconBlock
    | typeof altairSsz.SignedBeaconBlock
    | typeof bellatrixSsz.SignedBeaconBlock
    | typeof capellaSsz.SignedBeaconBlock
    | typeof eip4844Ssz.SignedBeaconBlock
  >;
  BeaconState: AllForksTypeOf<
    | typeof phase0Ssz.BeaconState
    | typeof altairSsz.BeaconState
    | typeof bellatrixSsz.BeaconState
    | typeof capellaSsz.BeaconState
    | typeof eip4844Ssz.BeaconState
  >;
  Metadata: AllForksTypeOf<typeof phase0Ssz.Metadata | typeof altairSsz.Metadata>;
};

export type AllForksExecutionSSZTypes = {
  BeaconBlockBody: AllForksTypeOf<
    typeof bellatrixSsz.BeaconBlockBody | typeof capellaSsz.BeaconBlockBody | typeof eip4844Ssz.BeaconBlockBody
  >;
  BeaconBlock: AllForksTypeOf<
    typeof bellatrixSsz.BeaconBlock | typeof capellaSsz.BeaconBlock | typeof eip4844Ssz.BeaconBlock
  >;
  SignedBeaconBlock: AllForksTypeOf<
    typeof bellatrixSsz.SignedBeaconBlock | typeof capellaSsz.SignedBeaconBlock | typeof eip4844Ssz.SignedBeaconBlock
  >;
  BeaconState: AllForksTypeOf<
    typeof bellatrixSsz.BeaconState | typeof capellaSsz.BeaconState | typeof eip4844Ssz.BeaconState
  >;
  ExecutionPayload: AllForksTypeOf<
    typeof bellatrixSsz.ExecutionPayload | typeof capellaSsz.ExecutionPayload | typeof eip4844Ssz.ExecutionPayload
  >;
  ExecutionPayloadHeader: AllForksTypeOf<
    | typeof bellatrixSsz.ExecutionPayloadHeader
    | typeof capellaSsz.ExecutionPayloadHeader
    | typeof eip4844Ssz.ExecutionPayloadHeader
  >;
};

export type AllForksBlindedSSZTypes = {
  BeaconBlockBody: AllForksTypeOf<
    | typeof bellatrixSsz.BlindedBeaconBlockBody
    | typeof capellaSsz.BlindedBeaconBlock
    | typeof eip4844Ssz.BlindedBeaconBlock
  >;
  BeaconBlock: AllForksTypeOf<
    typeof bellatrixSsz.BlindedBeaconBlock | typeof capellaSsz.BlindedBeaconBlock | typeof eip4844Ssz.BlindedBeaconBlock
  >;
  SignedBeaconBlock: AllForksTypeOf<
    | typeof bellatrixSsz.SignedBlindedBeaconBlock
    | typeof capellaSsz.SignedBlindedBeaconBlock
    | typeof eip4844Ssz.SignedBlindedBeaconBlock
  >;
};
