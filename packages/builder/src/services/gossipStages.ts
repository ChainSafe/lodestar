import fs from "node:fs";
import path from "node:path";
import {BuilderIndex} from "@lodestar/types";
import {BidLedger} from "./bidLedger.js";
import {BidPublisher} from "./bidPublisher.js";
import {BidStore} from "./bidStore.js";
import {BuilderStatusTracker} from "./builderStatusTracker.js";
import {PAYLOAD_RETENTION_SLOTS} from "./commitmentLimits.js";

export const MAX_ADDITIONAL_GOSSIP_IDENTITIES = 4;

export type GossipStage = {
  /** Time since the start of the preceding slot; 10000 is the proposal slot boundary. */
  deadlineBps: number;
  builderIndex: BuilderIndex;
  ledger: BidLedger;
  bidStore: BidStore;
  bidPublisher: BidPublisher;
  getBuilderStatus: BuilderStatusTracker["getStatus"];
};

export function validateGossipStages(
  primary: {builderIndex: BuilderIndex; deadlineBps: number},
  stages: Pick<GossipStage, "builderIndex" | "deadlineBps">[],
  updateCutoffBps: number
): void {
  if (stages.length > MAX_ADDITIONAL_GOSSIP_IDENTITIES) throw Error("GOSSIP_STAGE_LIMIT");
  const indices = new Set([primary.builderIndex]);
  let previous = primary.deadlineBps;
  for (const stage of stages) {
    if (indices.has(stage.builderIndex)) throw Error("GOSSIP_STAGE_DUPLICATE_IDENTITY");
    indices.add(stage.builderIndex);
    if (
      !Number.isSafeInteger(stage.deadlineBps) ||
      stage.deadlineBps <= previous ||
      stage.deadlineBps >= 10000 + updateCutoffBps
    )
      throw Error("GOSSIP_STAGE_INVALID_DEADLINE");
    previous = stage.deadlineBps;
  }
}

/** Match Lodestar's gossip forwarding floor; peers may already have a higher competing bid. */
export function getMinGossipBidValue(previous: number): number {
  const increment = Math.min(Math.max(100_000, Math.floor(previous / 10_000) * 300), 10_000_000);
  return previous + increment;
}

export function gossipJournalDirectory(commitmentDir: string): string {
  return `${path.resolve(commitmentDir)}-gossip`;
}

/** Removing a configured signer must not silently discard a live reveal obligation. */
export function assertGossipJournalsConfigured(commitmentDir: string, pubkeys: Set<string>, currentSlot: number): void {
  const directory = gossipJournalDirectory(commitmentDir);
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (!/^0x[0-9a-f]{96}$/.test(entry.name)) throw Error("GOSSIP_JOURNAL_INVALID_IDENTITY");
    if (!entry.isDirectory()) throw Error("GOSSIP_JOURNAL_INVALID_DIRECTORY");
    if (pubkeys.has(entry.name)) continue;
    for (const name of fs.readdirSync(path.join(directory, entry.name))) {
      const bid = /^bid-(\d+)-0x[0-9a-f]{64}\.json$/.exec(name);
      if (bid && Number(bid[1]) + PAYLOAD_RETENTION_SLOTS >= currentSlot) throw Error("GOSSIP_JOURNAL_SIGNER_MISSING");
    }
  }
}
