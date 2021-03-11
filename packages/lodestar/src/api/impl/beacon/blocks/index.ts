import {Root, phase0, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconChain} from "../../../../chain";
import {IBeaconDb} from "../../../../db/api";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../interface";
import {BlockId, IBeaconBlocksApi} from "./interface";
import {resolveBlockId, toBeaconHeaderResponse} from "./utils";
import {IBeaconSync} from "../../../../sync";
import {checkSyncStatus} from "../../utils";
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
      const canonicalRoot = this.config.types.phase0.BeaconBlock.hashTreeRoot(canonicalBlock.message);
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

  async getBlockHeader(blockId: BlockId): Promise<phase0.SignedBeaconHeaderResponse | null> {
    const block = await this.getBlock(blockId);
    if (!block) {
      return null;
    }
    return toBeaconHeaderResponse(this.config, block, true);
  }

  async getBlock(blockId: BlockId): Promise<phase0.SignedBeaconBlock | null> {
    return await resolveBlockId(this.config, this.chain.forkChoice, this.db, blockId);
  }

  async publishBlock(signedBlock: phase0.SignedBeaconBlock): Promise<void> {
    await checkSyncStatus(this.config, this.sync);
    await Promise.all([this.chain.receiveBlock(signedBlock), this.network.gossip.publishBeaconBlock(signedBlock)]);
  }
}
