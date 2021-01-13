import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {SlotRoot} from "@chainsafe/lodestar-types";
import {AbortController, AbortSignal} from "abort-controller";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {EventEmitter} from "events";
import PeerId from "peer-id";
import {IRegularSync, IRegularSyncOptions, RegularSyncEventEmitter} from "..";
import {ChainEvent, IBeaconChain} from "../../../chain";
import {INetwork} from "../../../network";
import {GossipEvent} from "../../../network/gossip/constants";
import {checkBestPeer, getBestPeer, getBestPeerCandidates} from "../../utils";
import {BlockRangeFetcher} from "./fetcher";
import {IBlockRangeFetcher, ORARegularSyncModules} from "./interface";

/**
 * One Range Ahead regular sync: fetch one range in advance and buffer blocks.
 * Fetch next range and process blocks at the same time.
 * Fetcher may return blocks of a different forkchoice branch.
 * This is ok, we handle that by beacon_blocks_by_root in sync service.
 */
export class ORARegularSync extends (EventEmitter as {new (): RegularSyncEventEmitter}) implements IRegularSync {
  private readonly config: IBeaconConfig;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly logger: ILogger;
  private bestPeer: PeerId | undefined;
  private fetcher: IBlockRangeFetcher;
  private controller!: AbortController;
  private blockBuffer: SignedBeaconBlock[];

  constructor(options: Partial<IRegularSyncOptions>, modules: ORARegularSyncModules) {
    super();
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.fetcher = modules.fetcher || new BlockRangeFetcher(options, modules, this.getSyncPeers.bind(this));
    this.blockBuffer = [];
  }

  public async start(): Promise<void> {
    const headSlot = this.chain.forkChoice.getHead().slot;
    const currentSlot = this.chain.clock.currentSlot;
    this.logger.info("Started regular syncing", {currentSlot, headSlot});
    this.logger.verbose("Regular Sync: Current slot at start", {currentSlot});
    this.controller = new AbortController();
    this.network.gossip.subscribeToBlock(await this.chain.getForkDigest(), this.onGossipBlock);
    this.chain.emitter.on(ChainEvent.block, this.onProcessedBlock);
    const head = this.chain.forkChoice.getHead();
    this.setLastProcessedBlock({slot: head.slot, root: head.blockRoot});
    this.sync().catch((e) => {
      this.logger.error("Regular Sync", e);
    });
  }

  public async stop(): Promise<void> {
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
    }
    this.network.gossip.unsubscribe(await this.chain.getForkDigest(), GossipEvent.BLOCK, this.onGossipBlock);
    this.chain.emitter.off(ChainEvent.block, this.onProcessedBlock);
  }

  public setLastProcessedBlock(lastProcessedBlock: SlotRoot): void {
    this.fetcher.setLastProcessedBlock(lastProcessedBlock);
  }

  public getHighestBlock(): Slot {
    const lastBlock = this.blockBuffer.length > 0 ? this.blockBuffer[this.blockBuffer.length - 1].message.slot : 0;
    return lastBlock ?? this.chain.forkChoice.getHead().slot;
  }

  private onGossipBlock = async (block: SignedBeaconBlock): Promise<void> => {
    const gossipParentBlockRoot = block.message.parentRoot;
    if (this.chain.forkChoice.hasBlock(gossipParentBlockRoot as Uint8Array)) {
      this.logger.important("Regular Sync: caught up to gossip block parent " + toHexString(gossipParentBlockRoot));
      this.emit("syncCompleted");
      await this.stop();
    }
  };

  private onProcessedBlock = async (signedBlock: SignedBeaconBlock): Promise<void> => {
    if (signedBlock.message.slot >= this.chain.clock.currentSlot) {
      this.logger.info("Regular Sync: processed up to current slot", {slot: signedBlock.message.slot});
      this.emit("syncCompleted");
      await this.stop();
    }
  };

  private async sync(): Promise<void> {
    this.blockBuffer = await this.fetcher.getNextBlockRange();
    while (!this.controller.signal.aborted) {
      // blockBuffer is always not empty
      const lastSlot = this.blockBuffer[this.blockBuffer.length - 1].message.slot;
      const result = await Promise.all([
        this.fetcher.getNextBlockRange(),
        this.chain.processChainSegment(this.blockBuffer),
      ]);
      if (!result[0] || !result[0].length) {
        // node is stopped
        this.logger.info("Regular Sync: fetcher returns empty array, finish sync now");
        return;
      }
      this.blockBuffer = result[0];
      this.logger.info("Regular Sync: Synced up to slot", {
        lastProcessedSlot: lastSlot,
        currentSlot: this.chain.clock.currentSlot,
      });
    }
  }

  /**
   * Make sure the best peer is not disconnected and it's better than us.
   * @param excludedPeers don't want to return peers in this list
   */
  private getSyncPeers = async (excludedPeers: string[] = []): Promise<PeerId[]> => {
    if (
      excludedPeers.includes(this.bestPeer?.toB58String() ?? "") ||
      !checkBestPeer(this.bestPeer!, this.chain.forkChoice, this.network)
    ) {
      this.logger.info("Regular Sync: wait for best peer");
      this.bestPeer = await this.waitForBestPeer(this.controller.signal, excludedPeers);
      if (this.controller.signal.aborted) return [];
    }
    return [this.bestPeer!];
  };

  private waitForBestPeer = async (signal: AbortSignal, excludedPeers: string[] = []): Promise<PeerId> => {
    // statusSyncTimer is per slot
    const waitingTime = this.config.params.SECONDS_PER_SLOT * 1000;
    let bestPeer: PeerId | undefined;

    while (!bestPeer) {
      const peers = getBestPeerCandidates(this.chain.forkChoice, this.network).filter(
        (peer) => !excludedPeers.includes(peer.toB58String())
      );
      if (peers && peers.length > 0) {
        bestPeer = getBestPeer(this.config, peers, this.network.peerMetadata);
        const peerHeadSlot = this.network.peerMetadata.getStatus(bestPeer)!.headSlot;
        this.logger.info("Regular Sync: Found best peer", {
          peerId: bestPeer.toB58String(),
          peerHeadSlot,
          currentSlot: this.chain.clock.currentSlot,
        });
      } else {
        // continue to find best peer
        bestPeer = undefined;
        await sleep(waitingTime, signal);
      }
    }
    return bestPeer;
  };
}
