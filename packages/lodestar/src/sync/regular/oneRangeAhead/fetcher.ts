import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {ErrorAborted, ILogger, sleep} from "@chainsafe/lodestar-utils";
import deepmerge from "deepmerge";
import PeerId from "peer-id";
import {IRegularSyncModules} from "..";
import {defaultOptions, IRegularSyncOptions} from "../options";
import {IBeaconChain} from "../../../chain";
import {INetwork} from "../../../network";
import {getBlockRange} from "../../utils/blocks";
import {ISlotRange, ISyncCheckpoint} from "../../interface";
import {ZERO_HASH} from "../../../constants";
import {IBlockRangeFetcher} from "./interface";

export class BlockRangeFetcher implements IBlockRangeFetcher {
  protected readonly config: IBeaconConfig;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly logger: ILogger;
  private readonly opts: IRegularSyncOptions;
  // for control range across next() calls
  private lastFetchCheckpoint: ISyncCheckpoint;
  // for each next() call
  private rangeStart: Slot = 0;
  private rangeEnd: Slot = 0;
  private getPeers: () => Promise<PeerId[]>;

  constructor(options: Partial<IRegularSyncOptions>, modules: IRegularSyncModules, getPeers: () => Promise<PeerId[]>) {
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.opts = deepmerge(defaultOptions, options);
    this.getPeers = getPeers;
    this.lastFetchCheckpoint = {blockRoot: ZERO_HASH, slot: 0};
  }

  public setLastProcessedBlock(lastProcessedBlock: ISyncCheckpoint): void {
    this.lastFetchCheckpoint = lastProcessedBlock;
  }

  /**
   * Get next block range.
   */
  public async getNextBlockRange(): Promise<SignedBeaconBlock[]> {
    this.updateNextRange();
    let result: SignedBeaconBlock[] | null = null;
    while (!result || !result!.length) {
      let slotRange: ISlotRange | null = null;
      try {
        const peers = await this.getPeers();
        if (result && !result.length) await this.handleEmptyRange(peers);
        slotRange = {start: this.rangeStart, end: this.rangeEnd};
        // result = await getBlockRange(this.logger, this.network.reqResp, peers, slotRange);
        // Work around of https://github.com/ChainSafe/lodestar/issues/1690
        result = (await Promise.race([
          getBlockRange(this.logger, this.network.reqResp, peers, slotRange),
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error("beacon_blocks_by_range timeout"));
            }, 2 * 60 * 1000); // 2 minutes
          }),
        ])) as SignedBeaconBlock[] | null;
      } catch (e) {
        this.logger.debug("Regular Sync: Failed to get block range ", {...(slotRange ?? {}), error: e.message});
        // sync is stopped for whatever reasons
        if (e instanceof ErrorAborted) return [];
        result = null;
      }
    }
    // success
    const lastBlock = result[result.length - 1].message;
    this.lastFetchCheckpoint = {blockRoot: this.config.types.BeaconBlock.hashTreeRoot(lastBlock), slot: lastBlock.slot};
    return result!;
  }

  // always set range based on last fetch block bc sometimes the previous fetch may not return all blocks
  private updateNextRange(): void {
    this.rangeStart = this.lastFetchCheckpoint.slot + 1;
    this.rangeEnd = this.rangeStart;
    this.rangeEnd = this.getNewTarget();
  }

  private async handleEmptyRange(peers: PeerId[] = []): Promise<void> {
    if (!this.getPeers.length) {
      return;
    }
    const range = {start: this.rangeStart, end: this.rangeEnd};
    const peerHeadSlot = Math.max(...peers.map((peer) => this.network.peerMetadata.getStatus(peer)?.headSlot ?? 0));
    this.logger.verbose("Regular Sync: Not found any blocks for range", {range});
    if (range.end <= peerHeadSlot) {
      // range contains skipped slots, query for next range
      this.logger.verbose("Regular Sync: queried range is behind peer head, fetch next range", {
        ...range,
        peerHead: peerHeadSlot,
      });
      // don't trust empty range as it's rarely happen, peer may return it incorrectly or not up to date
      // same range start, expand range end
      this.rangeEnd = this.getNewTarget();
    } else {
      this.logger.verbose("Regular Sync: Queried range passed peer head, sleep then try again", {
        range,
        peerHead: peerHeadSlot,
      });
      // don't want to disturb our peer if we pass peer head
      await sleep(this.config.params.SECONDS_PER_SLOT * 1000);
    }
  }

  private getNewTarget(): Slot {
    const currentSlot = this.chain.clock.currentSlot;
    // due to exclusive endSlot in chunkify, we want `currentSlot + 1`
    return Math.min(this.rangeEnd + this.opts.blockPerChunk, currentSlot + 1);
  }
}
