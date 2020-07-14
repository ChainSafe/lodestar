/**
 * @module api/rpc
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  BLSPubkey,
  ForkResponse,
  Genesis,
  SignedBeaconBlock,
  Uint64,
  ValidatorResponse
} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "./interface";
import {IBeaconChain} from "../../../chain";
import {IApiOptions} from "../../options";
import {IApiModules} from "../../interface";
import {ApiNamespace} from "../../index";
import {IBeaconDb} from "../../../db/api";
import {IBeaconSync} from "../../../sync";
import {BeaconBlockApi, IBeaconBlocksApi} from "./blocks";
import {LodestarEventIterator} from "../../../util/events";
import {IBeaconPoolApi, BeaconPoolApi} from "./pool";

export class BeaconApi implements IBeaconApi {

  public namespace: ApiNamespace;
  public blocks: IBeaconBlocksApi;
  public pool: IBeaconPoolApi;

  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly sync: IBeaconSync;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config"|"chain"|"db"|"sync">) {
    this.namespace = ApiNamespace.BEACON;
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
    this.sync = modules.sync;
    this.blocks = new BeaconBlockApi(opts, modules);
    this.pool = new BeaconPoolApi(opts, modules);
  }

  public async getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse|null> {
    const {epochCtx, state} = await this.chain.getHeadStateContext();
    const index = epochCtx.pubkey2index.get(pubkey);
    if(index) {
      return {
        validator: state.validators[index],
        balance: state.balances[index],
        pubkey: pubkey,
        index
      };
    } else {
      return null;
    }
  }

  public async getFork(): Promise<ForkResponse> {
    const state = await this.chain.getHeadState();
    const networkId: Uint64 = this.chain.networkId;
    const fork = state? state.fork : {
      previousVersion: Buffer.alloc(4),
      currentVersion: Buffer.alloc(4),
      epoch: 0
    };
    return {
      fork,
      chainId: networkId,
      genesisValidatorsRoot: state.genesisValidatorsRoot,
    };
  }

  public async getGenesis(): Promise<Genesis|null> {
    const state = await this.chain.getHeadState();
    if(state) {
      return {
        genesisForkVersion: this.config.params.GENESIS_FORK_VERSION,
        genesisTime: BigInt(state.genesisTime),
        genesisValidatorsRoot: state.genesisValidatorsRoot
      };
    }
    return null;
  }

  public getBlockStream(): LodestarEventIterator<SignedBeaconBlock> {
    return new LodestarEventIterator<SignedBeaconBlock>(({push}) => {
      this.chain.on("processedBlock", push);
      return () => {
        this.chain.off("processedBlock", push);
      };
    });
  }
}
