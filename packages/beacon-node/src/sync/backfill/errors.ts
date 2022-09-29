import {PeerId} from "@libp2p/interface-peer-id";
import {LodestarError} from "@lodestar/utils";
import {Root} from "@lodestar/types";

export enum BackfillSyncErrorCode {
  /** fetched block doesn't connect to anchor block */
  NOT_ANCHORED = "not_anchored",
  /** fetched blocks are not linear */
  NOT_LINEAR = "not_linear",
  /** peer doesn't have required block by root */
  MISSING_BLOCK = "missing_blocks",
  INVALID_SIGNATURE = "invalid_proposer_signature",
  INTERNAL_ERROR = "backfill_internal_error",
}

export type BackfillSyncErrorType =
  | {code: BackfillSyncErrorCode.NOT_ANCHORED}
  | {code: BackfillSyncErrorCode.NOT_LINEAR}
  | {code: BackfillSyncErrorCode.INVALID_SIGNATURE}
  | {code: BackfillSyncErrorCode.MISSING_BLOCK; root: Root; peerId: PeerId}
  | {code: BackfillSyncErrorCode.INTERNAL_ERROR; reason: string};

export class BackfillSyncError extends LodestarError<BackfillSyncErrorType> {}
