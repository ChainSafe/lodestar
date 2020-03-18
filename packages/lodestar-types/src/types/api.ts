/* eslint-disable @typescript-eslint/interface-name-prefix */
import {BLSPubkey, BLSSignature, CommitteeIndex, Slot, Uint64} from "./primitive";
import {Fork} from "./misc";

export interface SubscribeToCommitteeSubnetPayload {
  slot: Slot;
  slotSignature: BLSSignature;
  committeeIndex: CommitteeIndex;
  aggregatorPubkey: BLSPubkey;
}

export interface ForkResponse {
  chainId: Uint64;
  fork: Fork;
}