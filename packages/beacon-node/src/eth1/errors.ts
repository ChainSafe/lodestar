import {LodestarError} from "@lodestar/utils";

export enum Eth1ErrorCode {
  /** Deposit index too high */
  DEPOSIT_INDEX_TOO_HIGH = "ETH1_ERROR_DEPOSIT_INDEX_TOO_HIGH",
  /** Not enough deposits in DB */
  NOT_ENOUGH_DEPOSITS = "ETH1_ERROR_NOT_ENOUGH_DEPOSITS",
  /** Too many deposits returned by DB */
  TOO_MANY_DEPOSITS = "ETH1_ERROR_TOO_MANY_DEPOSITS",
  /** Deposit root tree does not match current eth1Data */
  WRONG_DEPOSIT_ROOT = "ETH1_ERROR_WRONG_DEPOSIT_ROOT",

  /** No deposits found for block range */
  NO_DEPOSITS_FOR_BLOCK_RANGE = "ETH1_ERROR_NO_DEPOSITS_FOR_BLOCK_RANGE",
  /** No depositRoot for depositCount */
  NO_DEPOSIT_ROOT = "ETH1_ERROR_NO_DEPOSIT_ROOT",
  /** Not enough deposit roots for index */
  NOT_ENOUGH_DEPOSIT_ROOTS = "ETH1_ERROR_NOT_ENOUGH_DEPOSIT_ROOTS",

  /** Attempted to insert a duplicate log for same index into the Eth1DepositsCache */
  DUPLICATE_DISTINCT_LOG = "ETH1_ERROR_DUPLICATE_DISTINCT_LOG",
  /** Attempted to insert a log with index != prev + 1 into the Eth1DepositsCache */
  NON_CONSECUTIVE_LOGS = "ETH1_ERROR_NON_CONSECUTIVE_LOGS",
  /** Expected a deposit log in the db for the index, missing log implies a corrupted db */
  MISSING_DEPOSIT_LOG = "ETH1_ERROR_MISSING_DEPOSIT_LOG",
  /** Expected transactions or withdrawals for un-blinding block from db before serving */
  INVALID_PAYLOAD_BODY = "ETH1_ERROR_INVALID_PAYLOAD_BODY",
}

export type Eth1ErrorType =
  | {code: Eth1ErrorCode.DEPOSIT_INDEX_TOO_HIGH; depositIndex: number; depositCount: number}
  | {code: Eth1ErrorCode.NOT_ENOUGH_DEPOSITS; len: number; expectedLen: number}
  | {code: Eth1ErrorCode.TOO_MANY_DEPOSITS; len: number; expectedLen: number}
  | {code: Eth1ErrorCode.WRONG_DEPOSIT_ROOT; root: string; expectedRoot: string}
  | {code: Eth1ErrorCode.NO_DEPOSITS_FOR_BLOCK_RANGE; fromBlock: number; toBlock: number}
  | {code: Eth1ErrorCode.NO_DEPOSIT_ROOT; depositCount: number}
  | {code: Eth1ErrorCode.NOT_ENOUGH_DEPOSIT_ROOTS; index: number; treeLength: number}
  | {code: Eth1ErrorCode.DUPLICATE_DISTINCT_LOG; newIndex: number; lastLogIndex: number}
  | {code: Eth1ErrorCode.NON_CONSECUTIVE_LOGS; newIndex: number; lastLogIndex: number}
  | {code: Eth1ErrorCode.MISSING_DEPOSIT_LOG; newIndex: number; lastLogIndex: number}
  | {code: Eth1ErrorCode.INVALID_PAYLOAD_BODY; blockHash: string};

export class Eth1Error extends LodestarError<Eth1ErrorType> {}
