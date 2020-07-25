import PeerId from "peer-id";
import AbortController from "abort-controller";
import {source as abortSource} from "abortable-iterator";
import {IRegularSync, IRegularSyncModules} from "../interface";
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
import {fetchBlockChunks, processSyncBlocks} from "../../utils";
import {ISlotRange} from "../../interface";
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {GossipEvent} from "../../../network/gossip/constants";
import {toHexString} from "@chainsafe/ssz";

export class NaiveRegularSync implements IRegularSync {

  private readonly config: IBeaconConfig;

  private readonly network: INetwork;

  private readonly chain: IBeaconChain;

  private readonly reps: IReputationStore;

  private readonly logger: ILogger;

  private readonly opts: IRegularSyncOptions;

  private currentTarget: Slot = 0;
  private targetSlotRangeSource: Pushable<ISlotRange>;
  private gossipParentBlockRoot: Root;
  private doneFirstSync: boolean;
  private controller: AbortController;

  constructor(options: Partial<IRegularSyncOptions>, modules: IRegularSyncModules) {
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.reps = modules.reputationStore;
    this.logger = modules.logger;
    this.opts = deepmerge(defaultOptions, options);
    this.targetSlotRangeSource = pushable<ISlotRange>();
    this.controller = new AbortController();
  }

  public async start(): Promise<void> {
    this.logger.info("Started regular syncing");
    this.chain.on("processedBlock", this.onProcessedBlock);
    this.currentTarget = this.chain.forkChoice.headBlockSlot();
    this.targetSlotRangeSource = pushable<ISlotRange>();
    const newTarget = await this.getNewTarget();
    this.logger.info("Setting target", {newTargetSlot: newTarget});
    await Promise.all([
      this.sync(),
      this.setTarget()
    ]);
  }

  public async stop(): Promise<void> {
    this.targetSlotRangeSource.end();
    this.controller.abort();
    this.chain.removeListener("processedBlock", this.onProcessedBlock);
    this.chain.clock.unsubscribeFromNewSlot(this.onNewSlot);
    this.network.gossip.unsubscribe(this.chain.currentForkDigest, GossipEvent.BLOCK, this.onGossipBlock);
  }

  public getHighestBlock(): Slot {
    return this.currentTarget;
  }

  private async getNewTarget(): Promise<Slot> {
    const state = await this.chain.getHeadState();
    return getCurrentSlot(this.config, state.genesisTime);
  }

  private setTarget = async (newTarget?: Slot, triggerSync = true): Promise<void> => {
    newTarget = newTarget || await this.getNewTarget();
    if(triggerSync && newTarget > this.currentTarget) {
      this.logger.info(`Requesting blocks from slot ${this.currentTarget + 1} to slot ${newTarget}`);
      this.targetSlotRangeSource.push({start: this.currentTarget + 1, end: newTarget});
    }
    this.currentTarget = newTarget;
  };

  private onProcessedBlock = async(lastProcessedBlock: SignedBeaconBlock): Promise<void> => {
    if(this.currentTarget <= lastProcessedBlock.message.slot) {
      if(await this.checkSyncComplete()) {
        return;
      }
      this.logger.info(`Synced up to slot ${lastProcessedBlock.message.slot}`);
      if (!this.doneFirstSync) {
        this.doneFirstSync = true;
        this.network.gossip.subscribeToBlock(this.chain.currentForkDigest, this.onGossipBlock);
        this.chain.clock.onNewSlot(this.onNewSlot);
        this.logger.info("Finished first sync, triggered onNewSlot and onGossipBlock");
      }
    }
  };

  private onNewSlot = async (slot: Slot): Promise<void> => {
    // the chunkify wants `slot + 1`
    await this.setTarget(slot + 1);
  };

  private onGossipBlock = async(block: SignedBeaconBlock): Promise<void> => {
    this.gossipParentBlockRoot = block.message.parentRoot;
    this.logger.verbose(`Set gossip parent block to ${toHexString(this.gossipParentBlockRoot)}` +
      `, gossip slot ${block.message.slot}`);
    await this.checkSyncComplete();
  };

  private checkSyncComplete = async(): Promise<boolean> => {
    if (this.gossipParentBlockRoot && this.chain.forkChoice.hasBlock(this.gossipParentBlockRoot as Uint8Array)) {
      this.logger.important("Sync caught up to gossip block parent " + toHexString(this.gossipParentBlockRoot));
      await this.stop();
      return true;
    }
    return false;
  };

  private async sync(): Promise<void> {
    const config = this.config;
    const logger = this.logger;
    const chain = this.chain;
    const controller = this.controller;
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
              await setTarget(lastFetchedSlot, false);
            } else {
              // some peers maybe not up to date, retry the range again next time
              await setTarget(range.start - 1, false);
            }
          }
        })();
      }
    );
  }

  private getSyncPeers = async (): Promise<PeerId[]> => {
    return this.network.getPeers().reduce( (validPeers: PeerId[], peer: PeerId) => {
      const rep = this.reps.getFromPeerId(peer);
      if(rep && rep.latestStatus) {
        validPeers.push(peer);
      }
      return validPeers;
    }, [] as PeerId[]);
  };
}
