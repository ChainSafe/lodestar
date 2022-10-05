import {routes} from "@lodestar/api";
import {fromHexString} from "@chainsafe/ssz";
import {ProofType, Tree} from "@chainsafe/persistent-merkle-tree";
import {SyncPeriod} from "@lodestar/types";
import {LightClientUpdate} from "@lodestar/types/altair";
import {ssz} from "@lodestar/types";
import {ApiModules} from "../types.js";
import {resolveStateId} from "../beacon/state/utils.js";
import {IApiOptions} from "../../options.js";

// TODO: Import from lightclient/server package

export function getLightclientApi(
  opts: IApiOptions,
  {chain, config, db}: Pick<ApiModules, "chain" | "config" | "db">
): routes.lightclient.Api {
  // It's currently possible to request gigantic proofs (eg: a proof of the entire beacon state)
  // We want some some sort of resistance against this DoS vector.
  const maxGindicesInProof = opts.maxGindicesInProof ?? 512;

  const serializeSSZArray = (chunks: LightClientUpdate[]): Uint8Array => {
    const serializedChunks = chunks.map((chunk) => ssz.altair.LightClientUpdate.serialize(chunk));
    let length = 0;
    serializedChunks.forEach((item) => {
      length += item.length;
    });

    const mergedArray = new Uint8Array(length);
    let offset = 0;
    serializedChunks.forEach((item) => {
      mergedArray.set(item, offset);
      offset += item.length;
    });

    return mergedArray;
  };

  return {
    async getStateProof(stateId, jsonPaths) {
      const state = await resolveStateId(config, chain, db, stateId);

      // Commit any changes before computing the state root. In normal cases the state should have no changes here
      state.commit();
      const stateNode = state.node;
      const tree = new Tree(stateNode);

      const gindexes = state.type.tree_createProofGindexes(stateNode, jsonPaths);
      // TODO: Is it necessary to de-duplicate?
      //       It's not a problem if we overcount gindexes
      const gindicesSet = new Set(gindexes);

      if (gindicesSet.size > maxGindicesInProof) {
        throw new Error("Requested proof is too large.");
      }

      return {
        data: tree.getProof({
          type: ProofType.treeOffset,
          gindices: Array.from(gindicesSet),
        }),
      };
    },

    // eslint-disable-next-line @typescript-eslint/naming-convention
    async getUpdates(startPeriod: SyncPeriod, count: number, format?: routes.debug.StateFormat) {
      const updates = await chain.lightClientServer.getUpdates(startPeriod, count);
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return serializeSSZArray(updates) as any;
      } else {
        return {data: updates};
      }
    },

    async getOptimisticUpdate(format?: routes.debug.StateFormat) {
      const optimisticUpdate = chain.lightClientServer.getOptimisticUpdate();
      if (optimisticUpdate == null) {
        throw new Error("No latest header update available");
      } else {
        if (format === "ssz") {
          // Casting to any otherwise Typescript doesn't like the multi-type return
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
          return ssz.altair.LightClientOptimisticUpdate.serialize(optimisticUpdate) as any;
        }
        return {data: optimisticUpdate};
      }
    },

    async getFinalityUpdate(format?: routes.debug.StateFormat) {
      const finalityUpdate = chain.lightClientServer.getFinalityUpdate();
      if (finalityUpdate == null) {
        throw new Error("No latest finality update available");
      }
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return ssz.altair.LightClientFinalityUpdate.serialize(finalityUpdate) as any;
      } else {
        return {data: finalityUpdate};
      }
    },

    async getBootstrap(blockRoot, format?: routes.debug.StateFormat) {
      const bootstrapProof = await chain.lightClientServer.getBootstrap(fromHexString(blockRoot));
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return ssz.altair.LightClientBootstrap.serialize(bootstrapProof) as any;
      } else {
        return {data: bootstrapProof};
      }
    },
  };
}
