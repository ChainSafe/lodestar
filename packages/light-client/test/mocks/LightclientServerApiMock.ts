import {concat} from "uint8arrays";
import {digest} from "@chainsafe/as-sha256";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {JsonPath} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {altair, RootHex, SyncPeriod} from "@lodestar/types";
import {notNullish} from "@lodestar/utils";
import {
  VersionedLightClientFinalityUpdate,
  VersionedLightClientOptimisticUpdate,
  VersionedLightClientUpdate,
  VersionedLightClientBootstrap,
} from "@lodestar/api/src/beacon/routes/lightclient";
import {ForkName} from "@lodestar/params";
import {BeaconStateAltair} from "../utils/types.js";

export class ProofServerApiMock implements routes.proof.Api {
  readonly states = new Map<RootHex, BeaconStateAltair>();

  async getStateProof(stateId: string, paths: JsonPath[]): Promise<{data: Proof}> {
    const state = this.states.get(stateId);
    if (!state) throw Error(`stateId ${stateId} not available`);
    return {data: state.createProof(paths)};
  }
}

export class LightclientServerApiMock implements routes.lightclient.Api {
  readonly updates = new Map<SyncPeriod, altair.LightClientUpdate>();
  readonly snapshots = new Map<RootHex, altair.LightClientBootstrap>();
  latestHeadUpdate: altair.LightClientOptimisticUpdate | null = null;
  finalized: altair.LightClientFinalityUpdate | null = null;

  async getUpdates(from: SyncPeriod, to: SyncPeriod): Promise<VersionedLightClientUpdate[]> {
    const updates: VersionedLightClientUpdate[] = [];
    for (let period = parseInt(String(from)); period <= parseInt(String(to)); period++) {
      const update = this.updates.get(period);
      if (update) {
        updates.push({
          version: ForkName.bellatrix,
          data: update,
        });
      }
    }
    return updates;
  }

  async getOptimisticUpdate(): Promise<VersionedLightClientOptimisticUpdate> {
    if (!this.latestHeadUpdate) throw Error("No latest head update");
    return {version: ForkName.bellatrix, data: this.latestHeadUpdate};
  }

  async getFinalityUpdate(): Promise<VersionedLightClientFinalityUpdate> {
    if (!this.finalized) throw Error("No finalized head update");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    return {version: ForkName.bellatrix, data: this.finalized};
  }

  async getBootstrap(blockRoot: string): Promise<VersionedLightClientBootstrap> {
    const snapshot = this.snapshots.get(blockRoot);
    if (!snapshot) throw Error(`snapshot for blockRoot ${blockRoot} not available`);
    return {version: ForkName.bellatrix, data: snapshot};
  }

  async getCommitteeRoot(startPeriod: SyncPeriod, count: number): Promise<{data: Uint8Array[]}> {
    const periods = Array.from({length: count}, (_ignored, i) => i + startPeriod);
    const committeeHashes = periods
      .map((period) => this.updates.get(period)?.nextSyncCommittee.pubkeys)
      .filter(notNullish)
      .map((pubkeys) => digest(concat(pubkeys)));
    return {data: committeeHashes};
  }
}

export type IStateRegen = {
  getStateByRoot(stateRoot: string): Promise<BeaconStateAltair>;
};

export type IBlockCache = {
  getBlockByRoot(blockRoot: string): Promise<altair.BeaconBlock>;
};
