/* eslint-disable @typescript-eslint/interface-name-prefix */
import {BLSPubkey, BLSSignature, CommitteeIndex, Slot} from "./primitive";

export interface SubscribeToCommitteeSubnetPayload {
  slot: Slot;
  slotSignature: BLSSignature;
  committeeIndex: CommitteeIndex;
  aggregatorPubkey: BLSPubkey;
}