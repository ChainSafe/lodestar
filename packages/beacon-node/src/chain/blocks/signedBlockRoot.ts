import {ForkName} from "@lodestar/params";
import {Root, RootHex, SignedBeaconBlock, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

declare const signedBlockRootBrand: unique symbol;
declare const signedBlockRootHexBrand: unique symbol;

/**
 * SSZ hashTreeRoot(SignedBeaconBlock), including the proposer signature. Identifies a signed candidate
 * for block validation/processing and in BlockSerializedCache. Consensus, fork choice and DB keys
 * use hashTreeRoot(BeaconBlock).
 * This is neither a domain-dependent BLS signing root nor a hash of the serialized block bytes.
 * The brand distinguishes it from an ordinary Root at compile time; it does not imply validation.
 */
export type SignedBlockRoot = Root & {readonly [signedBlockRootBrand]: true};

/** Hex encoding of SignedBlockRoot, kept distinct from an ordinary RootHex cache key. */
export type SignedBlockRootHex = RootHex & {readonly [signedBlockRootHexBrand]: true};

/**
 * Hash the complete signed block with its fork's SSZ type. The root identifies a candidate;
 * it does not authenticate the proposer signature or establish consensus validity.
 * cachePermanentRootStruct reuses the root for this instance. After the first hash, the signed block
 * (including its signature) and the returned root must stay immutable.
 */
export function computeSignedBlockRoot(fork: ForkName, block: SignedBeaconBlock): SignedBlockRoot {
  return sszTypesFor(fork).SignedBeaconBlock.hashTreeRoot(block) as SignedBlockRoot;
}

export function toSignedBlockRootHex(root: SignedBlockRoot): SignedBlockRootHex {
  return toRootHex(root) as SignedBlockRootHex;
}
