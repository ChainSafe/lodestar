import * as altair from "../altair/types";
import {Root, Bytes32, Number64, ExecutionAddress, Uint256} from "../primitive/types";

export type Transaction = Uint8Array;

type ExecutionPayloadFields = {
  // Execution block header fields
  parentHash: Root;
  feeRecipient: ExecutionAddress;
  stateRoot: Bytes32;
  receiptsRoot: Bytes32;
  logsBloom: Uint8Array;
  prevRandao: Bytes32;
  blockNumber: number;
  gasLimit: Number64;
  gasUsed: Number64;
  timestamp: Number64;
  extraData: Uint8Array;
  baseFeePerGas: Uint256;
  // Extra payload fields
  blockHash: Bytes32;
};

export type ExecutionPayload = ExecutionPayloadFields & {
  transactions: Transaction[];
};

export type ExecutionPayloadHeader = ExecutionPayloadFields & {
  transactionsRoot: Root;
};

export interface BeaconBlockBody extends altair.BeaconBlockBody {
  executionPayload: ExecutionPayload;
}

export interface BeaconBlock extends altair.BeaconBlock {
  body: BeaconBlockBody;
}

export interface SignedBeaconBlock extends altair.SignedBeaconBlock {
  message: BeaconBlock;
}

export interface BeaconState extends altair.BeaconState {
  latestExecutionPayloadHeader: ExecutionPayloadHeader;
}

export type PowBlock = {
  blockHash: Root;
  parentHash: Root;
  totalDifficulty: bigint;
};
