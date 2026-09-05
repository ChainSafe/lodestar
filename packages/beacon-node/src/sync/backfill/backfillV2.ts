import {EventEmitter} from "node:events";
import {PeerId} from "@libp2p/interface";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {IBeaconStateView, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Root, RootHex, SignedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {ErrorAborted, Logger, sleep, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/index.js";
import {GENESIS_SLOT, ZERO_HASH} from "../../constants/index.js";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {INetwork, NetworkEvent, NetworkEventData, PeerAction} from "../../network/index.js";
import {ItTrigger} from "../../util/itTrigger.js";
import {PeerIdStr} from "../../util/peerId.js";
import {shuffle} from "../../util/shuffle.js";
import {BackfillSyncMethod} from "./backfill.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors.js";
import {verifyBlockProposerSignature} from "./verify.js";

const EPOCH_FLUSH_YIELD_MS = 50; //TODO: remove this since we will change to separate thread for backfill sync.
const MAX_PEER_FAILURES = 5;
const DEFAULT_BACKFILL_BATCH_SIZE = 64;

// Phase 2 hedged fetch: a single byRoot request is raced across up to this many peers.
const HEDGE_PEER_COUNT = 3;
const HEDGE_DELAY_MS = 400;

export type BackfillSyncModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  network: INetwork;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  anchorState: IBeaconStateView;
  signal: AbortSignal;
};

export type BackfillSyncOpts = {
  backfillBatchSize: number;
  backfillToGenesis: boolean;
};

export enum BackfillSyncEvent {
  completed = "BackfillSync-completed",
}

export enum BackfillSyncStatus {
  pending = "pending",
  syncing = "syncing",
  completed = "completed",
  aborted = "aborted",
}

// numbers to stored in Prometheus metrics
const syncStatus: {[K in BackfillSyncStatus]: number} = {
  [BackfillSyncStatus.aborted]: 0,
  [BackfillSyncStatus.pending]: 1,
  [BackfillSyncStatus.syncing]: 2,
  [BackfillSyncStatus.completed]: 3,
};

type BackfillSyncEvents = {
  [BackfillSyncEvent.completed]: (oldestSlotSynced: Slot) => void;
};

type BackfillSyncEmitter = StrictEventEmitter<EventEmitter, BackfillSyncEvents>;

// per peer metadata; we should record this to recognize bad peer
type PeerMeta = {
  failedRequests: number;
};

// A block obtained from a specific peer during a Phase 2 hedged fetch.
type RacedBlock = {block: SignedBeaconBlock; peer: PeerIdStr};

/**
 * BackfillSync walks the chain backwards from the checkpoint-sync anchor down to genesis,
 * fetching every block via `BeaconBlocksByRoot`. It runs in two phases:
 *
 *  Phase 1 — batched byRoot (the `block_roots` window):
 *    A `BeaconState` carries `block_roots`, a circular buffer of the canonical block roots
 *    for the most recent `SLOTS_PER_HISTORICAL_ROOT` (8192) slots. The anchor state therefore
 *    already knows the roots for that whole window. Therefore, we could request them in large
 *    batches and verify them with `hashTreeRoot(block) === knownRoot` instead of checking the
 *    chain linkage.
 *
 *    Phase 2 — serial parentRoot walk (older than the window):
 *    Below the `block_roots` window the anchor state no longer knows the roots, so we walk
 *    one block at a time, using each block's `parentRoot` as the next root to request. The
 *    walk is inherently serial, so each single byRoot request is hedged across several peers
 *    (`fetchBlockByRootRaced`) to hide per-request failure and tail latency.
 */
export class BackfillSync extends (EventEmitter as {new (): BackfillSyncEmitter}) {
  private status: BackfillSyncStatus = BackfillSyncStatus.pending;
  private anchorRoot: Root;
  private anchorSlot: Slot;

  private epochBuffer: SignedBeaconBlock[] = [];
  private knownRoots: Root[] = []; // roots from phase 1

  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly network: INetwork;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private readonly anchorState: IBeaconStateView;

  private readonly batchSize: number;
  // Oldest slot we will backfill down to. `null` when backfilling all the way to genesis
  // (in which case the loop terminates via the `anchorRoot === ZERO_HASH` check instead).
  private readonly stopSlot: Slot | null;

  private processor = new ItTrigger();
  private peers = new Map<PeerIdStr, PeerMeta>();
  // Peer that last served a block; `pickPeers` lists it first so a hedged fetch
  // reuses an already-warm connection instead of dialing a fresh random peer.
  private lastGoodPeer: PeerIdStr | null = null;
  private signal: AbortSignal;

  constructor(opts: BackfillSyncOpts, modules: BackfillSyncModules, anchorRoot: Root, anchorSlot: Slot) {
    super();

    this.anchorRoot = anchorRoot;
    this.anchorSlot = anchorSlot;

    this.chain = modules.chain;
    this.db = modules.db;
    this.network = modules.network;
    this.config = modules.config;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.anchorState = modules.anchorState;
    this.processor = new ItTrigger();
    this.peers = new Map<PeerIdStr, PeerMeta>();
    this.signal = modules.signal;

    // Number of roots requested per batched byRoot call in Phase 1.
    // Capped by `MAX_REQUEST_BLOCKS_DENEB`
    this.batchSize = Math.max(
      1,
      Math.min(opts.backfillBatchSize || DEFAULT_BACKFILL_BATCH_SIZE, this.config.MAX_REQUEST_BLOCKS_DENEB)
    );

    // `getLatestWeakSubjectivityCheckpointEpoch()` returns `currentEpoch - wsPeriod`; clamp
    // to GENESIS_SLOT for anchors younger than one WS period (e.g. fresh testnets).
    if (opts.backfillToGenesis) {
      this.stopSlot = null;
    } else {
      const wsEpoch = Math.max(0, this.anchorState.getLatestWeakSubjectivityCheckpointEpoch());
      this.stopSlot = computeStartSlotAtEpoch(wsEpoch);
    }

    this.network.events.on(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);

    this.sync()
      .then((oldestSlotSynced) => {
        if (this.status !== BackfillSyncStatus.completed) {
          throw new ErrorAborted(`Invalid BackfillSyncStatus at completion: status = ${this.status}`);
        }
        this.emit(BackfillSyncEvent.completed, oldestSlotSynced);
        this.logger.info("BackfillSync completed", {oldestSlotSynced});
        this.close();
      })
      .catch((e) => {
        if (!(e instanceof ErrorAborted)) {
          this.logger.error("BackfillSync processor error", e);
        }
        this.status = BackfillSyncStatus.aborted;
        this.close();
      });

    const metrics = this.metrics;
    if (metrics) {
      metrics.backfillSync.status.addCollect(() => metrics.backfillSync.status.set(syncStatus[this.status]));
      metrics.backfillSync.backfilledTillSlot.addCollect(() =>
        metrics.backfillSync.backfilledTillSlot.set(this.anchorSlot)
      );
    }
  }

  /**
   * Initialize backfill sync from anchor state and DB.
   * Checks BackfilledRange to resume from a previous session.
   */
  static async init(opts: BackfillSyncOpts, modules: BackfillSyncModules): Promise<BackfillSync> {
    const {anchorState, db, logger} = modules;

    const {checkpoint: anchorCp} = anchorState.computeAnchorCheckpoint();
    const anchorSlot = anchorState.latestBlockHeader.slot;
    const anchorEpoch = computeEpochAtSlot(anchorSlot);

    const backfilledRange = await db.backfilledRange.get();
    let startRoot: Root;
    let startSlot: Slot;

    if (backfilledRange && backfilledRange.beginningEpoch === anchorEpoch) {
      const resumeEpoch = backfilledRange.endingEpoch;
      const resumeSlot = resumeEpoch * SLOTS_PER_EPOCH;

      const boundaryBlock = await db.blockArchive.get(resumeSlot);
      if (boundaryBlock) {
        startRoot = boundaryBlock.message.parentRoot;
        startSlot = resumeSlot;
        logger.info("Resuming backfill sync from previous session", {
          resumeEpoch,
          resumeSlot,
          beginningEpoch: backfilledRange.beginningEpoch,
        });
      } else {
        startRoot = anchorCp.root;
        startSlot = anchorSlot;
        logger.warn("BackfilledRange exists but boundary block missing, starting fresh", {
          resumeEpoch,
        });
      }
    } else {
      startRoot = anchorCp.root;
      startSlot = anchorSlot;

      await db.backfilledRange.put({
        beginningEpoch: anchorEpoch,
        endingEpoch: 0,
      });

      logger.info("Starting fresh backfill sync", {
        anchorSlot,
        anchorEpoch,
        anchorRoot: toRootHex(anchorCp.root),
      });
    }
    return new BackfillSync(opts, modules, startRoot, startSlot);
  }

  private async sync(): Promise<Slot> {
    await this.buildKnownRoots();
    this.processor.trigger();

    for await (const _ of this.processor) {
      if (this.status === BackfillSyncStatus.aborted) break;

      // Reached the chain root: anchorRoot becomes ZERO_HASH only as the parentRoot of
      // the genesis block, so there is nothing left to fetch — flush and complete.
      if (ssz.Root.equals(this.anchorRoot, ZERO_HASH)) {
        if (this.epochBuffer.length > 0) {
          const bufferEpoch = computeEpochAtSlot(this.epochBuffer[0].message.slot);
          await this.flushEpoch(bufferEpoch);
        }
        this.status = BackfillSyncStatus.completed;
        return this.anchorSlot;
      }

      // Reached the WS period floor: enough history for weak subjectivity, no need to go further.
      if (this.stopSlot !== null && this.anchorSlot <= this.stopSlot) {
        if (this.epochBuffer.length > 0) {
          const bufferEpoch = computeEpochAtSlot(this.epochBuffer[0].message.slot);
          await this.flushEpoch(bufferEpoch);
        }
        this.logger.info("BackfillSync reached WS period floor", {
          stopSlot: this.stopSlot,
          anchorSlot: this.anchorSlot,
        });
        this.status = BackfillSyncStatus.completed;
        return this.anchorSlot;
      }

      this.status = BackfillSyncStatus.syncing;

      // Phase 1 walks the known `block_roots` window one batch at a time; Phase 2 walks
      // older blocks one parentRoot at a time, hedged across several peers.
      const isPhase1 = this.knownRoots.length > 0;
      const peers = this.pickPeers(isPhase1 ? 1 : HEDGE_PEER_COUNT);
      if (peers.length === 0) {
        this.status = BackfillSyncStatus.pending;
        this.logger.debug("BackfillSync: no eligible peers, waiting");
        continue;
      }
      try {
        if (isPhase1) {
          await this.syncBatchByRoot(peers[0]);
        } else {
          await this.syncOneByParentRoot(peers);
        }
      } catch (e) {
        // Per-peer accounting (penalize / reportPeer) is done by the sync method that threw;
        // the loop only logs and handles a fatal abort.
        if (e instanceof BackfillSyncError) {
          switch (e.type.code) {
            case BackfillSyncErrorCode.INTERNAL_ERROR:
              this.status = BackfillSyncStatus.aborted;
              this.logger.error("BackfillSync error", {}, e);
              break;

            case BackfillSyncErrorCode.MISSING_BLOCK:
              // No peer served the block this round; the loop retries with a fresh peer set.
              this.logger.debug("BackfillSync could not fetch block, will retry", {code: e.type.code});
              break;

            default:
              this.logger.warn("BackfillSync peer request failed", {code: e.type.code});
          }
        } else {
          this.metrics?.backfillSync.errors.inc();
          this.logger.error("BackfillSync error", {}, e as Error);
        }

        if (this.status === BackfillSyncStatus.aborted) break;
      }
      if (this.signal.aborted) break;
      this.processor.trigger();
    }

    throw new ErrorAborted("BackfillSync");
  }

  /**
   * Phase 1 setup: enumerate the canonical block roots the anchor state already knows.
   *
   * `block_roots` covers slots [state.slot - SLOTS_PER_HISTORICAL_ROOT, state.slot). For each
   * slot in that window `getBlockRootAtSlot` returns the root of the most recent block at or
   * before it, so skipped slots repeat the previous root — we dedupe consecutive equal roots
   * to recover exactly one entry per real block, ordered from `anchorSlot` down to the floor.
   *
   * If the anchor state cannot supply the window (e.g. the resume point already sits below it)
   * `knownRoots` is left empty and the sync runs as a pure Phase 2 serial walk.
   */
  private async buildKnownRoots(): Promise<void> {
    try {
      const floorSlot = Math.max(GENESIS_SLOT, this.anchorState.slot - SLOTS_PER_HISTORICAL_ROOT);
      const roots: Root[] = [];
      let prevHex: RootHex | null = null;

      for (let slot = this.anchorSlot; slot >= floorSlot; slot--) {
        // `getBlockRootAtSlot` throws for slot >= state.slot; the anchor root is already known.
        const root = slot === this.anchorSlot ? this.anchorRoot : this.anchorState.getBlockRootAtSlot(slot);
        const hex = toRootHex(root);
        if (hex !== prevHex) {
          roots.push(root);
          prevHex = hex;
        }
      }

      // Drop roots whose blocks are already in `blockArchive` (e.g. from an earlier run with
      // an overlapping window). `getSlotByRoot` only reads the small root→slot index entry,
      // not the whole block, so the pre-filter is cheap even when nothing overlaps.
      const presentSlots = await Promise.all(roots.map((r) => this.db.blockArchive.getSlotByRoot(r)));
      const filtered = roots.filter((_, i) => presentSlots[i] === null);
      const skippedAlreadyStored = roots.length - filtered.length;

      this.knownRoots = filtered;
      this.logger.info("BackfillSync: built known roots window", {
        knownRoots: filtered.length,
        skippedAlreadyStored,
        fromSlot: this.anchorSlot,
        floorSlot,
      });
    } catch (e) {
      // Defensive: degrade to a pure serial parentRoot walk rather than aborting the sync.
      this.knownRoots = [];
      this.logger.warn("BackfillSync: could not build known roots window, falling back to serial walk", {}, e as Error);
    }
  }

  /**
   * Phase 1 step: request a batch of known roots in a single byRoot call.
   *
   * The roots come from the trusted anchor state, so verification is just
   * `hashTreeRoot(block) === requestedRoot` plus a (batched) proposer-signature check — no
   * chain-linkage check is needed. A peer may omit roots it does not have; we consume only
   * the contiguous prefix it returned and leave the rest queued for another peer.
   */
  private async syncBatchByRoot(peer: PeerIdStr): Promise<void> {
    const batch = this.knownRoots.slice(0, this.batchSize);
    const blocks = await this.network.sendBeaconBlocksByRoot(peer, batch);

    const blockByRoot = new Map<RootHex, SignedBeaconBlock>();
    for (const block of blocks) {
      const root = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
      blockByRoot.set(toRootHex(root), block);
    }

    // Take the contiguous prefix of requested roots the peer actually returned, so the
    // walk stays gap-free; any trailing missing roots remain queued for retry.
    const received: SignedBeaconBlock[] = [];
    for (const root of batch) {
      const block = blockByRoot.get(toRootHex(root));
      if (!block) break;
      received.push(block);
    }

    if (received.length === 0) {
      this.onPeerRequestFailed(peer);
      this.metrics?.backfillSync.errors.inc();
      throw new BackfillSyncError({
        code: BackfillSyncErrorCode.MISSING_BLOCK,
        root: batch[0],
        peerId: peer as unknown as PeerId,
      });
    }

    try {
      await verifyBlockProposerSignature(this.config, this.chain.bls, received);
    } catch (e) {
      this.network.reportPeer(peer, PeerAction.LowToleranceError, "BackfillSyncInvalidSignature");
      this.onPeerRequestFailed(peer);
      this.metrics?.backfillSync.errors.inc();
      throw e;
    }

    // `received` is ordered highest-slot first (knownRoots is anchor-down), matching the
    // backward-walk order the epoch buffer expects.
    for (const block of received) {
      await this.ingestBlock(block);
    }

    this.knownRoots.splice(0, received.length);
    this.onPeerRequestSuccess(peer);
    this.lastGoodPeer = peer;
    this.metrics?.backfillSync.totalBlocks.inc({method: BackfillSyncMethod.blockbyroot}, received.length);

    if (this.knownRoots.length === 0) {
      // Window exhausted — hand off to the Phase 2 serial walk via the oldest block's parent.
      // biome-ignore lint/style/noNonNullAssertion: received is non-empty (checked above)
      const oldest = received.at(-1)!;
      this.anchorRoot = oldest.message.parentRoot;
      this.anchorSlot = oldest.message.slot;
    } else if (received.length < batch.length) {
      // Peer was missing part of the batch; the remaining roots stay queued for another peer.
      this.onPeerRequestFailed(peer);
    }
  }

  /**
   * Phase 2 step: fetch the next block by its root and walk to its parent.
   *
   * The walk is inherently serial — block N must arrive before N-1's root is known — so the
   * single byRoot request is hedged across several peers to hide per-request failure and
   * tail latency (see `fetchBlockByRootRaced`).
   */
  private async syncOneByParentRoot(peers: PeerIdStr[]): Promise<void> {
    // Cache short-circuit: if this block is already in `blockArchive` (overlap with an
    // earlier run, or a contiguous already-filled segment), use the cached copy — no network
    // fetch, no signature recheck, no epoch-buffer churn. Just walk to its parent.
    const cached = await this.db.blockArchive.getByRoot(this.anchorRoot);
    if (cached !== null) {
      this.anchorSlot = cached.message.slot;
      this.anchorRoot = cached.message.parentRoot;
      this.metrics?.backfillSync.totalBlocks.inc({method: BackfillSyncMethod.database}, 1);

      // Still run the epoch-boundary lookahead so we can jump whole already-filled epochs
      // in one bulk skip instead of per-block walking through 32+ cached blocks per epoch.
      if (cached.message.slot !== GENESIS_SLOT) {
        const blockEpoch = computeEpochAtSlot(cached.message.slot);
        const nextEpoch = computeEpochAtSlot(cached.message.slot - 1);
        if (nextEpoch !== blockEpoch) {
          const existingState = await this.db.backfillState.get(nextEpoch);
          if (existingState?.hasBlock) {
            this.logger.info("Skipping already-filled epoch", {epoch: nextEpoch});
            await this.skipFilledEpochs(nextEpoch);
          }
        }
      }
      return;
    }

    const result = await this.fetchBlockByRootRaced(this.anchorRoot, peers);

    if (result === null) {
      // None of the hedged peers served the block; the loop retries with a fresh peer set
      // (peers that keep failing are eventually excluded by `pickPeers`).
      throw new BackfillSyncError({
        code: BackfillSyncErrorCode.MISSING_BLOCK,
        root: this.anchorRoot,
        peerId: peers[0] as unknown as PeerId,
      });
    }

    const {block, peer} = result;

    // `fetchBlockByRootRaced` already verified hashTreeRoot(block) === anchorRoot, so the
    // block body is canonical. The signature is separate data the peer could still have
    // tampered with, so it is verified here.
    if (block.message.slot !== GENESIS_SLOT) {
      try {
        await verifyBlockProposerSignature(this.config, this.chain.bls, [block]);
      } catch (e) {
        this.network.reportPeer(peer, PeerAction.LowToleranceError, "BackfillSyncInvalidSignature");
        this.onPeerRequestFailed(peer);
        this.metrics?.backfillSync.errors.inc();
        throw e;
      }
    }

    await this.ingestBlock(block);
    this.anchorRoot = block.message.parentRoot;
    this.onPeerRequestSuccess(peer);
    this.lastGoodPeer = peer;
    this.metrics?.backfillSync.totalBlocks.inc({method: BackfillSyncMethod.blockbyroot}, 1);

    // After genesis, parentRoot is ZERO_HASH and the loop's top-of-iteration
    // check handles flush+complete; skip the already-filled lookahead here.
    // TODO: we're not syncing to GENESIS unless the user wants to do so.
    if (block.message.slot !== GENESIS_SLOT) {
      const blockEpoch = computeEpochAtSlot(block.message.slot);
      const nextEpoch = computeEpochAtSlot(block.message.slot - 1);
      if (nextEpoch !== blockEpoch) {
        const existingState = await this.db.backfillState.get(nextEpoch);
        if (existingState?.hasBlock) {
          this.logger.info("Skipping already-filled epoch", {epoch: nextEpoch});
          await this.skipFilledEpochs(nextEpoch);
        }
      }
    }
  }

  /**
   * Hedged byRoot fetch for a single block.
   *
   * The request goes to the primary peer first; the remaining peers are contacted only if
   * the primary has not produced the block within `HEDGE_DELAY_MS` (or fails outright).
   * Delayed hedging keeps the fast common case at 1x bandwidth — extra peers pay off only on
   * the slow/failing tail. Returns the first peer whose block matches `root` exactly, or
   * `null` if none of the peers could serve it.
   *
   * Note: the network API exposes no AbortSignal, so a losing in-flight request cannot be
   * truly cancelled — it completes and its result is discarded. Delayed hedging bounds that
   * waste to the tail.
   */
  private async fetchBlockByRootRaced(root: Root, peers: PeerIdStr[]): Promise<RacedBlock | null> {
    const rootHex = toRootHex(root);
    const primary = this.attemptFetch(root, rootHex, peers[0]);
    const rest = peers.slice(1);

    if (rest.length === 0) {
      return primary;
    }

    // Wait for the primary peer, but no longer than the hedge delay.
    let hedgeFired = false;
    const primaryResult = await Promise.race([
      primary,
      sleep(HEDGE_DELAY_MS).then((): RacedBlock | null => {
        hedgeFired = true;
        return null;
      }),
    ]);

    // Primary served the block before the hedge delay — no fan-out needed.
    if (!hedgeFired && primaryResult !== null) {
      return primaryResult;
    }

    // Primary was too slow or failed: fan out to the remaining peers, keeping the primary
    // in the race if it timed out (still in flight rather than already-failed).
    const racers = rest.map((peer) => this.attemptFetch(root, rootHex, peer));
    if (hedgeFired) {
      racers.push(primary);
    }
    return this.firstSuccessful(racers);
  }

  /**
   * Request one block by root from a single peer. Never rejects: a reqresp failure, a
   * missing block, or a non-matching block all resolve to `null` and mark the peer failed.
   * A non-null result is guaranteed to match `root` exactly.
   */
  private async attemptFetch(root: Root, rootHex: RootHex, peer: PeerIdStr): Promise<RacedBlock | null> {
    try {
      const [block] = await this.network.sendBeaconBlocksByRoot(peer, [root]);
      if (block) {
        const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
        if (toRootHex(blockRoot) === rootHex) {
          return {block, peer};
        }
      }
    } catch {
      // reqresp-level failure (dial error, timeout, server error, ...) — treated as a miss
    }
    this.onPeerRequestFailed(peer);
    this.metrics?.backfillSync.errors.inc();
    return null;
  }

  /**
   * Resolve with the first promise that yields a non-null value, or `null` once every
   * promise has resolved to `null`. Input promises never reject (see `attemptFetch`).
   */
  private firstSuccessful(attempts: Promise<RacedBlock | null>[]): Promise<RacedBlock | null> {
    return new Promise<RacedBlock | null>((resolve) => {
      let pending = attempts.length;
      for (const attempt of attempts) {
        void attempt.then((result) => {
          if (result !== null) {
            resolve(result);
          } else if (--pending === 0) {
            resolve(null);
          }
        });
      }
    });
  }

  /**
   * Append a block to the epoch buffer while walking backward, flushing the previous
   * (higher) epoch once a block from a lower epoch arrives.
   *
   * Comparing against the buffer's epoch (rather than epochAt(slot-1)) handles skipped
   * slots at epoch boundaries — e.g. walk 97→95 with slot 96 missing.
   */
  private async ingestBlock(block: SignedBeaconBlock): Promise<void> {
    const blockEpoch = computeEpochAtSlot(block.message.slot);

    if (this.epochBuffer.length > 0) {
      const bufferEpoch = computeEpochAtSlot(this.epochBuffer[0].message.slot);
      if (bufferEpoch !== blockEpoch) {
        await this.flushEpoch(bufferEpoch);
      }
    }

    this.epochBuffer.push(block);
    this.anchorSlot = block.message.slot;
  }

  // storing buffered blocks, update the backfill range.
  private async flushEpoch(epoch: Epoch): Promise<void> {
    if (this.epochBuffer.length === 0) return;

    const puts = this.epochBuffer.map((block) => ({
      key: block.message.slot,
      value: block,
    }));
    await this.db.blockArchive.batchPut(puts);

    await this.db.backfillState.put(epoch, {
      hasBlock: true,
      hasBlobs: null, // TODO: add blob backfills in the future
      columnIndices: null,
    });

    const range = await this.db.backfilledRange.get();
    if (range) {
      await this.db.backfilledRange.put({
        beginningEpoch: range.beginningEpoch,
        endingEpoch: epoch,
      });
    }

    this.logger.verbose("Flushed epoch to DB", {
      epoch,
      blocks: this.epochBuffer.length,
    });

    this.epochBuffer = [];

    await sleep(EPOCH_FLUSH_YIELD_MS, this.signal);
  }

  // finds where to resume after skipping over the filled epochs.
  // | epoch | 0 .. 4   |  5..6  |   7    | 8 .. 9 |   10   |
  // |       |  xfilled | filled | filled |   gap  | anchor |
  // skipFilledEpochs(7) => sync resumes from epoch 4
  private async skipFilledEpochs(startEpoch: Epoch): Promise<void> {
    let epoch = startEpoch;

    while (epoch > 0) {
      const state = await this.db.backfillState.get(epoch);
      if (!state?.hasBlock) break;
      epoch--;
    }

    if (epoch < startEpoch) {
      const bottomSlot = (epoch + 1) * SLOTS_PER_EPOCH;
      const blocks = await this.db.blockArchive.values({
        gte: bottomSlot,
        limit: 1,
      });

      if (blocks.length > 0) {
        this.anchorRoot = blocks[0].message.parentRoot;
        this.anchorSlot = blocks[0].message.slot;
        this.logger.info("Skipped filled epochs", {
          from: startEpoch,
          to: epoch + 1,
          resumeSlot: this.anchorSlot,
        });
      }
    }
  }

  private addPeer = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    this.logger.debug("BackfillSync: peer connected", {peer: data.peer});
    this.peers.set(data.peer, {failedRequests: 0});
    this.processor.trigger();
  };

  private removePeer = (data: NetworkEventData[NetworkEvent.peerDisconnected]): void => {
    this.peers.delete(data.peer);
    if (this.lastGoodPeer === data.peer) {
      this.lastGoodPeer = null;
    }
  };

  /**
   * Pick up to `n` distinct eligible peers, listing the peer that last served us first so a
   * hedged fetch reuses its already-warm connection before dialing fresh random peers.
   */
  private pickPeers(n: number): PeerIdStr[] {
    const eligible = Array.from(this.peers.entries())
      .filter(([_, meta]) => meta.failedRequests < MAX_PEER_FAILURES)
      .map(([id]) => id);

    const picked: PeerIdStr[] = [];
    if (this.lastGoodPeer !== null && eligible.includes(this.lastGoodPeer)) {
      picked.push(this.lastGoodPeer);
    }
    for (const peer of shuffle(eligible)) {
      if (picked.length >= n) break;
      if (peer !== this.lastGoodPeer) picked.push(peer);
    }
    return picked;
  }

  private onPeerRequestSuccess(peer: PeerIdStr): void {
    const meta = this.peers.get(peer);
    if (meta && meta.failedRequests > 0) {
      meta.failedRequests = Math.max(0, meta.failedRequests - 1);
    }
  }

  private onPeerRequestFailed(peer: PeerIdStr): void {
    const meta = this.peers.get(peer);
    if (meta) {
      meta.failedRequests++;
      if (meta.failedRequests >= MAX_PEER_FAILURES) {
        this.logger.debug("BackfillSync: peer exceeded local failure threshold, excluding from this sync", {
          peer,
          failRequests: meta.failedRequests,
        });
      }
    }
  }

  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.processor.end(new ErrorAborted("BackfillSync"));
    this.epochBuffer = [];
    this.knownRoots = [];
    this.peers.clear();
  }
}
