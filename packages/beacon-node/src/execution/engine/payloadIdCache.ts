import {byteArrayEquals} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {bellatrix} from "@lodestar/types";
import {pruneSetToMax} from "@lodestar/utils";
import {PayloadAttributesRpc} from "./types.js";
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

type FcuAttributes = {headBlockHash: DATA; finalizedBlockHash: DATA} & Omit<
  PayloadAttributesRpc,
  "withdrawals" | "inclusionListTransactions"
> & {inclusionListTransactions?: bellatrix.Transactions};

export class PayloadIdCache {
  private readonly payloadIdByFcuAttributes = new Map<
    string,
    {payloadId: PayloadId; fullKey: string; inclusionListTransactions?: bellatrix.Transactions}
  >();

  getFullKey({headBlockHash, finalizedBlockHash, timestamp, prevRandao, suggestedFeeRecipient}: FcuAttributes): string {
    return `${headBlockHash}-${finalizedBlockHash}-${timestamp}-${prevRandao}-${suggestedFeeRecipient}`;
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
    const {inclusionListTransactions} = fcuAttributes;
    this.payloadIdByFcuAttributes.set(key, {payloadId, fullKey, inclusionListTransactions});
  }

  prune(): void {
    // This is not so optimized function, but could maintain a 2d array may be?
    pruneSetToMax(this.payloadIdByFcuAttributes, MAX_PAYLOAD_IDS);
  }

  get(fcuAttributes: FcuAttributes): PayloadId | undefined {
    const key = this.getKey(fcuAttributes);
    const fullKey = this.getFullKey(fcuAttributes);
    const payloadInfo = this.payloadIdByFcuAttributes.get(key);
    return payloadInfo?.fullKey === fullKey &&
      isSameInclusionList(payloadInfo.inclusionListTransactions, fcuAttributes.inclusionListTransactions)
      ? payloadInfo.payloadId
      : undefined;
  }
}

function isSameInclusionList(a?: bellatrix.Transactions, b?: bellatrix.Transactions): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.length === b.length && a.every((transaction, i) => byteArrayEquals(transaction, b[i]));
}
