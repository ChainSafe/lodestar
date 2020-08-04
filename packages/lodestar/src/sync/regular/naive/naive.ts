import PeerId from "peer-id";
import AbortController from "abort-controller";
import {source as abortSource} from "abortable-iterator";
import {IRegularSync, IRegularSyncModules, RegularSyncEventEmitter} from "../interface";
import {INetwork} from "../../../network";
import {IBeaconChain} from "../../../chain";
import {defaultOptions, IRegularSyncOptions} from "../options";
import deepmerge from "deepmerge";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IReputationStore} from "../../IReputation";
import {SignedBeaconBlock, Slot, Root} from "@chainsafe/lodestar-types";
import pushable, {Pushable} from "it-pushable";
import pipe from "it-pipe";
import {fetchBlockChunks, processSyncBlocks, getBestHead, getBestPeer} from "../../utils";
import {ISlotRange} from "../../interface";
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {GossipEvent} from "../../../network/gossip/constants";
import {toHexString} from "@chainsafe/ssz";
import {sleep} from "../../../util/sleep";
import {EventEmitter} from "events";

export class NaiveRegularSync extends (EventEmitter as { new(): RegularSyncEventEmitter }) implements IRegularSync {

  private readonly config: IBeaconConfig;

  private readonly network: INetwork;

  private readonly chain: IBeaconChain;

  private readonly reps: IReputationStore;

  private readonly logger: ILogger;

  private readonly opts: IRegularSyncOptions;

  private bestPeer: PeerId;

  private currentTarget: Slot = 0;
  private targetSlotRangeSource: Pushable<ISlotRange>;
  private gossipParentBlockRoot: Root;
  // only subscribe to gossip when we're up to this
  private controller: AbortController;

  constructor(options: Partial<IRegularSyncOptions>, modules: IRegularSyncModules) {
    super();
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.reps = modules.reputationStore;
    this.logger = modules.logger;
    this.opts = deepmerge(defaultOptions, options);
    this.targetSlotRangeSource = pushable<ISlotRange>();
  }

  public async start(): Promise<void> {
    this.logger.info("Started regular syncing");
    this.chain.on("processedBlock", this.onProcessedBlock);
    const headSlot = this.chain.forkChoice.headBlockSlot();
    const state = await this.chain.getHeadState();
    const currentSlot = getCurrentSlot(this.config, state.genesisTime);
    if (headSlot >= currentSlot) {
      this.logger.info(`Regular Sync: node is up to date, headSlot=${headSlot}`);
      this.emit("syncCompleted");
      return;
    }
    this.currentTarget = headSlot;
    this.logger.verbose(`Regular Sync: Current slot at start: ${currentSlot}`);
    this.targetSlotRangeSource = pushable<ISlotRange>();
    this.controller = new AbortController();
    await this.waitForBestPeer(this.controller.signal);
    const newTarget = await this.getNewTarget();
    this.logger.info("Regular Sync: Setting target", {newTargetSlot: newTarget});
    this.network.gossip.subscribeToBlock(this.chain.currentForkDigest, this.onGossipBlock);
    await Promise.all([
      this.sync(),
      this.setTarget()
    ]);
  }

  public async stop(): Promise<void> {
    this.targetSlotRangeSource.end();
    if (this.controller) {
      this.controller.abort();
    }
    this.chain.removeListener("processedBlock", this.onProcessedBlock);
    this.network.gossip.unsubscribe(this.chain.currentForkDigest, GossipEvent.BLOCK, this.onGossipBlock);
  }

  public getHighestBlock(): Slot {
    return this.currentTarget;
  }

  private async getNewTarget(): Promise<Slot> {
    const state = await this.chain.getHeadState();
    const currentSlot = getCurrentSlot(this.config, state.genesisTime);
    // due to exclusive endSlot in chunkify, we want `currentSlot + 1`
    return Math.min((this.currentTarget + this.opts.blockPerChunk), currentSlot + 1);
  }

  private setTarget = async (newTarget?: Slot, triggerSync = true): Promise<void> => {
    newTarget = newTarget || await this.getNewTarget();
    if(triggerSync && newTarget > this.currentTarget) {
      this.logger.info(`Regular Sync: Requesting blocks from slot ${this.currentTarget + 1} to slot ${newTarget}`);
      this.targetSlotRangeSource.push({start: this.currentTarget + 1, end: newTarget});
    }
    this.currentTarget = newTarget;
  };

  private onProcessedBlock = async(lastProcessedBlock: SignedBeaconBlock): Promise<void> => {
    if(this.currentTarget <= lastProcessedBlock.message.slot) {
      if(await this.checkSyncComplete()) {
        return;
      }
      this.logger.info(`Regular Sync: Synced up to slot ${lastProcessedBlock.message.slot} ` +
        `gossipParentBlockRoot=${this.gossipParentBlockRoot && toHexString(this.gossipParentBlockRoot)}`);
      await this.setTarget();
    }
  };

  private onGossipBlock = async(block: SignedBeaconBlock): Promise<void> => {
    this.gossipParentBlockRoot = block.message.parentRoot;
    this.logger.verbose(`Regular Sync: Set gossip parent block to ${toHexString(this.gossipParentBlockRoot)}` +
      `, gossip slot ${block.message.slot}`);
    await this.checkSyncComplete();
  };

  private checkSyncComplete = async(): Promise<boolean> => {
    if (this.gossipParentBlockRoot && this.chain.forkChoice.hasBlock(this.gossipParentBlockRoot as Uint8Array)) {
      this.logger.
        important("Regular Sync: caught up to gossip block parent " + toHexString(this.gossipParentBlockRoot));
      this.emit("syncCompleted");
      await this.stop();
      return true;
    }
    return false;
  };

  private async sync(): Promise<void> {
    const {config, logger, chain, controller} = this;
    const reqResp = this.network.reqResp;
    const getSyncPeers = this.getSyncPeers;
    const setTarget = this.setTarget;
    await pipe(
      this.targetSlotRangeSource,
      (source) => {
        return(async function() {
          for await (const range of abortSource(source, controller.signal, {returnOnAbort: true})) {
            const lastFetchedSlot = await pipe(
              [range],
              fetchBlockChunks(logger, chain, reqResp, getSyncPeers),
              processSyncBlocks(config, chain, logger, false)
            );
            if(lastFetchedSlot) {
              // not trigger sync until after we process lastFetchedSlot
              await setTarget(lastFetchedSlot, false);
            } else {
              // no block, retry the range again next slot
              await setTarget(range.start - 1, false);
              logger.verbose(`Not found any blocks for range ${JSON.stringify(range)}, will retry at next slot`);
              await sleep(config.params.SECONDS_PER_SLOT * 1000);
              await setTarget();
            }
          }
        })();
      }
    );
  }

  private getSyncPeers = async (): Promise<PeerId[]> => {
    if (!this.network.getPeers().includes(this.bestPeer)) {
      // bestPeer disconnected
      this.bestPeer = undefined;
      await this.waitForBestPeer(this.controller.signal);
    }
    return [this.bestPeer];
  };

  private waitForBestPeer = async (signal: AbortSignal): Promise<void> => {
    // statusSyncTimer is per slot
    const waitingTime = this.config.params.SECONDS_PER_SLOT * 1000;
    const state = await this.chain.getHeadState();
    let isAborted = false;
    signal.addEventListener("abort", () => {
      this.logger.verbose("RegularSync: Abort waitForBestPeer");
      isAborted = true;
    });
    while (!this.bestPeer && !isAborted) {
      // wait first to make sure we have latest status
      await sleep(waitingTime);
      const previousSlot = getCurrentSlot(this.config, state.genesisTime) - 1;
      const peers = this.network.getPeers();
      const {slot: maxHeadSlot} = getBestHead(peers, this.reps);
      if (maxHeadSlot >= previousSlot) {
        this.bestPeer = getBestPeer(this.config, peers, this.reps);
        this.logger.verbose(`Regular Sync: Found best peer ${this.bestPeer.toB58String()}, headSlot=${maxHeadSlot}`);
      } else {
        this.logger.verbose(`Regular Sync: Not found peer with headSlot >= ${previousSlot} num peers=${peers.length}` +
        ` maxHeadSlot=${maxHeadSlot}`);
      }
    }
  };
}
