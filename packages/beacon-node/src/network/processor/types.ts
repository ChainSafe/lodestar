import {PeerId} from "@libp2p/interface-peer-id";
import {Message} from "@libp2p/interface-pubsub";
import {Slot} from "@lodestar/types";
import {SlotRootHex} from "@lodestar/types";
import {GossipTopic, GossipType} from "../gossip/index.js";

export type GossipAttestationsWork = {
  messages: PendingGossipsubMessage[];
};

export type PendingGossipsubMessage = {
  topic: GossipTopic;
  msg: Message;
  msgId: string;
  // TODO: Refactor into accepting string (requires gossipsub changes) for easier multi-threading
  propagationSource: PeerId;
  seenTimestampSec: number;
  startProcessUnixSec: number | null;
  /** From AttnetsService and SyncnetsService signaling if message only needs to be validated */
  importUpToSlot: Slot | null;
};

export type ExtractSlotRootFns = {
  [K in GossipType]?: (data: Uint8Array) => SlotRootHex | null;
};
