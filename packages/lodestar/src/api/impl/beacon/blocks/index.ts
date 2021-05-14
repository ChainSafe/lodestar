import {Root, phase0, allForks, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconChain} from "../../../../chain";
import {IBeaconDb} from "../../../../db";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../interface";
import {BlockId, IBeaconBlocksApi} from "./interface";
import {resolveBlockId, toBeaconHeaderResponse} from "./utils";
import {IBeaconSync} from "../../../../sync";
import {INetwork} from "../../../../network/interface";

export * from "./interface";

export class BeaconBlockApi implements IBeaconBlocksApi {
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly sync: IBeaconSync;
  private readonly network: INetwork;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "network" | "sync" | "chain" | "db">) {
    this.config = modules.config;
    this.sync = modules.sync;
    this.chain = modules.chain;
    this.db = modules.db;
    this.network = modules.network;
  }

  async getBlockHeaders(
    filters: Partial<{slot: Slot; parentRoot: Root}>
  ): Promise<phase0.SignedBeaconHeaderResponse[]> {
    const result: phase0.SignedBeaconHeaderResponse[] = [];
    if (filters.parentRoot) {
      const finalizedBlock = await this.db.blockArchive.getByParentRoot(filters.parentRoot);
      if (finalizedBlock) {
        result.push(toBeaconHeaderResponse(this.config, finalizedBlock, true));
      }
      const nonFinalizedBlockSummaries = this.chain.forkChoice.getBlockSummariesByParentRoot(
        filters.parentRoot.valueOf() as Uint8Array
      );
      await Promise.all(
        nonFinalizedBlockSummaries.map(async (summary) => {
          const block = await this.db.block.get(summary.blockRoot);
          if (block) {
            const cannonical = this.chain.forkChoice.getCanonicalBlockSummaryAtSlot(block.message.slot);
            if (cannonical) {
              result.push(
                toBeaconHeaderResponse(
                  this.config,
                  block,
                  this.config.types.Root.equals(cannonical.blockRoot, summary.blockRoot)
                )
              );
            }
          }
        })
      );
      return result.filter(
        (item) =>
          // skip if no slot filter
          !(filters.slot && filters.slot !== 0) || item.header.message.slot === filters.slot
      );
    }

    const headSlot = this.chain.forkChoice.getHead().slot;
    if (!filters.parentRoot && !filters.slot && filters.slot !== 0) {
      filters.slot = headSlot;
    }

    if (filters.slot !== undefined) {
      // future slot
      if (filters.slot > headSlot) {
        return [];
      }

      const canonicalBlock = await this.chain.getCanonicalBlockAtSlot(filters.slot);
      // skip slot
      if (!canonicalBlock) {
        return [];
      }
      const canonicalRoot = this.config
        .getTypes(canonicalBlock.message.slot)
        .BeaconBlock.hashTreeRoot(canonicalBlock.message);
      result.push(toBeaconHeaderResponse(this.config, canonicalBlock, true));

      // fork blocks
      await Promise.all(
        this.chain.forkChoice.getBlockSummariesAtSlot(filters.slot).map(async (summary) => {
          if (!this.config.types.Root.equals(summary.blockRoot, canonicalRoot)) {
            const block = await this.db.block.get(summary.blockRoot);
            if (block) {
              result.push(toBeaconHeaderResponse(this.config, block));
            }
          }
        })
      );
    }

    return result;
  }

  async getBlockHeader(blockId: BlockId): Promise<phase0.SignedBeaconHeaderResponse> {
    const block = await this.getBlock(blockId);
    return toBeaconHeaderResponse(this.config, block, true);
  }

  async getBlock(blockId: BlockId): Promise<allForks.SignedBeaconBlock> {
    return await resolveBlockId(this.chain.forkChoice, this.db, blockId);
  }

  async getBlockRoot(blockId: BlockId): Promise<Root> {
    // Fast path: From head state already available in memory get historical blockRoot
    const slot = parseInt(blockId);
    if (!Number.isNaN(slot)) {
      const head = this.chain.forkChoice.getHead();

      if (slot === head.slot) {
        return head.blockRoot;
      }

      if (slot < head.slot && head.slot <= slot + this.config.params.SLOTS_PER_HISTORICAL_ROOT) {
        const state = this.chain.getHeadState();
        return state.blockRoots[slot % this.config.params.SLOTS_PER_HISTORICAL_ROOT];
      }
    }

    // Slow path
    const block = await resolveBlockId(this.chain.forkChoice, this.db, blockId);
    return this.config.getTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
  }

  async publishBlock(signedBlock: allForks.SignedBeaconBlock): Promise<void> {
    await Promise.all([this.chain.receiveBlock(signedBlock), this.network.gossip.publishBeaconBlock(signedBlock)]);
  }
}
