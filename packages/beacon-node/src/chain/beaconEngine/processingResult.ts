import {ChainForkConfig} from "@lodestar/config";
import {RootHex} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {PayloadError, PayloadErrorType} from "../blocks/payloadError.js";
import {SignedBlockRoot, computeSignedBlockRoot} from "../blocks/signedBlockRoot.js";
import {BlockError, BlockErrorType} from "../errors/blockError.js";

export type BlockFailure = {
  blockIndex: number;
  blockRoot: RootHex;
  type: BlockErrorType;
  message: string;
};

export type PayloadFailure = {
  type: PayloadErrorType;
  message: string;
};

/** Signed roots must retain the order of the linear segment submitted for verification. */
export function blockFailureFromError(
  error: unknown,
  config: ChainForkConfig,
  signedBlockRoots: SignedBlockRoot[]
): BlockFailure {
  if (!(error instanceof BlockError)) throw error;
  const block = error.signedBlock.message;
  const blockRoot = toRootHex(config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block));
  const expectedRoot = computeSignedBlockRoot(config.getForkName(block.slot), error.signedBlock);
  const blockIndex = signedBlockRoots.findIndex((root) => byteArrayEquals(root, expectedRoot));
  if (blockIndex === -1) throw error;
  return {
    blockIndex,
    blockRoot,
    type: error.type,
    message: error.message,
  };
}

export function payloadFailureFromError(error: unknown): PayloadFailure {
  if (!(error instanceof PayloadError)) throw error;
  return {type: error.type, message: error.message};
}
