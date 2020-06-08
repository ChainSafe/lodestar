import {IRegularSync, IRegularSyncModules} from "../interface";
import {INetwork} from "../../../network";
import {IBeaconChain} from "../../../chain";
import {defaultOptions, IRegularSyncOptions} from "../options";
import deepmerge from "deepmerge";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IReputationStore} from "../../IReputation";
import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import pushable, {Pushable} from "it-pushable";
import pipe from "it-pipe";
import {fetchBlockChunks, getHighestCommonSlot, processSyncBlocks} from "../../utils";
import {ISlotRange} from "../../interface";

export class NaiveRegularSync implements IRegularSync {

  private readonly config: IBeaconConfig;

  private readonly network: INetwork;

  private readonly chain: IBeaconChain;

  private readonly reps: IReputationStore;

  private readonly logger: ILogger;

  private readonly opts: IRegularSyncOptions;

  private currentTarget: Slot = 0;
  private targetSlotRangeSource: Pushable<ISlotRange>;

  constructor(options: Partial<IRegularSyncOptions>, modules: IRegularSyncModules) {
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
    this.chain.on("processedBlock", this.checkSyncProgress);
    this.currentTarget = this.chain.forkChoice.headBlockSlot();
    this.targetSlotRangeSource = pushable<ISlotRange>();
    const newTarget = await this.getNewTarget();
    if(newTarget <= this.currentTarget) {
      this.logger.info("Already on latest know slot!");
      await this.stop();
    }
    this.logger.info("Setting target", {newTargetSlot: newTarget});
    await Promise.all([
      this.sync(),
      this.setTarget()
    ]);
  }

  public async stop(): Promise<void> {
    this.targetSlotRangeSource.end();
    this.chain.removeListener("processedBlock", this.checkSyncProgress);
  }

  public getHighestBlock(): Slot {
    return this.currentTarget;
  }

  private async getNewTarget(): Promise<Slot> {
    return getHighestCommonSlot(
      (await this.getSyncPeers(
        0
      )).map((peer) => this.reps.getFromPeerInfo(peer))
    );
  }

  private setTarget = async (newTarget?: Slot, triggerSync = true): Promise<void> => {
    newTarget = newTarget || await this.getNewTarget();
    if(triggerSync && newTarget > this.currentTarget) {
      this.logger.info(`Requesting blocks from slot ${this.currentTarget + 1} to slot ${newTarget}`);
      this.targetSlotRangeSource.push({start: this.currentTarget + 1, end: newTarget});
    }
    if(newTarget > this.currentTarget) {
      this.currentTarget = newTarget;
    }

  };

  private checkSyncProgress = async(lastProcessedBlock: SignedBeaconBlock): Promise<void> => {
    if(this.currentTarget <= lastProcessedBlock.message.slot) {
      const newTarget = await this.getNewTarget();
      if(newTarget <= this.currentTarget) {
        //sync completed
        this.logger.info("Sync caught up to latest slot " + this.currentTarget);
        await this.stop();
        return;
      }
      await this.setTarget(newTarget);
    }
  };

  private async sync(): Promise<void> {
    const config = this.config;
    const logger = this.logger;
    const chain = this.chain;
    const reqResp = this.network.reqResp;
    const getSyncPeers = this.getSyncPeers;
    const setTarget = this.setTarget;
    await pipe(
      this.targetSlotRangeSource,
      (source) => {
        return(async function() {
          for await (const range of source) {
            const lastFetchedSlot = await pipe(
              [range],
              fetchBlockChunks(logger, chain, reqResp, getSyncPeers),
              processSyncBlocks(config, chain, logger)
            );
            if(lastFetchedSlot) {
              await setTarget(lastFetchedSlot, false);
            } else {
              await setTarget(range.end, true);
            }
          }
        })();
      }
    );
  }

  private getSyncPeers = async (minSlot: Slot): Promise<PeerInfo[]> => {
    //not sure how to check this since we need to sync two epoch before we will have finalized like others
    // const chainFinalizedCheckpoint = (await this.chain.getHeadState()).finalizedCheckpoint;
    return this.network.getPeers().filter((peer) => {
      const latestStatus = this.reps.getFromPeerInfo(peer).latestStatus;
      return latestStatus
          && latestStatus.headSlot >= minSlot;
    });
  };
}
