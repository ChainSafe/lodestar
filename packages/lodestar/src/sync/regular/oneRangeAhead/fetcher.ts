import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import deepmerge from "deepmerge";
import PeerId from "peer-id";
import {IRegularSyncModules} from "..";
import {defaultOptions, IRegularSyncOptions} from "../options";
import {IBeaconChain} from "../../../chain";
import {INetwork} from "../../../network";
import {getBlockRange} from "../../utils/blocks";
import {ISlotRange, ISyncCheckpoint} from "../../interface";
import {ZERO_HASH} from "../../../constants";

export class BlockRangeFetcher {
  protected readonly config: IBeaconConfig;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly logger: ILogger;
  private readonly opts: IRegularSyncOptions;
  // for control range across next() calls
  private lastFetchBlock: ISyncCheckpoint;
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
    this.lastFetchBlock = {blockRoot: ZERO_HASH, slot: 0};
  }

  public setLastProcessedBlock(lastProcessedBlock: ISyncCheckpoint): void {
    this.lastFetchBlock = lastProcessedBlock;
  }

  /**
   * Get next block range.
   */
  public async next(): Promise<SignedBeaconBlock[]> {
    this.getNextRange();
    let result: SignedBeaconBlock[] | null = null;
    while (!result || !result!.length) {
      let slotRange: ISlotRange | null = null;
      try {
        const peers = await this.getPeers();
        // node is stopped
        if (!peers || !peers.length) return [];
        if (result && !result!.length) await this.handleEmptyRange(peers);
        slotRange = {start: this.rangeStart, end: this.rangeEnd};
        result = await getBlockRange(this.logger, this.network.reqResp, peers, slotRange);
      } catch (e) {
        this.logger.debug("Failed to get block range " + JSON.stringify(slotRange || {}) + ". Error: " + e.message);
        result = null;
      }
    }
    // success
    const lastBlock = result[result.length - 1].message;
    this.lastFetchBlock = {blockRoot: this.config.types.BeaconBlock.hashTreeRoot(lastBlock), slot: lastBlock.slot};
    return result!;
  }

  // always set range based on last fetch block bc sometimes the previous fetch may not return all blocks
  private getNextRange(): void {
    this.rangeStart = this.lastFetchBlock.slot + 1;
    this.rangeEnd = this.rangeStart;
    this.rangeEnd = this.getNewTarget();
  }

  private async handleEmptyRange(peers: PeerId[] = []): Promise<void> {
    if (!this.getPeers.length) {
      return;
    }
    const range = {start: this.rangeStart, end: this.rangeEnd};
    const peerHeadSlot = Math.max(...peers.map((peer) => this.network.peerMetadata.getStatus(peer)?.headSlot ?? 0));
    this.logger.verbose(`Regular Sync: Not found any blocks for range ${JSON.stringify(range)}`);
    if (range.end <= peerHeadSlot) {
      // range contains skipped slots, query for next range
      this.logger.verbose("Regular Sync: queried range is behind peer head, fetch next range", {
        range: JSON.stringify(range),
        peerHead: peerHeadSlot,
      });
      // don't trust empty range as it's rarely happen, peer may return it incorrectly or not up to date
      // same range start, expand range end
      this.rangeEnd = this.getNewTarget();
    } else {
      this.logger.verbose("Regular Sync: Queried range passed peer head, sleep then try again", {
        range: JSON.stringify(range),
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
