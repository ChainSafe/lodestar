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
    //from all peers find one with highest slot head
    this.bestHead = await getBestHead(
      this.reputationStore,
      this.network,
      this.logger,
      createStatus(this.chain.forkChoice.head(), this.chain.currentForkDigest)
    );
    //if our head slot is greater, we are already synced
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
    //check if we processed block up to or past best head
    if(lastProcessedBlock.message.slot >= this.bestHead.slot && this.chain.listeners) {
      this.logger.info("Reached current best head, checking for new one");
      //check if while syncing peers moved to better head
      const newBestHead = await getBestHead(
        this.reputationStore,
        this.network,
        this.logger,
        createStatus(this.chain.forkChoice.head(), this.chain.currentForkDigest)
      );
      if(this.chain.forkChoice.headBlockSlot() >= newBestHead.slot) {
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
      //trigger sync to new best head
      this.sync(newBestHead);
    }
  };

  private sync(bestHead: {root: Root; slot: Slot}, headSlot?: Slot): void {
    const {logger, chain, opts} = this;
    const reqResp = this.network.reqResp;
    const sync = this.sync;
    //get all peers with status head same as best head
    //this ensured we dont fetch some range from different chain
    const getPeers = this.getPeers(bestHead);
    logger.info("Syncing up to best head", {slot: bestHead.slot, root: toHexString(bestHead.root)});
    // we might not need pipe here
    // pipe makes easier to test separate components but it's hard to do stuff in parallel
    void pipe(
      () => {
        return (async function* () {
          //split range between our head slot and best head slot into chunks
          //chunks should not be too small or we could end up waiting too long for range with few blocks
          yield chunkify(opts.blockPerChunk, headSlot ?? chain.forkChoice.headBlockSlot(), bestHead.slot);
        })();
      },
      fetchSlotRangeBlocks(logger, chain, reqResp, getPeers),
      (source) => {
        return(async function() {
          let lastBlock: SignedBeaconBlock;
          for await (const blockRange of source) {
            // we will receive chunks in order
            // but we cannot send in parallel (check comment inside fetchSlotRangeBlocks)
            const sortedBlocks= sortBlocks(blockRange);
            if(sortedBlocks.length > 0) {
              logger.info(
                "Received blocks for range",
                {
                  blockCount: sortedBlocks.length,
                  startSlot: sortedBlocks[0].message.slot,
                  endSlot: sortedBlocks[sortedBlocks.length - 1].message.slot
                }
              );
            } else {
              logger.info(
                "Range contained only skip slots"
              );
            }
            for(const block of sortedBlocks) {
              if(!block) continue;
              // while this makes sense in terms of filling our block pool
              // we don't know if we actually processed block (if our head is parent to received block)
              await chain.receiveBlock(block, false);
              if(!lastBlock || block.message.slot > lastBlock.message.slot) {
                lastBlock = block;
              }
            }
          }
          if(!lastBlock) {
            //no block returned assume error and restart sync
            await sync(bestHead);
            return;
          }
          //block pool will find missing blocks in between
          if(lastBlock.message.slot < bestHead.slot) {
            logger.info("Failed to fetch best head block", {lastBlockSlot: lastBlock.message.slot});
            // we didn't reach best head so try to fetch blocks from last slot to best head
            //note: this is buggy, our lastBlock might not have been process (our head is not parent)
            // in that case we need to resync from our head not lastBlock
            // (there is small chance that block pool would manage to find missing blocks)
            await sync(bestHead, lastBlock.message.slot);
          }
        })();
      }
    );
  }

  private getPeers = (bestHead: {root: Root; slot: Slot}): () => Promise<PeerId[]> => {
    const reputationStore = this.reputationStore;
    const config = this.config;
    //filter peers that have common best head so we don't sync from peers on different head
    return async () => this.network.getPeers()
      .filter((peer) => {
        const reputation = reputationStore.getFromPeerId(peer);
        return reputation?.latestStatus?.headSlot === bestHead.slot
          && config.types.Root.equals(bestHead.root, reputation.latestStatus.headRoot);
      });
  };

}
