import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, Status} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {fromHex} from "@lodestar/utils";
import {ChainEvent, IBeaconChain} from "../../chain/index.js";
import {Network, NetworkEvent, PeerAction} from "../../network/index.js";
import {PeerIdStr} from "../../util/peerId.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {shuffle} from "../../util/shuffle.js";
import {
  BackwardsChain,
  ChainAdvanceResult,
  ChainState,
  DownloadState,
  Header,
  LinkedBackwardsChain,
  UnknownAncestorBackwardsChain,
  addAncestorHeader,
  advanceChain,
  linkChain,
  mergeChain,
} from "./backwardsChain.js";
import {UnknownChainSyncMetrics} from "./metrics.js";

export type UnknownChainSyncInit = {
  config: ChainForkConfig;
  chain: IBeaconChain;
  network: Network;
  processLinkedChain: (chain: LinkedBackwardsChain) => void;
  metrics?: UnknownChainSyncMetrics;
};

/**
 * This is a sync process used to find unknown chains that are not part of our known chain.
 * It can be used even in cases of long non-finality upon initial bootstrap when long chains of blocks may be encountered.
 *
 * Here, "chain" and "unknown chain" refer to a sequence of blocks that are not part of our known chain, aka a `BackwardsChain`.
 */
export class UnknownChainSync {
  /** Used to track backwards chains, their known ancestors, and relevant peers */
  backwardsChains: Map<RootHex, BackwardsChain>;
  headers: Map<RootHex, Header>;
  blockRootsByEpoch: Map<Epoch, Set<RootHex>>;

  private config: ChainForkConfig;
  private chain: IBeaconChain;
  private network: Network;
  private processLinkedChain: (chain: LinkedBackwardsChain) => void;
  private processQueue: JobItemQueue<[BackwardsChain], void>;
  private controller: AbortController;

  constructor(init: UnknownChainSyncInit) {
    this.config = init.config;
    this.chain = init.chain;
    this.network = init.network;
    this.processLinkedChain = init.processLinkedChain;

    this.backwardsChains = new Map();
    this.headers = new Map();
    this.blockRootsByEpoch = new Map();
    this.controller = new AbortController();
    this.processQueue = new JobItemQueue(
      this.processBackwardsChain,
      {
        maxConcurrency: 2,
        maxLength: 1000,
        signal: this.controller.signal,
      },
      init.metrics?.processorQueue
    );

    init.metrics?.headerCount.addCollect(() => {
      init.metrics?.headerCount.set(this.headers.size);
      const stateCount: Record<ChainState, number> = {
        [ChainState.UnknownHead]: 0,
        [ChainState.UnknownAncestor]: 0,
        [ChainState.Linked]: 0,
      };
      const chainCount: {headers: number; peers: number}[] = [];
      for (const chain of this.backwardsChains.values()) {
        stateCount[chain.state] += 1;
        chainCount.push({peers: chain.peers.size, headers: chain.ancestors.size});
      }
      for (const [state, count] of Object.entries(stateCount) as [ChainState, number][]) {
        init.metrics?.chainCount.set({state}, count);
      }
      for (const {headers, peers} of chainCount) {
        init.metrics?.chainHeaders.observe(headers);
        init.metrics?.chainPeers.observe(peers);
      }
    });
  }

  start() {
    this.controller = new AbortController();
    this.processQueue = new JobItemQueue(this.processBackwardsChain, {
      maxConcurrency: 2,
      maxLength: 1000,
      signal: this.controller.signal,
    });
    this.chain.emitter.on(routes.events.EventType.block, this.onProcessedBlock);
    this.chain.emitter.on(ChainEvent.forkChoiceFinalized, this.onFinalized);
    this.network.events.on(NetworkEvent.peerConnected, this.onPeerStatusUpdate);
    this.network.events.on(NetworkEvent.peerDisconnected, this.onPeerDisconnect);
  }

  stop() {
    this.controller.abort();
    this.chain.emitter.off(routes.events.EventType.block, this.onProcessedBlock);
    this.chain.emitter.off(ChainEvent.forkChoiceFinalized, this.onFinalized);
    this.network.events.off(NetworkEvent.peerConnected, this.onPeerStatusUpdate);
    this.network.events.off(NetworkEvent.peerDisconnected, this.onPeerDisconnect);
    this.processQueue.dropAllJobs();
    this.backwardsChains.clear();
    this.headers.clear();
    this.blockRootsByEpoch.clear();
  }

  /**
   * A newly processed block interacts with one or more backwards chains
   * - If the block is the head of a backwards chain, the chain is now irrelevant
   * - If the block is an ancestor of a backwards chain, the chain is now linked
   */
  onProcessedBlock = ({block: blockRoot}: {slot: Slot; block: RootHex}) => {
    // A newly processed block may link one or more backwards chains, check all chains
    // A newly processed block may also invalidate or prune one or more backwards chains, check all chains
    for (const chain of this.backwardsChains.values()) {
      if (chain.headRoot === blockRoot) {
        // If the chain head is the newly processed block, it means the chain is now entirely irrelevant
        this.pruneEntireChain(chain);
        continue;
      }

      if (chain.state === ChainState.Linked) {
        // Don't mess with a linked chain
        continue;
      }

      if (
        chain.state === ChainState.UnknownAncestor &&
        (chain.ancestors.has(blockRoot) || chain.earliestKnownAncestor === blockRoot)
      ) {
        // If the newly processed block is an ancestor in the chain, the chain is now linked
        linkChain(chain);
        this.processQueue.push(chain);
      }
    }
  };

  /**
   * Finalization means we can prune old sync items and chains
   */
  onFinalized = ({epoch: finalizedEpoch}: {epoch: Epoch; rootHex: RootHex}) => {
    // remove all sync items for finalized epochs
    // TODO: start from the latest finalized epoch and work backwards in time
    for (const [epoch, epochRoots] of this.blockRootsByEpoch.entries()) {
      if (epoch < finalizedEpoch) {
        for (const root of epochRoots) {
          // Either the root is a head of a backwards chain or an ancestor of a backwards chain
          const chain = this.backwardsChains.get(root);
          if (chain) {
            this.pruneEntireChain(chain);
          } else {
            this.pruneFromChains(root);
          }
        }
        this.blockRootsByEpoch.delete(epoch);
      }
    }
  };

  /**
   * A fresh peer status may indicate a new unknown chain, or adding the peer to an existing chain
   */
  onPeerStatusUpdate = ({peer, status}: {peer: PeerIdStr; status: Status}) => {
    const headRootHex = toHex(status.headRoot);
    this.onUnknownBlockRoot(headRootHex, peer);
  };

  onUnknownBlockRoot = (blockRoot: RootHex, peerIdStr: PeerIdStr) => {
    if (this.chain.forkChoice.hasBlockHex(blockRoot)) {
      // peer's head has already been processed by us
      return;
    }
    if (this.headers.has(blockRoot)) {
      // we're already tracking this head as part of one or more chains
      for (const chain of this.backwardsChains.values()) {
        if (chain.headRoot === blockRoot || chain.ancestors.has(blockRoot)) {
          chain.peers.add(peerIdStr);
        }
      }
    } else {
      // If we don't have this head, it could be: an unknown head or an earliest known ancestor of an existing chain
      let isKnown = false;
      for (const chain of this.backwardsChains.values()) {
        if (chain.headRoot === blockRoot) {
          chain.peers.add(peerIdStr);
          isKnown = true;
        }
        if (chain.state === ChainState.UnknownAncestor && chain.earliestKnownAncestor === blockRoot) {
          chain.peers.add(peerIdStr);
          isKnown = true;
        }
      }

      if (isKnown) {
        return;
      }

      // If we haven't seen this block root even as an earliest known ancestor, it's a completely new unknown chain. Start tracking it.
      const newChain: BackwardsChain = {
        state: ChainState.UnknownHead,
        downloadState: DownloadState.Idle,
        headRoot: blockRoot,
        ancestors: new Map(),
        peers: new Set([peerIdStr]),
        lastUpdate: Date.now(),
      };
      this.backwardsChains.set(blockRoot, newChain);
      this.processQueue.push(newChain);
    }
  };

  onUnknownBlockInput = (header: Header, peerIdStr: PeerIdStr) => {
    const headRootHex = header.root;
    const parentRootHex = header.parentRoot;

    if (this.chain.forkChoice.hasBlockHex(headRootHex)) {
      // If we already have this block in our fork choice, we can ignore it
      return;
    }

    if (this.headers.has(headRootHex)) {
      // We're already tracking this head as part of one or more chains
      for (const chain of this.backwardsChains.values()) {
        if (chain.headRoot === headRootHex || chain.ancestors.has(headRootHex)) {
          // If the head is the head or an ancestor of the chain, we can add the peer to the chain
          chain.peers.add(peerIdStr);
        }
      }
    } else {
      // This is a new unknown chain, start tracking it
      const newChain: BackwardsChain = {
        state: ChainState.UnknownAncestor,
        downloadState: DownloadState.Idle,
        headRoot: headRootHex,
        head: header,
        earliestKnownAncestor: parentRootHex,
        ancestors: new Map(),
        peers: new Set([peerIdStr]),
        lastUpdate: Date.now(),
      };

      this.backwardsChains.set(headRootHex, newChain);
      this.processQueue.push(newChain);

      this.addHeader(header);
      this.newEarliestKnownAncestor(newChain as UnknownAncestorBackwardsChain, header);
    }
  };

  onPeerDisconnect = ({peer}: {peer: PeerIdStr}) => {
    for (const chain of this.backwardsChains.values()) {
      chain.peers.delete(peer);
    }
  };

  pruneEntireChain(chain: BackwardsChain): void {
    // First remove the chain from being tracked
    this.backwardsChains.delete(chain.headRoot);

    // Then iterate backwards through the chain and remove all headers that are not part of another chain
    let header = this.headers.get(chain.headRoot);
    while (header) {
      for (const otherChain of this.backwardsChains.values()) {
        if (otherChain.ancestors.has(header.root)) {
          break;
        }
      }
      this.headers.delete(header.root);
      header = this.headers.get(header.parentRoot);
    }
  }

  /**
   * Get all sync items that are related to the given root
   * This includes:
   * - The item for the root itself
   * - All items that are ancestors of the root
   */
  getRelatedHeaders(root: RootHex): Header[] {
    const items: Header[] = [];
    let current = root;
    while (true) {
      const item = this.headers.get(current);
      if (item) {
        items.push(item);
      }
      current = item?.parentRoot as RootHex;
      if (!current) {
        break;
      }
    }
    return items.reverse(); // Return in chronological order
  }

  /**
   * Prune all sync items that are related to the given root from all chains.
   */
  pruneFromChains(root: RootHex): void {
    // first get set of sync items that we're tracking
    const items = this.getRelatedHeaders(root);

    // items guaranteed to have at least one item, the root itself
    const firstItem = items[0];

    // prune items from chains
    for (const chain of this.backwardsChains.values()) {
      if (chain.ancestors.has(firstItem.root)) {
        // if the item is an ancestor of the chain, pruning is needed and the chain is now linked
        for (const item of items) {
          chain.ancestors.delete(item.root);
        }
        if (chain.state === ChainState.UnknownAncestor) {
          chain.earliestKnownAncestor = root;
          this.processQueue.push(chain);
        }
      }
    }
    // prune items from global sync items
    for (const item of items) {
      this.headers.delete(item.root);
    }
  }

  addHeader(header: Header): void {
    this.headers.set(header.root, header);
    const epoch = computeEpochAtSlot(header.slot);
    let blockRoots = this.blockRootsByEpoch.get(epoch);
    if (!blockRoots) {
      blockRoots = new Set();
      this.blockRootsByEpoch.set(epoch, blockRoots);
    }
    blockRoots.add(header.root);
  }

  async fetchBlock(chain: BackwardsChain, peerIdStr: PeerIdStr): Promise<Header | undefined> {
    if (chain.state === ChainState.Linked) {
      // chain is already linked, no need to fetch
      return;
    }

    const fetchRoot = chain.state === ChainState.UnknownHead ? chain.headRoot : chain.earliestKnownAncestor;
    try {
      // Send network request for block by root
      const [resp] = await this.network.sendBeaconBlocksByRoot(peerIdStr, [fromHex(fetchRoot)]);

      // Attempt to add block to the chain
      if (resp === undefined) {
        // No response from peer
        // It's possible that peer has simply pruned the block, we assume this is bad behavior and we penalize the peer and remove it from the chain
        this.network.reportPeer(
          peerIdStr,
          PeerAction.MidToleranceError,
          "Missing block response from peer-advertised head"
        );
        chain.peers.delete(peerIdStr);
        return;
      }

      const block = resp.data.message;
      const blockRoot = this.config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block);
      const blockRootHex = toHex(blockRoot);

      if (fetchRoot !== blockRootHex) {
        // Peer returned a block with a different root than requested. This is bad behavior, we penalize the peer and remove it from the chain
        this.network.reportPeer(peerIdStr, PeerAction.Fatal, "Incorrect block response from peer-advertised head");
        chain.peers.delete(peerIdStr);
        return;
      }

      return {
        slot: block.slot,
        root: blockRootHex,
        parentRoot: toHex(block.parentRoot),
      };
    } catch (err) {
      const errCode = (err as RequestError).type?.code;
      switch (errCode) {
        case RequestErrorCode.REQUEST_SELF_RATE_LIMITED:
        case RequestErrorCode.REQUEST_RATE_LIMITED:
          // rate limited, we don't penalize the peer, just skip it
          return;
      }
      // Timeout or some other error, we penalize the peer and remove it from the chain
      this.network.reportPeer(peerIdStr, PeerAction.LowToleranceError, "Error fetching block response from peer");
      chain.peers.delete(peerIdStr);
      return;
    }
  }

  newEarliestKnownAncestor(chain: UnknownAncestorBackwardsChain, header: Header): void {
    const parentRootHex = header.parentRoot;
    const epoch = computeEpochAtSlot(header.slot);
    if (
      this.chain.forkChoice.getFinalizedCheckpoint().epoch > epoch ||
      this.chain.forkChoice.hasBlockHex(parentRootHex)
    ) {
      // The new header is finalized or the parent is already known, we can link the chain
      // In the former case, the chain will be discarded as "too old", in the latter case, the chain can be processed
      linkChain(chain);
    } else if (this.headers.has(parentRootHex)) {
      // If the parent is known, its either a head of another chain or an ancestor of another chain
      const parentChain = this.backwardsChains.get(parentRootHex);
      if (parentChain) {
        // We're already tracking the parent as a head of an existing chain.
        // It can be merged with the new chain and discarded.
        mergeChain(chain as UnknownAncestorBackwardsChain, parentChain);
        this.backwardsChains.delete(parentRootHex);
      } else {
        // The parent is known as an ancestor of another chain.
        // We can advance the new chain as far as we know.
        let ancestor = this.headers.get(parentRootHex);
        while (ancestor) {
          addAncestorHeader(chain as UnknownAncestorBackwardsChain, ancestor);
          ancestor = this.headers.get(ancestor.parentRoot);
        }
      }
    }

    // If the updated chain can advance another chain, we do so.
    for (const otherChain of this.backwardsChains.values()) {
      if (otherChain.state === ChainState.UnknownAncestor && otherChain.earliestKnownAncestor === header.root) {
        // If the other chain can be advanced, we do so
        let ancestor = this.headers.get(otherChain.earliestKnownAncestor);
        while (ancestor) {
          addAncestorHeader(otherChain as UnknownAncestorBackwardsChain, ancestor);
          ancestor = this.headers.get(ancestor.parentRoot);
        }
        if ((chain as BackwardsChain).state === ChainState.Linked) {
          // If the updated chain is now linked, the other chain is now linked too
          linkChain(otherChain as UnknownAncestorBackwardsChain);
        }

        this.processQueue.push(otherChain);
      }
    }
  }

  processBackwardsChain = async (chain: BackwardsChain): Promise<void> => {
    if (!this.backwardsChains.has(chain.headRoot)) {
      // chain has been removed, skip processing
      return;
    }

    if (chain.downloadState === DownloadState.Fetching) {
      // If the chain is already being processed, skip processing
      return;
    }

    if (chain.state === ChainState.UnknownHead || chain.state === ChainState.UnknownAncestor) {
      await this.processUnknown(chain);
    } else if (chain.state === ChainState.Linked) {
      await this.processLinkedChain(chain);
    }
  };

  /**
   * Attempt to find the first block in this backwards chain.
   */
  async processUnknown(chain: BackwardsChain): Promise<void> {
    chain.downloadState = DownloadState.Fetching;

    const peers = shuffle(chain.peers);

    for (const peerIdStr of peers) {
      const header = await this.fetchBlock(chain, peerIdStr);
      if (!header) {
        // If we couldn't fetch the block, continue to the next peer
        continue;
      }

      if (!this.backwardsChains.has(chain.headRoot)) {
        // If the chain no longer exists, it means it was removed while we were fetching the block. We no longer need it apparently.
        return;
      }

      const result = advanceChain(chain, header);

      this.processQueue.push(chain);
      chain.downloadState = DownloadState.Idle;

      if (result !== ChainAdvanceResult.Advanced) {
        // Somehow we failed to advance the chain or we already have this sync item.
        // It means another process has already processed it.
        return;
      }

      this.addHeader(header);
      this.newEarliestKnownAncestor(chain as UnknownAncestorBackwardsChain, header);

      return;
    }

    // If we reach here, we failed to fetch the head block from any peer
    // Mark the download as failed, await more peers or removal
    chain.lastUpdate = Date.now();
    chain.downloadState = DownloadState.Failed;
  }
}
