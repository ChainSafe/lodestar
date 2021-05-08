import {altair, Root, SyncPeriod} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ApiNamespace, IApiModules} from "../interface";
import {IApiOptions} from "../../options";
import {Proof} from "@chainsafe/persistent-merkle-tree";

type Paths = (string | number)[];

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
  createStateProof(stateRoot: Root, paths: Paths): Promise<Proof>;
}

export class LightclientApi implements ILightclientApi {
  namespace = ApiNamespace.LIGHTCLIENT;

  private readonly lightClientUpdater: ILightClientUpdater;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "network" | "sync">) {
    this.namespace = ApiNamespace.BEACON;
    this.network = modules.network;
    this.sync = modules.sync;
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

  async createStateProof(stateRoot: Root, paths: Paths): Promise<Proof> {
    const state = (await this.api.debug.beacon.getState(req.params.stateId)) as TreeBacked<allForks.BeaconState>;
    return state.createProof(paths);
    const serialized = serializeProof(state.createProof(req.body.paths));
  }
}
