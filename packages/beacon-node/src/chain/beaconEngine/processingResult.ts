import {ChainForkConfig} from "@lodestar/config";
import {RootHex} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {SerializedError, serializeError} from "../../util/serializedError.js";
import {PayloadError, PayloadErrorType} from "../blocks/payloadError.js";
import {SignedBlockRoot, computeSignedBlockRoot} from "../blocks/signedBlockRoot.js";
import {BlockError, BlockErrorType} from "../errors/blockError.js";

type WithSerializedError<T> = T extends {error: Error} ? Omit<T, "error"> & {error: SerializedError} : T;

export type SerializedBlockErrorType = WithSerializedError<BlockErrorType>;

export type BlockFailure = {
  blockIndex: number;
  blockRoot: RootHex;
  type: SerializedBlockErrorType;
  message: string;
  stack?: string;
};

export type PayloadFailure = {
  type: PayloadErrorType;
  message: string;
  stack?: string;
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
  const type = error.type;
  return {
    blockIndex,
    blockRoot,
    type: "error" in type ? {...type, error: serializeError(type.error)} : type,
    message: error.message,
    stack: error.stack,
  };
}

export function payloadFailureFromError(error: unknown): PayloadFailure {
  if (!(error instanceof PayloadError)) throw error;
  return {type: error.type, message: error.message, stack: error.stack};
}
