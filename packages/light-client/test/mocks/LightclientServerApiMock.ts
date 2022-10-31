import {Proof} from "@chainsafe/persistent-merkle-tree";
import {JsonPath} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {altair, RootHex, SyncPeriod} from "@lodestar/types";
import {BeaconStateAltair} from "../utils/types.js";

export class LightclientServerApiMock implements routes.lightclient.Api {
  readonly states = new Map<RootHex, BeaconStateAltair>();
  readonly updates = new Map<SyncPeriod, altair.LightClientUpdate>();
  readonly snapshots = new Map<RootHex, routes.lightclient.LightClientBootstrap>();
  latestHeadUpdate: altair.LightClientOptimisticUpdate | null = null;
  finalized: altair.LightClientFinalityUpdate | null = null;

  async getStateProof(stateId: string, paths: JsonPath[]): Promise<{data: Proof}> {
    const state = this.states.get(stateId);
    if (!state) throw Error(`stateId ${stateId} not available`);
    return {data: state.createProof(paths)};
  }

  getUpdates(startPeriod: SyncPeriod, count: number, format?: "json"): Promise<{data: altair.LightClientUpdate[]}>;
  getUpdates(startPeriod: SyncPeriod, count: number, format?: "ssz"): Promise<Uint8Array>;
  async getUpdates(from: SyncPeriod, to: SyncPeriod): Promise<Uint8Array | {data: altair.LightClientUpdate[]}> {
    const updates: altair.LightClientUpdate[] = [];
    for (let period = parseInt(String(from)); period <= parseInt(String(to)); period++) {
      const update = this.updates.get(period);
      if (update) {
        updates.push(update);
      }
    }
    return {data: updates};
  }

  getOptimisticUpdate(format?: "json"): Promise<{data: altair.LightClientOptimisticUpdate}>;
  getOptimisticUpdate(format?: "ssz"): Promise<Uint8Array>;
  async getOptimisticUpdate(): Promise<Uint8Array | {data: altair.LightClientOptimisticUpdate}> {
    if (!this.latestHeadUpdate) throw Error("No latest head update");
    return {data: this.latestHeadUpdate};
  }

  getFinalityUpdate(format?: "json"): Promise<{data: altair.LightClientFinalityUpdate}>;
  getFinalityUpdate(format?: "ssz"): Promise<Uint8Array>;
  async getFinalityUpdate(): Promise<Uint8Array | {data: altair.LightClientFinalityUpdate}> {
    if (!this.finalized) throw Error("No finalized head update");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    return {data: this.finalized};
  }

  getBootstrap(blockRoot: string, format?: "json"): Promise<{data: altair.LightClientBootstrap}>;
  getBootstrap(blockRoot: string, format?: "ssz"): Promise<Uint8Array>;
  async getBootstrap(blockRoot: string): Promise<Uint8Array | {data: altair.LightClientBootstrap}> {
    const snapshot = this.snapshots.get(blockRoot);
    if (!snapshot) throw Error(`snapshot for blockRoot ${blockRoot} not available`);
    return {data: snapshot};
  }
}

export type IStateRegen = {
  getStateByRoot(stateRoot: string): Promise<BeaconStateAltair>;
};

export type IBlockCache = {
  getBlockByRoot(blockRoot: string): Promise<altair.BeaconBlock>;
};
