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
      //TODO: figure out how to filter and return blocks with given parent root
      return result;
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
    const blockRoot = await resolveBlockId(this.config, this.chain.forkChoice, blockId);
    if(!blockRoot) {
      return null;
    }
    //TODO: handle when root points to finalized block
    return toBeaconHeaderResponse(this.config, await this.db.block.get(blockRoot.valueOf() as Uint8Array));
  }

  public async getBlock(blockId: BlockId): Promise<SignedBeaconBlock | null> {
    const blockRoot = await resolveBlockId(this.config, this.chain.forkChoice, blockId);
    if(!blockRoot) {
      return null;
    }
    //TODO: handle when root points to finalized block
    return await this.db.block.get(blockRoot.valueOf() as Uint8Array);
  }

}

