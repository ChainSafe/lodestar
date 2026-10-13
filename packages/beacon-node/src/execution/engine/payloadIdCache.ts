import {byteArrayEquals} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {bellatrix} from "@lodestar/types";
import {pruneSetToMax} from "@lodestar/utils";
import {DATA, QUANTITY} from "./utils.js";

// Idealy this only need to be set to the max head reorgs number
const MAX_PAYLOAD_IDS = SLOTS_PER_EPOCH;

// An execution engine can produce a payload id anywhere the uint64 range
// Since we do no processing with this id, we have no need to deserialize it
export type PayloadId = string;

export type WithdrawalV1 = {
  index: QUANTITY;
  validatorIndex: QUANTITY;
  address: DATA;
  amount: QUANTITY;
};

export type FcuAttributes = {
  headBlockHash: DATA;
  finalizedBlockHash: DATA;
  timestamp: QUANTITY;
  prevRandao: DATA;
  suggestedFeeRecipient: DATA;
  inclusionListTransactions?: bellatrix.Transactions;
};

export class PayloadIdCache {
  private readonly payloadIdByFcuAttributes = new Map<string, {payloadId: PayloadId; fullKey: FcuAttributes}>();

  getFullKey({
    headBlockHash,
    finalizedBlockHash,
    timestamp,
    prevRandao,
    suggestedFeeRecipient,
    inclusionListTransactions,
  }: FcuAttributes): FcuAttributes {
    return {headBlockHash, finalizedBlockHash, timestamp, prevRandao, suggestedFeeRecipient, inclusionListTransactions};
  }
  getKey({timestamp}: Pick<FcuAttributes, "timestamp">): string {
    return timestamp;
  }

  hasPayload(fcuAttributes: Pick<FcuAttributes, "timestamp">): boolean {
    const key = this.getKey(fcuAttributes);
    return this.payloadIdByFcuAttributes.get(key) !== undefined;
  }

  add(fcuAttributes: FcuAttributes, payloadId: PayloadId): void {
    const key = this.getKey(fcuAttributes);
    const fullKey = this.getFullKey(fcuAttributes);
    this.payloadIdByFcuAttributes.set(key, {payloadId, fullKey});
  }

  prune(): void {
    // This is not so optimized function, but could maintain a 2d array may be?
    pruneSetToMax(this.payloadIdByFcuAttributes, MAX_PAYLOAD_IDS);
  }

  get(fcuAttributes: FcuAttributes): PayloadId | undefined {
    const key = this.getKey(fcuAttributes);
    const payloadInfo = this.payloadIdByFcuAttributes.get(key);
    return payloadInfo !== undefined && isSameFullKey(payloadInfo.fullKey, fcuAttributes)
      ? payloadInfo.payloadId
      : undefined;
  }
}

function isSameFullKey(a: FcuAttributes, b: FcuAttributes): boolean {
  return (
    a.headBlockHash === b.headBlockHash &&
    a.finalizedBlockHash === b.finalizedBlockHash &&
    a.timestamp === b.timestamp &&
    a.prevRandao === b.prevRandao &&
    a.suggestedFeeRecipient === b.suggestedFeeRecipient &&
    isSameInclusionList(a.inclusionListTransactions, b.inclusionListTransactions)
  );
}

function isSameInclusionList(a?: bellatrix.Transactions, b?: bellatrix.Transactions): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.length === b.length && a.every((transaction, i) => byteArrayEquals(transaction, b[i]));
}
