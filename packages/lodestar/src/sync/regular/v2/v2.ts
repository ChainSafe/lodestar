import {EventEmitter} from "events";
import {IRegularSync, IRegularSyncModules, RegularSyncEventEmitter} from "../interface";
import {Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {defaultOptions, IRegularSyncOptions} from "../options";
import deepmerge from "deepmerge";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {chunkify, createStatus, sortBlocks} from "../../utils";
import {IBeaconChain} from "../../../chain";
import {INetwork} from "../../../network";
import {IReputationStore} from "../../reputation";
import pipe from "it-pipe";
import {toHexString} from "@chainsafe/ssz";
import {fetchSlotRangeBlocks, getBestHead} from "./fetch";
import PeerId from "peer-id";

export class RegularSyncV2 extends (EventEmitter as { new(): RegularSyncEventEmitter }) implements IRegularSync {

  private readonly config: IBeaconConfig;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly reputationStore: IReputationStore;
  private readonly logger: ILogger;
  private readonly opts: IRegularSyncOptions;

  private bestHead: {root: Root; slot: Slot};

  constructor(options: Partial<IRegularSyncOptions>, modules: IRegularSyncModules) {
    super();
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.reputationStore = modules.reputationStore;
    this.logger = modules.logger.child({module: "Regular_Sync_V2"});
    this.opts = deepmerge(defaultOptions, options);
  }

  public async start(): Promise<void> {
    this.logger.info("Starting regular sync");
    this.bestHead = await getBestHead(
      this.reputationStore,
      this.network,
      this.logger,
      createStatus(this.chain.forkChoice.head(), this.chain.currentForkDigest)
    );
    if(this.chain.forkChoice.headBlockSlot() >= this.bestHead.slot) {
      this.logger.info(
        "Synced to best head slot",
        {slot: this.chain.forkChoice.headBlockSlot(), root: toHexString(this.chain.forkChoice.headBlockRoot())}
      );
      await this.stop();
      return;
    }
    this.sync(this.bestHead);
    this.chain.on("processedBlock", this.checkSync);
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("processedBlock", this.checkSync);
  }

  public getHighestBlock(): Slot {
    return this.bestHead.slot;
  }

  private checkSync = async (lastProcessedBlock: SignedBeaconBlock): Promise<void> => {
    if(lastProcessedBlock.message.slot >= this.bestHead.slot) {
      this.logger.verbose("Reached current best head, checking for new one");
      const newBestHead = await getBestHead(
        this.reputationStore,
        this.network,
        this.logger,
        createStatus(this.chain.forkChoice.head(), this.chain.currentForkDigest)
      );
      if(lastProcessedBlock.message.slot >= newBestHead.slot) {
        this.logger.info(
          "Synced to best head slot",
          {
            headSlot: this.chain.forkChoice.headBlockSlot(),
            headRoot: toHexString(this.chain.forkChoice.headBlockRoot()),
            bestSlot: newBestHead.slot,
            bestRoot: toHexString(newBestHead.root)
          }
        );
        await this.stop();
        return;
      }
      this.bestHead = newBestHead;
      this.sync(newBestHead);
    }
  };

  private sync(bestHead: {root: Root; slot: Slot}, headSlot?: Slot): void {
    const {logger, chain, opts} = this;
    const reqResp = this.network.reqResp;
    const sync = this.sync;
    const getPeers = this.getPeers(bestHead);
    logger.info("Syncing up to best head", {slot: bestHead.slot, root: toHexString(bestHead.root)});
    void pipe(
      () => {
        return (async function* () {
          const chunks = chunkify(opts.blockPerChunk, headSlot ?? chain.forkChoice.headBlockSlot(), bestHead.slot);
          logger.debug("Created chunks", {chunks: JSON.stringify(chunks)});
          yield chunks;
        })();
      },
      fetchSlotRangeBlocks(logger, chain, reqResp, getPeers),
      (source) => {
        return(async function() {
          let lastBlock: SignedBeaconBlock;
          for await (const blockRange of source) {
            const sortedBlocks= sortBlocks(blockRange);
            for(const block of sortedBlocks) {
              await chain.receiveBlock(block, false);
              if(!lastBlock || block.message.slot > lastBlock.message.slot) {
                lastBlock = block;
              }
            }
          }
          //block pool will find missing blocks in between
          if(lastBlock.message.slot < bestHead.slot) {
            logger.info("Failed to fetch best head block", {lastBlockSlot: lastBlock.message.slot});
            await sync(bestHead, lastBlock.message.slot);
          }
        })();
      }
    );
  }

  private getPeers = (bestHead: {root: Root; slot: Slot}): () => Promise<PeerId[]> => {
    const reputationStore = this.reputationStore;
    const config = this.config;
    return async () => this.network.getPeers()
      .filter((peer) => {
        const reputation = reputationStore.getFromPeerId(peer);
        return reputation?.latestStatus?.headSlot === bestHead.slot
          && config.types.Root.equals(bestHead.root, reputation.latestStatus.headRoot);
      });
  };

}
