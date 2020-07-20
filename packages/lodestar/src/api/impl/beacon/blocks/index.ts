import {BlockId, IBeaconBlocksApi} from "./interface";
import {Root, SignedBeaconBlock, SignedBeaconHeaderResponse, Slot} from "@chainsafe/lodestar-types";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../../../chain";
import {IBeaconDb} from "../../../../db/api";
import {resolveBlockId, toBeaconHeaderResponse} from "./utils";

export * from "./interface";

export class BeaconBlockApi implements IBeaconBlocksApi {

  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;

  public constructor(opts: Partial<IApiOptions>, modules: IApiModules) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
  }

  public async getBlockHeaders(
    filters: Partial<{ slot: Slot; parentRoot: Root }>
  ): Promise<SignedBeaconHeaderResponse[]> {
    const result: SignedBeaconHeaderResponse[] = [];
    if(filters.parentRoot) {
      const finalizedBlock = await this.db.blockArchive.getByParentRoot(filters.parentRoot);
      if(finalizedBlock) {
        result.push(toBeaconHeaderResponse(this.config, finalizedBlock, true));
      }
      const nonFinalizedBlockSummaries
          = this.chain.forkChoice.getBlockSummaryByParentBlockRoot(filters.parentRoot.valueOf() as Uint8Array);
      result.push(... await Promise.all(
        nonFinalizedBlockSummaries.map(async (summary) => {
          const block = await this.db.block.get(summary.blockRoot);
          const cannonical = this.chain.forkChoice.getCanonicalBlockSummaryAtSlot(block.message.slot);
          return toBeaconHeaderResponse(
            this.config,
            block,
            this.config.types.Root.equals(cannonical.blockRoot, summary.blockRoot)
          );
        })
      ));
      return result.filter(
        (item) =>
        //skip if no slot filter
          !(filters.slot && filters.slot !== 0) ||
              item.header.message.slot === filters.slot
      );
    }
    const headSlot = this.chain.forkChoice.headBlockSlot();
    if(!filters.parentRoot && !filters.slot && filters.slot !== 0) {
      filters.slot = headSlot;
    }
    //future slot
    if(filters.slot > headSlot) {
      return [];
    }
    const canonicalBlock = await this.chain.getBlockAtSlot(filters.slot);
    //skip slot
    if(!canonicalBlock) {
      return [];
    }
    const canonicalRoot = this.config.types.BeaconBlock.hashTreeRoot(canonicalBlock.message);
    result.push(toBeaconHeaderResponse(this.config, canonicalBlock, true));

    //fork blocks
    await Promise.all(
      this.chain.forkChoice.getBlockSummariesAtSlot(filters.slot)
        //remove canonical block
        .filter((summary) => !this.config.types.Root.equals(summary.blockRoot, canonicalRoot))
        .map(async (summary) => {
          result.push(toBeaconHeaderResponse(this.config, await this.db.block.get(summary.blockRoot)));
        })
    );
    return result;
  }

  public async getBlockHeader(blockId: BlockId): Promise<SignedBeaconHeaderResponse | null> {
    const block = await this.getBlock(blockId);
    if(!block) {
      return null;
    }
    return toBeaconHeaderResponse(this.config, block, true);
  }

  public async getBlock(blockId: BlockId): Promise<SignedBeaconBlock | null> {
    return await resolveBlockId(this.config, this.chain.forkChoice, this.db, blockId);
  }

}

