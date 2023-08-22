import {Message} from "@libp2p/interface/pubsub";
import {Slot, SlotOptionalRoot} from "@lodestar/types";
import {GossipTopic, GossipType} from "../gossip/index.js";
import {PeerIdStr} from "../../util/peerId.js";

export type GossipAttestationsWork = {
  messages: PendingGossipsubMessage[];
};

export type PendingGossipsubMessage = {
  topic: GossipTopic;
  msg: Message;
  // only available for beacon_attestation and aggregate_and_proof
  msgSlot?: Slot;
  msgId: string;
  propagationSource: PeerIdStr;
  seenTimestampSec: number;
  startProcessUnixSec: number | null;
  // specific properties for IndexedGossipQueueMinSize, for beacon_attestation topic only
  indexed?: string;
  queueAddedMs?: number;
};

export type ExtractSlotRootFns = {
  [K in GossipType]?: (data: Uint8Array) => SlotOptionalRoot | null;
};
