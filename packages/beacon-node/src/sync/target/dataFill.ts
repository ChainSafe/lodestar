import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkPostFulu, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {ColumnIndex, SignedBeaconBlock, fulu, gloas} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInputSource} from "../../chain/blocks/payloadEnvelopeInput/types.js";
import {GossipActionError} from "../../chain/errors/gossipValidation.js";
import {IBeaconChain} from "../../chain/interface.js";
import {INetwork} from "../../network/interface.js";
import {PeerSyncMeta} from "../../network/peers/peersData.js";
import {PeerIdStr} from "../../util/peerId.js";
import {DownloadByRootError, fetchAndValidateColumns} from "../utils/downloadByRoot.js";
import {DataFillItem} from "./dataFillPlan.js";
import {fetchAndValidateExecutionPayloadEnvelopeByRoot} from "./fetchEnvelopeByRoot.js";
import {QuotaLedger} from "./quotaLedger.js";
import {SpillStore} from "./spillStore.js";

/**
 * Upper bound on the number of connected peers scanned when no proven holder
 * custodies a needed column. Keeps the custody fallback best-effort and cheap;
 * a custody miss is a no-op (not a fault), so an exhaustive scan buys nothing.
 */
const COLUMN_PEER_FALLBACK_SCAN_LIMIT = 32;

export type DataFillDeps = {
  config: ChainForkConfig;
  chain: IBeaconChain;
  network: INetwork;
  store: Pick<SpillStore, "get">;
  /** The chain's proven holders. */
  peers: Set<PeerIdStr>;
  reportPeer(peerIdStr: PeerIdStr, reason: string): void;
  /** Outbound spend gating; when present, fetches that cannot reserve are skipped this pass. */
  ledger?: QuotaLedger;
};

/**
 * DATA_FILL executor — a single best-effort pass that fetches and admits the missing
 * execution-payload envelopes and data columns for a slice of the header chain by root.
 *
 * For each item needing data we load the block from the store (the walk should have stored
 * it; a miss is a defer), fetch the envelope from a round-robin proven holder, and fetch the
 * sampled columns from a holder whose custody covers them. Fetched columns are admitted into
 * the per-root `PayloadEnvelopeInput`; an item is `filled` once that input has all its needed
 * data — the envelope (for `needsEnvelope` items) and all computed columns — otherwise it is
 * `deferred`.
 *
 * Scheduling — retry, backoff, re-invocation — is owned by the caller; this is one pass.
 */
export async function dataFill(items: DataFillItem[], deps: DataFillDeps): Promise<{filled: number; deferred: number}> {
  const {chain, store, peers} = deps;
  let filled = 0;
  let deferred = 0;

  // Round-robin cursor over the proven holders for envelope fetches.
  const peerList = [...peers];
  let envelopePeerCursor = 0;

  for (const item of items) {
    if (!item.needsEnvelope && !item.needsColumns) {
      // EMPTY item — the classifier marked it as needing nothing; issue no fetch.
      continue;
    }

    try {
      const block = await store.get(item.root, item.slot);
      if (block === null) {
        // The walk should have stored every block in the slice; a miss means defer.
        deferred++;
        continue;
      }

      // gloas blocks carry their payload on a separate envelope; pre-gloas (fulu) blocks carry it
      // inline and need their data-column sidecars filled into the block input.
      let ok: boolean;
      if (isForkPostGloas(item.forkName)) {
        // Round-robin a proven holder for the envelope fetch.
        const envelopePeer =
          item.needsEnvelope && peerList.length > 0 ? peerList[envelopePeerCursor++ % peerList.length] : undefined;
        ok = await fillGloasItem(item, block as SignedBeaconBlock<ForkPostGloas>, deps, envelopePeer);
      } else {
        ok = await fillPreGloasBlockData(item, block, deps);
      }
      if (ok) {
        filled++;
      } else {
        deferred++;
      }
    } catch (e) {
      // A by-root fetch or validation fault (a peer that advertised custody returning nothing, an
      // invalid sidecar, etc.) must not abort the whole slice — defer this item and keep the chain
      // alive for re-invocation. Best-effort, mirroring the rest of this executor.
      if (e instanceof DownloadByRootError || e instanceof GossipActionError) {
        chain.logger.debug("TargetSync dataFill item deferred on fetch fault", {root: item.root}, e as Error);
      } else {
        // Anything else is an unexpected/invariant error. Still defer (one bad item must not kill the
        // chain), but surface + meter it so it is not a silent retry loop hiding a real bug.
        chain.metrics?.targetSync.dataFillUnexpectedErrorTotal.inc();
        chain.logger.warn("TargetSync dataFill item deferred on unexpected error", {root: item.root}, e as Error);
      }
      deferred++;
    }
  }

  return {filled, deferred};
}

/**
 * Fetch and admit a gloas block's execution-payload envelope and data columns into its
 * `PayloadEnvelopeInput`. Returns true once the needed envelope (if any) and all computed columns
 * are present. May throw on a by-root fetch/validation fault — the caller treats that as a defer.
 */
async function fillGloasItem(
  item: DataFillItem,
  block: SignedBeaconBlock<ForkPostGloas>,
  deps: DataFillDeps,
  envelopePeer: PeerIdStr | undefined
): Promise<boolean> {
  const {config, chain, network} = deps;
  const blockRootHex = item.root;
  const blockRoot = fromHex(blockRootHex);
  const seenTimestampSec = Date.now() / 1000;

  // `add` is get-or-create — it returns the existing entry if present, else creates one.
  const payloadInput = chain.seenPayloadEnvelopeInputCache.add({
    blockRootHex,
    block,
    forkName: item.forkName,
    sampledColumns: chain.custodyConfig.sampledColumns,
    custodyColumns: chain.custodyConfig.custodyColumns,
    timeCreatedSec: seenTimestampSec,
  });

  if (
    item.needsEnvelope &&
    envelopePeer !== undefined &&
    // Outbound quota gate: an unreservable peer is skipped this pass (best-effort).
    (deps.ledger === undefined || deps.ledger.tryReserve(envelopePeer, "envelopesByRoot", 1))
  ) {
    try {
      const {result} = await fetchAndValidateExecutionPayloadEnvelopeByRoot({
        config,
        chain,
        network,
        peerIdStr: envelopePeer,
        blockRoot,
        blockRootHex,
        block,
        seenTimestampSec,
      });
      // REJECTED is a peer fault (the serving peer gave us an invalid envelope); PEER_MISS /
      // DEFERRED_NO_BUILDER is best-effort and not scored.
      if (result === "REJECTED") {
        deps.reportPeer(envelopePeer, "ENVELOPE_REJECTED");
      }
    } finally {
      deps.ledger?.release(envelopePeer, "envelopesByRoot");
    }
  }

  if (item.needsColumns) {
    await fillColumnsFromPeers({
      deps,
      forkName: item.forkName,
      block,
      blockRoot,
      hasColumn: (index) => payloadInput.hasColumn(index),
      addColumn: (columnSidecar, peerMeta) =>
        payloadInput.addColumn({
          // The fetcher returns the bare DataColumnSidecar union; narrow to the gloas member
          // (admission reads only index + commitments, which both forks share).
          columnSidecar: columnSidecar as gloas.DataColumnSidecar,
          source: PayloadEnvelopeInputSource.byRoot,
          seenTimestampSec,
          peerIdStr: peerMeta.peerId,
        }),
    });
  }

  // Filled only when both needed data are present: the envelope (for needsEnvelope items) and all
  // computed column data. hasComputedAllData() is column-only (true at construction for
  // blobCount-0 / out-of-window items) and never set by addPayloadEnvelope, so it alone would
  // over-count a needsEnvelope item whose envelope was never admitted.
  const envelopeOk = !item.needsEnvelope || payloadInput.hasPayloadEnvelope();
  return envelopeOk && payloadInput.hasComputedAllData();
}

/**
 * Fill a fulu block's data-column sidecars into its block input.
 *
 * Unlike gloas (where columns ride a separate payload envelope), a fulu block's columns attach
 * to the `IBlockInput` that the import step consumes. The block input is shared via
 * `seenBlockInputCache`, so the assembled segment sees what we add here. Returns true once the
 * block input holds the block and all its data — including the trivial blobCount-0 /
 * out-of-window case. TargetSync operates on fulu+ blocks, so a non-column pre-gloas block input
 * (pre-fulu) is never reached on this path.
 */
async function fillPreGloasBlockData(
  item: DataFillItem,
  block: SignedBeaconBlock,
  deps: DataFillDeps
): Promise<boolean> {
  const {chain} = deps;
  const blockRootHex = item.root;
  const blockRoot = fromHex(blockRootHex);
  const seenTimestampSec = Date.now() / 1000;

  const blockInput = chain.seenBlockInputCache.getByBlock({
    blockRootHex,
    block,
    source: BlockInputSource.byRange,
    seenTimestampSec,
    peerIdStr: undefined,
  });
  if (blockInput.hasBlockAndAllData()) {
    return true;
  }

  if (isBlockInputColumns(blockInput)) {
    await fillColumnsFromPeers({
      deps,
      forkName: item.forkName,
      block,
      blockRoot,
      hasColumn: (index) => blockInput.hasColumn(index),
      addColumn: (columnSidecar, peerMeta) =>
        blockInput.addColumn({
          // Pre-gloas (fulu) block input; narrow the DataColumnSidecar union to its fulu member.
          columnSidecar: columnSidecar as fulu.DataColumnSidecar,
          blockRootHex,
          source: BlockInputSource.byRoot,
          seenTimestampSec,
          peerIdStr: peerMeta.peerId,
        }),
    });
  }

  return blockInput.hasBlockAndAllData();
}

/**
 * Admit each not-yet-present column sidecar into a sink, abstracting over the gloas
 * payload-envelope vs fulu block-input destinations (and their differing add shapes / casts).
 */
function admitColumns<T extends {index: ColumnIndex}>(
  columnSidecars: T[],
  sink: {hasColumn(index: ColumnIndex): boolean; addColumn(columnSidecar: T): void}
): void {
  for (const columnSidecar of columnSidecars) {
    if (sink.hasColumn(columnSidecar.index)) {
      continue;
    }
    sink.addColumn(columnSidecar);
  }
}

/** Peers consulted per fill pass when accumulating a block's columns. */
const COLUMN_FILL_PEERS_PER_PASS = 4;

/**
 * Accumulate a block's needed columns ACROSS peers: each round picks a peer whose
 * advertised custody OVERLAPS the remaining need and requests only that overlap.
 * Never requires a single all-remaining custodian — under real PeerDAS custody
 * distributions (default 8-column custody vs 8+ sampled) no single non-supernode
 * peer may qualify, which would wedge column fill permanently.
 */
async function fillColumnsFromPeers<T extends {index: ColumnIndex}>(opts: {
  deps: DataFillDeps;
  forkName: ForkName;
  block: SignedBeaconBlock;
  blockRoot: Uint8Array;
  hasColumn(index: ColumnIndex): boolean;
  addColumn(columnSidecar: T, peerMeta: PeerSyncMeta): void;
}): Promise<void> {
  const {deps} = opts;
  const {config, chain, network} = deps;
  const tried = new Set<PeerIdStr>();

  for (let round = 0; round < COLUMN_FILL_PEERS_PER_PASS; round++) {
    const needed = chain.custodyConfig.sampledColumns.filter((index) => !opts.hasColumn(index));
    if (needed.length === 0) return;

    // A custody miss (no untried holder overlaps the remaining need) is a no-op, not a
    // fault (provider model) — best-effort, the caller re-invokes against a fuller peer set.
    const peerMeta = selectColumnPeer(needed, deps, tried);
    if (peerMeta === null) return;
    tried.add(peerMeta.peerId);

    const custody = new Set(peerMeta.custodyColumns);
    const overlap = needed.filter((index) => custody.has(index));

    // Outbound quota gate: an unreservable peer is skipped this round.
    if (deps.ledger !== undefined && !deps.ledger.tryReserve(peerMeta.peerId, "columnsByRoot", overlap.length)) {
      continue;
    }
    try {
      const {result: columnSidecars} = await fetchAndValidateColumns({
        config,
        chain,
        network,
        peerMeta,
        forkName: opts.forkName as ForkPostFulu,
        block: opts.block as SignedBeaconBlock<ForkPostFulu>,
        blockRoot: opts.blockRoot,
        missing: overlap,
      });
      admitColumns(columnSidecars as unknown as T[], {
        hasColumn: opts.hasColumn,
        addColumn: (cs) => opts.addColumn(cs, peerMeta),
      });
    } finally {
      deps.ledger?.release(peerMeta.peerId, "columnsByRoot");
    }
  }
}

/**
 * Pick a peer whose advertised custody OVERLAPS the `needed` columns (the caller
 * requests only the overlap and accumulates across peers).
 *
 * Prefer the chain's proven holders (`deps.peers`); fall back to a bounded scan of the
 * connected peer set. Returns `null` when no untried peer overlaps.
 */
function selectColumnPeer(
  needed: ColumnIndex[],
  deps: DataFillDeps,
  tried?: ReadonlySet<PeerIdStr>
): PeerSyncMeta | null {
  const {network, peers} = deps;

  // `deps.peers` (chain proven holders) may contain since-disconnected peers, and
  // `getConnectedPeerSyncMeta` throws on a peer that is not currently connected. Filter to the
  // connected set first so a stale proven holder can't abort the whole pass with an uncaught throw.
  const connected = new Set(network.getConnectedPeers());
  for (const peerId of peers) {
    if (!connected.has(peerId) || tried?.has(peerId)) {
      continue;
    }
    const peerMeta = network.getConnectedPeerSyncMeta(peerId);
    if (custodyOverlaps(peerMeta, needed)) {
      return peerMeta;
    }
  }

  let scanned = 0;
  for (const peerId of network.getConnectedPeers()) {
    if (scanned >= COLUMN_PEER_FALLBACK_SCAN_LIMIT) {
      break;
    }
    if (peers.has(peerId) || tried?.has(peerId)) {
      // Already considered above / already tried.
      continue;
    }
    scanned++;
    const peerMeta = network.getConnectedPeerSyncMeta(peerId);
    if (custodyOverlaps(peerMeta, needed)) {
      return peerMeta;
    }
  }

  return null;
}

function custodyOverlaps(peerMeta: PeerSyncMeta, needed: ColumnIndex[]): boolean {
  const custody = new Set(peerMeta.custodyColumns);
  return needed.some((index) => custody.has(index));
}
