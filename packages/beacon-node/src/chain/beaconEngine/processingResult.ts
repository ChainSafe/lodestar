import {ChainForkConfig} from "@lodestar/config";
import {Root, RootHex, SignedBeaconBlock} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";
import {SerializedError, deserializeError, serializeError} from "../../util/serializedError.js";
import {PayloadError, PayloadErrorType} from "../blocks/payloadError.js";
import {BlockError, BlockErrorCode, BlockErrorType} from "../errors/blockError.js";

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

/** Roots must retain the order of the linear segment submitted for verification. */
export function blockFailureFromError(error: unknown, config: ChainForkConfig, roots: Root[]): BlockFailure {
  if (!(error instanceof BlockError)) throw error;
  const block = error.signedBlock.message;
  const blockRoot = toRootHex(config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block));
  const blockIndex = roots.findIndex((root) => toRootHex(root) === blockRoot);
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

export function blockErrorFromFailure(
  failure: BlockFailure,
  inputs: {blockRootHex: RootHex; getBlock(): SignedBeaconBlock}[]
): BlockError {
  const input = inputs[failure.blockIndex];
  if (!input || input.blockRootHex !== failure.blockRoot) {
    throw new LodestarError({
      code: "INVALID_BLOCK_FAILURE_CONTEXT",
      blockIndex: failure.blockIndex,
      blockRoot: failure.blockRoot,
    });
  }
  const type = failure.type;
  const error = new BlockError(input.getBlock(), deserializeBlockErrorType(type));
  error.message = failure.message;
  error.stack = failure.stack;
  return error;
}

function deserializeBlockErrorType(type: SerializedBlockErrorType): BlockErrorType {
  switch (type.code) {
    case BlockErrorCode.PRESTATE_MISSING:
    case BlockErrorCode.PER_BLOCK_PROCESSING_ERROR:
    case BlockErrorCode.BEACON_CHAIN_ERROR:
      return {...type, error: deserializeError(type.error)};
    default:
      return type;
  }
}

export function payloadFailureFromError(error: unknown): PayloadFailure {
  if (!(error instanceof PayloadError)) throw error;
  return {type: error.type, message: error.message, stack: error.stack};
}
