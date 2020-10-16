import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import deepmerge from "deepmerge";
import PeerId from "peer-id";
import {IRegularSyncModules} from "..";
import {defaultOptions, IRegularSyncOptions} from "../options";
import {IBeaconChain} from "../../../chain";
import {INetwork} from "../../../network";
import {getBlockRange} from "../../utils";
import {ISlotRange, ISyncCheckpoint} from "../../interface";

// TODO: reusable, unit test
export class BlockRangeFetcher {
  protected readonly config: IBeaconConfig;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly logger: ILogger;
  private readonly opts: IRegularSyncOptions;
  // inclusive
  private rangeStart: Slot = 0;
  // exclusive
  private rangeEnd: Slot = 0;
  private getPeers: () => Promise<PeerId[]>;

  constructor(options: Partial<IRegularSyncOptions>, modules: IRegularSyncModules, getPeers: () => Promise<PeerId[]>) {
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.opts = deepmerge(defaultOptions, options);
    this.getPeers = getPeers;
  }

  public setLastProcessedBlock(lastProcessedBlock: ISyncCheckpoint): void {
    this.rangeStart = lastProcessedBlock.slot;
    this.rangeEnd = this.rangeStart + 1;
  }

  /**
   * Get next block range.
   */
  public async next(): Promise<SignedBeaconBlock[]> {
    this.rangeStart = this.rangeEnd;
    this.rangeEnd = this.getNewTarget();
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
    return result!;
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
