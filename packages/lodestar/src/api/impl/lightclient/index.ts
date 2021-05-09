import {altair, SyncPeriod} from "@chainsafe/lodestar-types";
import {Path, TreeBacked} from "@chainsafe/ssz";
import {ApiNamespace, IApiModules} from "../interface";
import {IApiOptions} from "../../options";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {resolveStateId} from "../beacon/state/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db";

// TODO: Import from lightclient/server package
interface ILightClientUpdater {
  getBestUpdates(from: SyncPeriod, to: SyncPeriod): Promise<altair.LightClientUpdate[]>;
  getLatestUpdateFinalized(): Promise<altair.LightClientUpdate | null>;
  getLatestUpdateNonFinalized(): Promise<altair.LightClientUpdate | null>;
}

export interface ILightclientApi {
  getBestUpdates(from: SyncPeriod, to: SyncPeriod): Promise<altair.LightClientUpdate[]>;
  getLatestUpdateFinalized(): Promise<altair.LightClientUpdate | null>;
  getLatestUpdateNonFinalized(): Promise<altair.LightClientUpdate | null>;
  createStateProof(stateId: string, paths: Path[]): Promise<Proof>;
}

export class LightclientApi implements ILightclientApi {
  namespace = ApiNamespace.LIGHTCLIENT;

  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly chain: IBeaconChain;
  private readonly lightClientUpdater: ILightClientUpdater;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "db" | "chain">) {
    this.config = modules.config;
    this.db = modules.db;
    this.chain = modules.chain;
  }

  // Sync API

  async getBestUpdates(from: SyncPeriod, to: SyncPeriod): Promise<altair.LightClientUpdate[]> {
    return this.lightClientUpdater.getBestUpdates(from, to);
  }

  async getLatestUpdateFinalized(): Promise<altair.LightClientUpdate | null> {
    return this.lightClientUpdater.getLatestUpdateFinalized();
  }

  async getLatestUpdateNonFinalized(): Promise<altair.LightClientUpdate | null> {
    return this.lightClientUpdater.getLatestUpdateNonFinalized();
  }

  // Proofs API

  async createStateProof(stateId: string, paths: Path[]): Promise<Proof> {
    const state = await resolveStateId(this.config, this.chain, this.db, stateId);
    const stateTreeBacked = this.config.types.altair.BeaconState.createTreeBackedFromStruct(state);
    return stateTreeBacked.createProof(paths);
  }
}
