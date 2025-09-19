import {Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {PeerIdStr} from "../../../util/peerId.js";
import {BlockInputSource, LogMetaBlobs, LogMetaColumns} from "./types.js";

export enum BlockInputErrorCode {
  // Bad Arguments
  INVALID_CONSTRUCTION = "BLOCK_INPUT_ERROR_INVALID_CONSTRUCTION",

  // Attempt to get all data but some is missing
  INCOMPLETE_DATA = "BLOCK_INPUT_ERROR_INCOMPLETE_DATA",

  // Missing class property values for getters
  MISSING_BLOCK = "BLOCK_INPUT_ERROR_MISSING_BLOCK",
  MISSING_TIME_COMPLETE = "BLOCK_INPUT_ERROR_MISSING_TIME_COMPLETE",

  // Mismatched values
  MISMATCHED_ROOT_HEX = "BLOCK_INPUT_ERROR_MISMATCHED_ROOT_HEX",
  MISMATCHED_KZG_COMMITMENT = "BLOCK_INPUT_ERROR_MISMATCHED_KZG_COMMITMENT",
}

export type BlockInputErrorType =
  | {
      code: BlockInputErrorCode.MISSING_BLOCK | BlockInputErrorCode.MISSING_TIME_COMPLETE;
      blockRoot: string;
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
      code: BlockInputErrorCode.MISMATCHED_KZG_COMMITMENT;
      blockRoot: string;
      slot: undefined | Slot;
      sidecarIndex: number;
      commitmentIndex?: number;
    }
  | (LogMetaBlobs & {code: BlockInputErrorCode.INCOMPLETE_DATA})
  | (LogMetaColumns & {code: BlockInputErrorCode.INCOMPLETE_DATA});

export class BlockInputError extends LodestarError<BlockInputErrorType> {}
