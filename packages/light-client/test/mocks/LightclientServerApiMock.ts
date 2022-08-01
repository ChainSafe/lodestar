import {Proof} from "@chainsafe/persistent-merkle-tree";
import {JsonPath} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {altair, RootHex, SyncPeriod} from "@lodestar/types";
import {BeaconStateAltair} from "../utils/types.js";

export class LightclientServerApiMock implements routes.lightclient.Api {
  readonly states = new Map<RootHex, BeaconStateAltair>();
  readonly updates = new Map<SyncPeriod, altair.LightClientUpdate>();
  readonly snapshots = new Map<RootHex, routes.lightclient.LightclientSnapshotWithProof>();
  latestHeadUpdate: routes.lightclient.LightclientOptimisticHeaderUpdate | null = null;
  finalized: routes.lightclient.LightclientFinalizedUpdate | null = null;

  async getStateProof(stateId: string, paths: JsonPath[]): Promise<{data: Proof}> {
    const state = this.states.get(stateId);
    if (!state) throw Error(`stateId ${stateId} not available`);
    return {data: state.createProof(paths)};
  }

  async getUpdates(from: SyncPeriod, to: SyncPeriod): Promise<{data: altair.LightClientUpdate[]}> {
    const updates: altair.LightClientUpdate[] = [];
    for (let period = parseInt(String(from)); period <= parseInt(String(to)); period++) {
      const update = this.updates.get(period);
      if (update) {
        updates.push(update);
      }
    }
    return {data: updates};
  }

  async getOptimisticUpdate(): Promise<{data: routes.lightclient.LightclientOptimisticHeaderUpdate}> {
    if (!this.latestHeadUpdate) throw Error("No latest head update");
    return {data: this.latestHeadUpdate};
  }

  async getFinalityUpdate(): Promise<{data: routes.lightclient.LightclientFinalizedUpdate}> {
    if (!this.finalized) throw Error("No finalized head update");
    return {data: this.finalized};
  }

  async getBootstrap(blockRoot: string): Promise<{data: routes.lightclient.LightclientSnapshotWithProof}> {
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
