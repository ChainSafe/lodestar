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
import {checkLinearChainSegment} from "../../utils/sync";

/**
 * Get next range by issuing beacon_blocks_by_range requests.
 * Returned result may miss some blocks or contain blocks of a different forkchoice branch.
 * This is ok, we handle that by beacon_blocks_by_root in sync service.
 */
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
  private getPeers: (exludedPeers?: string[]) => Promise<PeerId[]>;

  constructor(
    options: Partial<IRegularSyncOptions>,
    modules: IRegularSyncModules,
    getPeers: (exludedPeers?: string[]) => Promise<PeerId[]>
  ) {
    this.config = modules.config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.opts = deepmerge(defaultOptions, options);
    this.getPeers = getPeers;
    this.lastFetchCheckpoint = {blockRoot: ZERO_HASH, slot: 0};
  }

  public setLastProcessedBlock(lastFetchCheckpoint: ISyncCheckpoint): void {
    this.lastFetchCheckpoint = lastFetchCheckpoint;
  }

  /**
   * Get next block range.
   */
  public async getNextBlockRange(): Promise<SignedBeaconBlock[]> {
    this.updateNextRange();
    let result: SignedBeaconBlock[] | null = null;
    let peer: PeerId;
    // expect at least 2 blocks since we check linear chain
    while (!result || result!.length <= 1) {
      let slotRange: ISlotRange | null = null;
      try {
        if (result && result!.length <= 1) {
          await this.handleEmptyRange(peer!, result);
          // some weird peers keep returning 1 sinlge block although it's head is up to date
          // no evidence to penalty it so just ignore it the next round
          peer = (await this.getPeers([peer!.toB58String()!]))[0];
        } else {
          peer = (await this.getPeers())[0];
        }
        slotRange = {start: this.rangeStart, end: this.rangeEnd};
        // result = await getBlockRange(this.logger, this.network.reqResp, peers, slotRange);
        // Work around of https://github.com/ChainSafe/lodestar/issues/1690
        let timer: NodeJS.Timeout | null = null;
        result = (await Promise.race([
          getBlockRange(this.logger, this.network.reqResp, [peer], slotRange),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("beacon_blocks_by_range timeout"));
            }, 3 * 60 * 1000); // 3 minutes
          }),
        ])) as SignedBeaconBlock[] | null;
        if (timer) clearTimeout(timer);
        if (result) {
          // we queried from last fetched block
          result = result.filter(
            (signedBlock) =>
              !this.config.types.Root.equals(
                this.lastFetchCheckpoint.blockRoot,
                this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message)
              )
          );
          // 0-1 block result should go through and we'll handle it in next round
          if (result.length > 1) checkLinearChainSegment(this.config, result);
        }
      } catch (e) {
        this.logger.verbose("Regular Sync: Failed to get block range ", {...(slotRange ?? {}), error: e.message});
        // sync is stopped for whatever reasons
        if (e instanceof ErrorAborted) return [];
        result = null;
      }
    }
    // success, ignore last block (there should be >= 2 blocks) since we can't validate parent-child
    result.splice(result.length - 1, 1);
    const lastBlock = result[result.length - 1].message;
    this.lastFetchCheckpoint = {blockRoot: this.config.types.BeaconBlock.hashTreeRoot(lastBlock), slot: lastBlock.slot};
    return result!;
  }

  // always set range based on last fetch block bc sometimes the previous fetch may not return all blocks
  private updateNextRange(): void {
    // this.lastFetchCheckpoint.slot + 1 maybe an orphaned block and peers will return empty range
    this.rangeStart = this.lastFetchCheckpoint.slot;
    this.rangeEnd = this.rangeStart;
    this.rangeEnd = this.getNewTarget();
  }

  /**
   * Since we query 1 additional block to check linear chain, a return of 0 or 1 block
   * should go to this handler.
   */
  private async handleEmptyRange(peer: PeerId, blocks: SignedBeaconBlock[] = []): Promise<void> {
    const range = {start: this.rangeStart, end: this.rangeEnd};
    const peerHeadSlot = this.network.peerMetadata.getStatus(peer)?.headSlot ?? 0;
    this.logger.verbose("Regular Sync: Not found enough blocks for range", {
      range,
      numBlocks: blocks.length,
    });
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
    // since we want to check linear chain, query 1 additional slot
    return Math.min(this.rangeEnd + this.opts.blockPerChunk + 1, currentSlot + 1);
  }
}
