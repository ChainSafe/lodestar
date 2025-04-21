import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {PeerIdStr} from "../../../util/peerId.js";
import {
  BlockInputSource,
  LogMetaBlobs,
  //  LogMetaColumns
} from "./types.js";

export enum BlockInputErrorCode {
  // Bad Arguments
  UNDEFINED_PROP = "BLOCK_INPUT_ERROR_UNDEFINED_PROP",
  INVALID_CONSTRUCTION = "BLOCK_INPUT_ERROR_INVALID_CONSTRUCTION",

  // Attempt to get all data but some is missing
  INCOMPLETE_DATA = "BLOCK_INPUT_ERROR_INCOMPLETE_DATA",

  // Missing class property values for getters
  MISSING_FORK_NAME = "BLOCK_INPUT_ERROR_MISSING_FORK_NAME",
  MISSING_SLOT = "BLOCK_INPUT_ERROR_MISSING_SLOT",
  MISSING_PARENT_ROOT_HEX = "BLOCK_INPUT_ERROR_MISSING_PARENT_ROOT_HEX",
  MISSING_BLOCK = "BLOCK_INPUT_ERROR_MISSING_BLOCK",
  MISSING_TIME_COMPLETE = "BLOCK_INPUT_ERROR_MISSING_TIME_COMPLETE",
  MISSING_VERSIONED_HASHES = "BLOCK_INPUT_ERROR_MISSING_VERSIONED_HASHES",

  // Mismatched values
  MISMATCHED_ROOT_HEX = "BLOCK_INPUT_ERROR_MISMATCHED_ROOT_HEX",
  MISMATCHED_SLOT = "BLOCK_INPUT_ERROR_MISMATCHED_SLOT",
  MISMATCHED_KZG_COMMITMENT = "BLOCK_INPUT_ERROR_MISMATCHED_KZG_COMMITMENT",
  // MISMATCHED_KZG_COMMITMENT_LENGTH = "BLOCK_INPUT_ERROR_MISMATCHED_KZG_COMMITMENT_LENGTH",

  UNKNOWN_NUMBER_OF_BLOBS = "BLOCK_INPUT_ERROR_UNKNOWN_NUMBER_OF_BLOBS",

  Z = "BLOCK_INPUT_ERROR_Z",
}

export type BlockInputErrorType =
  | {
      code:
        | BlockInputErrorCode.MISSING_FORK_NAME
        | BlockInputErrorCode.MISSING_SLOT
        | BlockInputErrorCode.MISSING_PARENT_ROOT_HEX
        | BlockInputErrorCode.MISSING_BLOCK
        | BlockInputErrorCode.MISSING_TIME_COMPLETE
        | BlockInputErrorCode.MISSING_VERSIONED_HASHES;
      blockRoot: string;
    }
  | {
      code: BlockInputErrorCode.UNDEFINED_PROP;
      blockRoot: string;
      propName: string;
    }
  | {
      code: BlockInputErrorCode.INVALID_CONSTRUCTION;
      blockRoot: string;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_ROOT_HEX;
      blockInputRoot: string;
      mismatchedRoot: string;
      source: BlockInputSource;
      peerId: PeerIdStr;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_SLOT;
      blockRoot: string;
      blockInputSlot: undefined | Slot;
      blockSlot: number;
      sidecarSlot: number;
    }
  | {
      code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT;
      blockRoot: string;
      slot: undefined | Slot;
      sidecarIndex: number;
      commitmentIndex?: number;
    }
  // | {
  //     code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT_LENGTH;
  //     blockRoot: string;
  //     slot: undefined | Slot;
  //     columnIndex: number;
  //     blockCommitments: number;
  //     sidecarCommitments: number;
  //   }
  | {
      code: BlockInputErrorCode.UNKNOWN_NUMBER_OF_BLOBS;
      blockRoot: string;
      slot: Slot | string;
    }
  | (LogMetaBlobs & {code: BlockInputErrorCode.INCOMPLETE_DATA});
// | (LogMetaColumns & {code: BlockInputErrorCode.INCOMPLETE_DATA})

export class BlockInputError extends LodestarError<BlockInputErrorType> {}
