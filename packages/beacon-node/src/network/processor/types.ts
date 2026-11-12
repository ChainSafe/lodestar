import type {Message} from "@libp2p/gossipsub";
import {ForkName} from "@lodestar/params";
import {Slot, SlotOptionalRoot} from "@lodestar/types";
import {PeerIdStr} from "../../util/peerId.js";
import {GossipTopic, GossipType} from "../gossip/index.js";

export type GossipAttestationsWork = {
  messages: PendingGossipsubMessage[];
};

export type PendingGossipsubMessage = {
  topic: GossipTopic;
  msg: Message;
  // set for every topic with a slot, held messages expire by it
  msgSlot?: Slot;
  msgId: string;
  propagationSource: PeerIdStr;
  clientAgent: string;
  clientVersion: string;
  seenTimestampSec: number;
  startProcessUnixSec: number | null;
  // specific properties for IndexedGossipQueueMinSize, for beacon_attestation topic only
  indexed?: string;
  queueAddedMs?: number;
};

export type ExtractSlotRootFns = {
  [K in GossipType]?: (data: Uint8Array, forkName: ForkName) => SlotOptionalRoot | null;
};
