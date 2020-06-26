import {IBeaconBlocksApi} from "./interface";
import {Root, SignedBeaconHeaderResponse, Slot} from "@chainsafe/lodestar-types";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../../../chain";
import {IBeaconDb} from "../../../../db/api";
import {toBeaconHeaderResponse} from "./utils";

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
    if(!filters.parentRoot && !filters.slot && filters.slot !== 0) {
      filters.slot = this.chain.forkChoice.headBlockSlot();
    }
    if(filters.slot > this.chain.forkChoice.headBlockSlot()) {
      return [];
    }
    const canonicalBlock = await this.chain.getBlockAtSlot(filters.slot);
    const canonicalRoot = this.config.types.BeaconBlock.hashTreeRoot(canonicalBlock.message);
    result.push(toBeaconHeaderResponse(this.config, canonicalBlock, true));

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

}

