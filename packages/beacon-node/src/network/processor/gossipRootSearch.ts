import {RootHex, Slot, SlotRootHex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {BlockInputSource} from "../../chain/blocks/blockInput/types.js";
import {ChainEvent} from "../../chain/emitter.js";
import {IBeaconChain} from "../../chain/interface.js";
import {PeerIdStr} from "../../util/peerId.js";
import {MAX_PEERS_PER_ROOT} from "./constants.js";

/**
 * Max distinct roots we emit an unknown-root search for, per slot. Higher than
 * the buffer budget because:
 * - in the attack scenario, the genuine root may comes after the first MAX_BUFFERED_ROOTS_PER_SLOT roots
 * - if we cannot search, we'll penalize peers in UnknownBlockInput, not in NetworkProcessor
 */
export const MAX_SEARCHED_ROOTS_PER_SLOT = 32;

/**
 * Track the forwarded peers we already emit to UnknownBlockInput sync.
 * envelopeSlotEmitted: whether the unknownEnvelopeBlockRootSlot event was already emitted for this root.
 */
type SearchedRootEntry = {
  blockPeerIds?: Set<PeerIdStr>;
  envelopePeerIds?: Set<PeerIdStr>;
  envelopeSlotEmitted?: boolean;
};

export class GossipRootSearch {
  private readonly searchedRootsBySlot = new MapDef<Slot, MapDef<RootHex, SearchedRootEntry>>(
    () => new MapDef<RootHex, SearchedRootEntry>(() => ({}))
  );

  constructor(private readonly chain: IBeaconChain) {}
  clear(): void {
    this.searchedRootsBySlot.clear();
  }
  prune(minSlot: number): void {
    for (const slot of this.searchedRootsBySlot.keys()) {
      if (slot <= minSlot) this.searchedRootsBySlot.delete(slot);
    }
  }
  hasRoom({slot, root}: SlotRootHex, peer?: PeerIdStr): boolean {
    const roots = this.searchedRootsBySlot.get(slot);
    if (roots === undefined || roots.has(root)) return true;
    if (roots.size >= MAX_SEARCHED_ROOTS_PER_SLOT) return false;
    if (peer !== undefined) {
      let fromPeer = 0;
      for (const entry of roots.values()) {
        if (entry.blockPeerIds?.has(peer) || entry.envelopePeerIds?.has(peer)) fromPeer++;
      }
      if (fromPeer >= 4) return false;
    }
    return true;
  }

  /**
   * Search block via `ChainEvent.unknownBlockRoot` event
   * Slot is the message slot, which is not necessarily the same as the block's slot, but it can be used for a good prune strategy.
   * In the rare case, if 2 messages on 2 slots search for the same root (for example beacon_attestation) we may emit the same root twice but BlockInputSync should handle it well.
   * We forward every distinct peer that gossiped this root (not just the first) so BlockInputSync can
   * prefer them as by-root download candidates.
   */
  searchUnknownBlock({slot, root}: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr): void {
    if (this.chain.seenBlock(root)) {
      return;
    }
    const entry = this.searchedRootsBySlot.getOrDefault(slot).getOrDefault(root);
    const alreadySearching = entry.blockPeerIds !== undefined;
    if (entry.blockPeerIds === undefined) {
      entry.blockPeerIds = new Set();
    }
    const forwardedPeers = entry.blockPeerIds;

    // brand-new search always emits (peer may be undefined)
    let shouldEmit = !alreadySearching;
    if (peer !== undefined && !forwardedPeers.has(peer) && forwardedPeers.size < MAX_PEERS_PER_ROOT) {
      // First time we forward THIS peer for THIS root: emit so BlockInputSync accumulates it.
      forwardedPeers.add(peer);
      shouldEmit = true;
    }
    if (shouldEmit) {
      this.chain.emitter.emit(ChainEvent.unknownBlockRoot, {rootHex: root, peer, source});
    }
  }

  /**
   * Search envelope via `ChainEvent.unknownEnvelopeBlockRoot` / `ChainEvent.unknownEnvelopeBlockRootSlot` event
   * Slot is the message slot, which is not necessarily the same as the envelope's slot, but it can be used for a good prune strategy.
   * In the rare case, if 2 messages on 2 slots search for the same root (for example beacon_attestation) we may emit the same root twice but BlockInputSync should handle it well.
   * Same peer-forwarding + dedup behavior as searchUnknownBlock.
   */
  searchUnknownEnvelope(
    {slot, root}: SlotRootHex,
    source: BlockInputSource,
    peer?: PeerIdStr,
    slotIsPayloadSlot = false
  ): void {
    if (this.chain.seenPayloadEnvelope(root)) {
      return;
    }
    const entry = this.searchedRootsBySlot.getOrDefault(slot).getOrDefault(root);
    const alreadySearching = entry.envelopePeerIds !== undefined;
    if (entry.envelopePeerIds === undefined) {
      entry.envelopePeerIds = new Set();
    }
    const forwardedPeers = entry.envelopePeerIds;

    let shouldEmit = !alreadySearching; // brand-new search always emits (peer may be undefined)
    if (peer !== undefined && !forwardedPeers.has(peer) && forwardedPeers.size < MAX_PEERS_PER_ROOT) {
      // First time we forward THIS peer for THIS root: emit so BlockInputSync accumulates it.
      forwardedPeers.add(peer);
      shouldEmit = true;
    }
    // the payload-slot seed must reach the sync once, even if a slot-less trigger started the search first
    if (slotIsPayloadSlot && !entry.envelopeSlotEmitted) {
      shouldEmit = true;
    }
    if (shouldEmit) {
      if (slotIsPayloadSlot) {
        entry.envelopeSlotEmitted = true;
        this.chain.emitter.emit(ChainEvent.unknownEnvelopeBlockRootSlot, {rootHex: root, slot, peer, source});
      } else {
        this.chain.emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {rootHex: root, peer, source});
      }
    }
  }
}
