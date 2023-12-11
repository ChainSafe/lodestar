import {concat} from "uint8arrays";
import {digest} from "@chainsafe/as-sha256";
import {createProof, Proof, ProofType} from "@chainsafe/persistent-merkle-tree";
import {routes, ServerApi} from "@lodestar/api";
import {altair, RootHex, SyncPeriod} from "@lodestar/types";
import {notNullish} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {BeaconStateAltair} from "../utils/types.js";

export class ProofServerApiMock implements ServerApi<routes.proof.Api> {
  readonly states = new Map<RootHex, BeaconStateAltair>();

  async getStateProof(stateId: string, descriptor: Uint8Array): Promise<{data: Proof}> {
    const state = this.states.get(stateId);
    if (!state) throw Error(`stateId ${stateId} not available`);
    return {data: createProof(state.node, {type: ProofType.compactMulti, descriptor})};
  }

  async getBlockProof(blockId: string, _descriptor: Uint8Array): Promise<{data: Proof}> {
    throw Error(`blockId ${blockId} not available`);
  }
}

type VersionedLightClientUpdate = {
  version: ForkName;
  data: altair.LightClientUpdate;
};

export class LightclientServerApiMock implements ServerApi<routes.lightclient.Api> {
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

  async getOptimisticUpdate(): Promise<{version: ForkName; data: altair.LightClientOptimisticUpdate}> {
    if (!this.latestHeadUpdate) throw Error("No latest head update");
    return {version: ForkName.bellatrix, data: this.latestHeadUpdate};
  }

  async getFinalityUpdate(): Promise<{version: ForkName; data: altair.LightClientFinalityUpdate}> {
    if (!this.finalized) throw Error("No finalized head update");
    return {version: ForkName.bellatrix, data: this.finalized};
  }

  async getBootstrap(blockRoot: string): Promise<{version: ForkName; data: altair.LightClientBootstrap}> {
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
