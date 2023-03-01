import {Slot, RootHex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {Metrics} from "../metrics/index.js";

/**
 * To prevent our node from having to reprocess while struggling to sync,
 * we only want to reprocess attestations if block reaches our node before this time.
 */
export const REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC = 2;

/**
 * Reprocess status for metrics
 */
enum ReprocessStatus {
  /**
   * There are too many attestations that have unknown block root.
   */
  reached_limit = "reached_limit",
  /**
   * The awaiting attestation is pruned per clock slot.
   */
  expired = "expired",
}

type AwaitingAttestationPromise = {
  resolve: (foundBlock: boolean) => void;
  promise: Promise<boolean>;
  // there are multiple subnet/aggregated attestations waiting for same promise
  awaitingAttestationsCount: number;
  // we only resolve to true or false to make the code simpler so no need to keep reject here
  addedTimeMs: number;
};

// How many attestations (aggregate + unaggregate) we keep before new ones get dropped.
const MAXIMUM_QUEUED_ATTESTATIONS = 16_384;

type SlotRoot = {slot: Slot; root: RootHex};

/**
 * Some attestations may reach our node before the voted block, so we manage a cache to reprocess them
 * when the block come.
 * (n)                                               (n + 1)
 *  |----------------|----------------|----------|------|
 *                   |                |          |
 *                  att           agg att        |
 *                                              block
 * Since the gossip handler has to return validation result to js-libp2p-gossipsub, this class should not
 * reprocess attestations, it should control when the attestations are ready to reprocess instead.
 */
export class ReprocessController {
  private readonly awaitingPromisesByRootBySlot: MapDef<Slot, Map<RootHex, AwaitingAttestationPromise>>;
  private awaitingPromisesCount = 0;

  constructor(private readonly metrics: Metrics | null) {
    this.awaitingPromisesByRootBySlot = new MapDef(() => new Map<RootHex, AwaitingAttestationPromise>());
  }

  /**
   * Returns Promise that resolves either on block found or once 1 slot passes.
   * Used to handle unknown block root for both unaggregated and aggregated attestations.
   * @returns true if blockFound
   */
  waitForBlockOfAttestation(slot: Slot, root: RootHex): Promise<boolean> {
    this.metrics?.reprocessAttestations.total.inc();

    if (this.awaitingPromisesCount >= MAXIMUM_QUEUED_ATTESTATIONS) {
      this.metrics?.reprocessAttestations.reject.inc({reason: ReprocessStatus.reached_limit});
      return Promise.resolve(false);
    }

    this.awaitingPromisesCount++;
    const awaitingPromisesByRoot = this.awaitingPromisesByRootBySlot.getOrDefault(slot);
    const promiseCached = awaitingPromisesByRoot.get(root);
    if (promiseCached) {
      promiseCached.awaitingAttestationsCount++;
      return promiseCached.promise;
    }

    // Capture both the promise and its callbacks.
    // It is not spec'ed but in tests in Firefox and NodeJS the promise constructor is run immediately
    let resolve: AwaitingAttestationPromise["resolve"] | null = null;
    const promise = new Promise<boolean>((resolveCB) => {
      resolve = resolveCB;
    });

    if (resolve === null) {
      throw Error("Promise Constructor was not executed immediately");
    }

    awaitingPromisesByRoot.set(root, {
      promise,
      awaitingAttestationsCount: 1,
      resolve,
      addedTimeMs: Date.now(),
    });

    return promise;
  }

  /**
   * It's important to make sure our node is synced before we reprocess,
   * it means the processed slot is same to clock slot
   * Note that we want to use clock advanced by REPROCESS_MIN_TIME_TO_NEXT_SLOT instead of
   * clockSlot because we want to make sure our node is healthy while reprocessing attestations.
   * If a block reach our node 1s before the next slot, for example, then probably node
   * is struggling and we don't want to reprocess anything at that time.
   */
  onBlockImported({slot: blockSlot, root}: SlotRoot, advancedSlot: Slot): void {
    // we are probably resyncing, don't want to reprocess attestations here
    if (blockSlot < advancedSlot) return;

    // resolve all related promises
    const awaitingPromisesBySlot = this.awaitingPromisesByRootBySlot.getOrDefault(blockSlot);
    const awaitingPromise = awaitingPromisesBySlot.get(root);
    if (awaitingPromise) {
      const {resolve, addedTimeMs, awaitingAttestationsCount} = awaitingPromise;
      resolve(true);
      this.awaitingPromisesCount -= awaitingAttestationsCount;
      this.metrics?.reprocessAttestations.resolve.inc(awaitingAttestationsCount);
      this.metrics?.reprocessAttestations.waitTimeBeforeResolve.set((Date.now() - addedTimeMs) / 1000);
    }

    // prune
    awaitingPromisesBySlot.delete(root);
  }

  /**
   * It's important to make sure our node is synced before reprocessing attestations,
   * it means clockSlot is the same to last processed block's slot, and we don't reprocess
   * attestations of old slots.
   * So we reject and prune all old awaiting promises per clock slot.
   * @param clockSlot
   */
  onSlot(clockSlot: Slot): void {
    const now = Date.now();

    for (const [key, awaitingPromisesByRoot] of this.awaitingPromisesByRootBySlot.entries()) {
      if (key < clockSlot) {
        // reject all related promises
        for (const awaitingPromise of awaitingPromisesByRoot.values()) {
          const {resolve, addedTimeMs} = awaitingPromise;
          resolve(false);
          this.metrics?.reprocessAttestations.waitTimeBeforeReject.set((now - addedTimeMs) / 1000);
          this.metrics?.reprocessAttestations.reject.inc({reason: ReprocessStatus.expired});
        }

        // prune
        this.awaitingPromisesByRootBySlot.delete(key);
      } else {
        break;
      }
    }

    // in theory there are maybe some awaiting promises waiting for a slot > clockSlot
    // in reality this never happens so reseting awaitingPromisesCount to 0 to make it simple
    this.awaitingPromisesCount = 0;
  }
}
