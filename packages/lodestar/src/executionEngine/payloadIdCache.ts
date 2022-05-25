import {pruneSetToMax} from "../util/map.js";
import {IMetrics} from "../metrics/index.js";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {DATA, QUANTITY} from "../eth1/provider/utils.js";

// Idealy this only need to be set to the max head reorgs number
const MAX_PAYLOAD_IDS = SLOTS_PER_EPOCH;

// An execution engine can produce a payload id anywhere the the uint64 range
// Since we do no processing with this id, we have no need to deserialize it
export type PayloadId = string;

export type ApiPayloadAttributes = {
  /** QUANTITY, 64 Bits - value for the timestamp field of the new payload */
  timestamp: QUANTITY;
  /** DATA, 32 Bytes - value for the prevRandao field of the new payload */
  prevRandao: DATA;
  /** DATA, 20 Bytes - suggested value for the coinbase field of the new payload */
  suggestedFeeRecipient: DATA;
};

type FcuAttributes = {headBlockHash: DATA; finalizedBlockHash: DATA} & ApiPayloadAttributes;

export class PayloadIdCache {
  private readonly payloadIdByFcuAttributes = new Map<string, PayloadId>();
  constructor(private readonly metrics?: IMetrics | null) {}

  getKey({headBlockHash, finalizedBlockHash, timestamp, prevRandao, suggestedFeeRecipient}: FcuAttributes): string {
    return `${headBlockHash}-${finalizedBlockHash}-${timestamp}-${prevRandao}-${suggestedFeeRecipient}`;
  }

  add(fcuAttributes: FcuAttributes, payloadId: PayloadId): void {
    const key = this.getKey(fcuAttributes);
    this.payloadIdByFcuAttributes.set(key, payloadId);
  }

  prune(): void {
    // This is not so optimized function, but could maintain a 2d array may be?
    pruneSetToMax(this.payloadIdByFcuAttributes, MAX_PAYLOAD_IDS);
  }

  get(fcuAttributes: FcuAttributes): PayloadId | undefined {
    const key = this.getKey(fcuAttributes);
    return this.payloadIdByFcuAttributes.get(key);
  }
}
