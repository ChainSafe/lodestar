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
import {fetchBlockChunks, getHighestCommonSlot, processSyncBlocks, targetSlotToBlockChunks} from "../../utils";

export class NaiveRegularSync implements IRegularSync {

  private readonly config: IBeaconConfig;

  private readonly network: INetwork;

  private readonly chain: IBeaconChain;

  private readonly reps: IReputationStore;

  private readonly logger: ILogger;

  private readonly opts: IRegularSyncOptions;

  private currentTarget: Slot;
  private targetSlotSource: Pushable<Slot>;

  constructor(options: Partial<IRegularSyncOptions>, modules: IRegularSyncModules) {
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.reps = modules.reputationStore;
    this.logger = modules.logger;
    this.opts = deepmerge(defaultOptions, options);
    this.targetSlotSource = pushable<Slot>();
  }

  public async start(): Promise<void> {
    this.logger.info("Started regular syncing");
    this.chain.on("processedBlock", this.setNewTarget);
    this.currentTarget = (await this.chain.getHeadBlock()).message.slot;
    this.targetSlotSource = pushable<Slot>();
    await Promise.all([
      this.sync(),
      this.setNewTarget()
    ]);
  }

  public async stop(): Promise<void> {
    this.targetSlotSource.end();
    this.chain.removeListener("processedBlock", this.setNewTarget);
  }

  public getHighestBlock(): Slot {
    return this.currentTarget;
  }

  private setNewTarget = async (lastProcessedBlock?: SignedBeaconBlock): Promise<void> => {
    if(lastProcessedBlock && this.currentTarget > lastProcessedBlock.message.slot) {
      //chain is processing blocks but not yet at target slot
      return;
    }
    //either we aren't processing blocks or we reached target
    // we should either set new target or end sync
    const newTarget = getHighestCommonSlot(
      (await this.getSyncPeers(
        0
      )).map((peer) => this.reps.getFromPeerInfo(peer))
    );
    if(newTarget === this.currentTarget) {
      this.logger.debug("Caught up to latest slot " + newTarget);
      await this.stop();
      return;
    }
    this.targetSlotSource.push(newTarget);
    this.currentTarget = newTarget;
  };

  private async sync(): Promise<void> {
    await pipe(
      this.targetSlotSource,
      targetSlotToBlockChunks(this.config, this.chain, this.getSyncPeers),
      fetchBlockChunks(this.logger, this.chain, this.network.reqResp, this.getSyncPeers, this.opts.blockPerChunk),
      processSyncBlocks(this.config, this.chain, this.logger)
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
