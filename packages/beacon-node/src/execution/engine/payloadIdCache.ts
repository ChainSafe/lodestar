import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {pruneSetToMax} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {DATA, QUANTITY} from "../../eth1/provider/utils.js";
import {PayloadAttributesRpc} from "./types.js";

// Idealy this only need to be set to the max head reorgs number
const MAX_PAYLOAD_IDS = SLOTS_PER_EPOCH;

// An execution engine can produce a payload id anywhere the the uint64 range
// Since we do no processing with this id, we have no need to deserialize it
export type PayloadId = string;

export type WithdrawalV1 = {
  index: QUANTITY;
  validatorIndex: QUANTITY;
  address: DATA;
  amount: QUANTITY;
};

type FcuAttributes = {headBlockHash: DATA; finalizedBlockHash: DATA} & Omit<PayloadAttributesRpc, "withdrawals">;

export class PayloadIdCache {
  private readonly payloadIdByFcuAttributes = new Map<string, {payloadId: PayloadId; fullKey: string}>();
  constructor(private readonly metrics?: Metrics | null) {}

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
    this.payloadIdByFcuAttributes.set(key, {payloadId, fullKey});
  }

  prune(): void {
    // This is not so optimized function, but could maintain a 2d array may be?
    pruneSetToMax(this.payloadIdByFcuAttributes, MAX_PAYLOAD_IDS);
  }

  get(fcuAttributes: FcuAttributes): PayloadId | undefined {
    const key = this.getKey(fcuAttributes);
    const fullKey = this.getFullKey(fcuAttributes);
    const payloadInfo = this.payloadIdByFcuAttributes.get(key);
    return payloadInfo?.fullKey === fullKey ? payloadInfo.payloadId : undefined;
  }
}
