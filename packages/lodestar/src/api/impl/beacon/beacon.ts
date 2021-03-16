/**
 * @module api/rpc
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {LodestarEventIterator} from "@chainsafe/lodestar-utils";
import {ChainEvent, IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db/api";
import {IBeaconSync} from "../../../sync";
import {IApiOptions} from "../../options";
import {ApiNamespace, IApiModules} from "../interface";
import {BeaconBlockApi, IBeaconBlocksApi} from "./blocks";
import {IBeaconApi} from "./interface";
import {BeaconPoolApi, IBeaconPoolApi} from "./pool";
import {IBeaconStateApi} from "./state/interface";
import {BeaconStateApi} from "./state/state";

export class BeaconApi implements IBeaconApi {
  namespace: ApiNamespace;
  state: IBeaconStateApi;
  blocks: IBeaconBlocksApi;
  pool: IBeaconPoolApi;

  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly sync: IBeaconSync;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "chain" | "db" | "network" | "sync">) {
    this.namespace = ApiNamespace.BEACON;
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
    this.sync = modules.sync;
    this.state = new BeaconStateApi(opts, modules);
    this.blocks = new BeaconBlockApi(opts, modules);
    this.pool = new BeaconPoolApi(opts, modules);
  }

  async getGenesis(): Promise<phase0.Genesis | null> {
    return {
      genesisForkVersion: this.config.params.GENESIS_FORK_VERSION,
      genesisTime: BigInt(this.chain.genesisTime),
      genesisValidatorsRoot: this.chain.genesisValidatorsRoot,
    };
  }

  getBlockStream(): LodestarEventIterator<phase0.SignedBeaconBlock> {
    return new LodestarEventIterator<phase0.SignedBeaconBlock>(({push}) => {
      this.chain.emitter.on(ChainEvent.block, push);
      return () => {
        this.chain.emitter.off(ChainEvent.block, push);
      };
    });
  }
}
