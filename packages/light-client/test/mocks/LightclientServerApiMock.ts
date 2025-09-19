import {digest} from "@chainsafe/as-sha256";
import {CompactMultiProof, ProofType, createProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ForkName} from "@lodestar/params";
import {RootHex, SyncPeriod, altair} from "@lodestar/types";
import {notNullish} from "@lodestar/utils";
import {concat} from "uint8arrays/concat";
import {BeaconStateAltair} from "../utils/types.js";

type ProofApi = ApplicationMethods<routes.proof.Endpoints>;

export class ProofServerApiMock implements ProofApi {
  readonly states = new Map<RootHex, BeaconStateAltair>();

  async getStateProof({
    stateId,
    descriptor,
  }: {
    stateId: string;
    descriptor: Uint8Array;
  }): ReturnType<ProofApi["getStateProof"]> {
    const state = this.states.get(stateId);
    if (!state) throw Error(`stateId ${stateId} not available`);
    const proof = createProof(state.node, {type: ProofType.compactMulti, descriptor});
    return {data: proof as CompactMultiProof, meta: {version: ForkName.bellatrix}};
  }

  async getBlockProof({blockId}: {blockId: string}): ReturnType<ProofApi["getBlockProof"]> {
    throw Error(`blockId ${blockId} not available`);
  }
}

type LightClientApi = ApplicationMethods<routes.lightclient.Endpoints>;

export class LightclientServerApiMock implements LightClientApi {
  readonly updates = new Map<SyncPeriod, altair.LightClientUpdate>();
  readonly snapshots = new Map<RootHex, altair.LightClientBootstrap>();
  latestHeadUpdate: altair.LightClientOptimisticUpdate | null = null;
  finalized: altair.LightClientFinalityUpdate | null = null;

  async getLightClientUpdatesByRange(args: {
    startPeriod: SyncPeriod;
    count: number;
  }): ReturnType<LightClientApi["getLightClientUpdatesByRange"]> {
    const updates: altair.LightClientUpdate[] = [];
    for (let period = parseInt(String(args.startPeriod)); period <= parseInt(String(args.count)); period++) {
      const update = this.updates.get(period);
      if (update) {
        updates.push(update);
      }
    }
    return {data: updates, meta: {versions: Array.from({length: updates.length}, () => ForkName.bellatrix)}};
  }

  async getLightClientOptimisticUpdate(): ReturnType<LightClientApi["getLightClientOptimisticUpdate"]> {
    if (!this.latestHeadUpdate) throw Error("No latest head update");
    return {data: this.latestHeadUpdate, meta: {version: ForkName.bellatrix}};
  }

  async getLightClientFinalityUpdate(): ReturnType<LightClientApi["getLightClientFinalityUpdate"]> {
    if (!this.finalized) throw Error("No finalized head update");
    return {data: this.finalized, meta: {version: ForkName.bellatrix}};
  }

  async getLightClientBootstrap({
    blockRoot,
  }: {
    blockRoot: string;
  }): ReturnType<LightClientApi["getLightClientBootstrap"]> {
    const snapshot = this.snapshots.get(blockRoot);
    if (!snapshot) throw Error(`snapshot for blockRoot ${blockRoot} not available`);
    return {data: snapshot, meta: {version: ForkName.bellatrix}};
  }

  async getLightClientCommitteeRoot({
    startPeriod,
    count,
  }: {
    startPeriod: SyncPeriod;
    count: number;
  }): ReturnType<LightClientApi["getLightClientCommitteeRoot"]> {
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
