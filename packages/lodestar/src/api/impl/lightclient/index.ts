import {altair, ssz} from "@chainsafe/lodestar-types";
import {ApiModules} from "../types";
import {resolveStateId} from "../beacon/state/utils";
import {routes} from "@chainsafe/lodestar-api";
import {ApiError} from "../errors";
import {linspace} from "../../../util/numpy";
import {fromHexString, isCompositeType} from "@chainsafe/ssz";
import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {IApiOptions} from "../../options";

// TODO: Import from lightclient/server package

export function getLightclientApi(
  opts: IApiOptions,
  {chain, config, db}: Pick<ApiModules, "chain" | "config" | "db">
): routes.lightclient.Api {
  // It's currently possible to request gigantic proofs (eg: a proof of the entire beacon state)
  // We want some some sort of resistance against this DoS vector.
  const maxGindicesInProof = opts.maxGindicesInProof ?? 512;

  return {
    // Proofs API

    async getStateProof(stateId, paths) {
      const state = await resolveStateId(config, chain, db, stateId);
      const stateTreeBacked = ssz.altair.BeaconState.createTreeBackedFromStruct(state as altair.BeaconState);
      const tree = stateTreeBacked.tree;
      // Logic from TreeBacked#createProof is (mostly) copied here to expose the # of gindices in the proof
      let gindices = paths
        .map((path) => {
          const {type, gindex} = ssz.altair.BeaconState.getPathInfo(path);
          if (!isCompositeType(type)) {
            return gindex;
          } else {
            // if the path subtype is composite, include the gindices of all the leaves
            return type.tree_getLeafGindices(
              type.hasVariableSerializedLength() ? tree.getSubtree(gindex) : undefined,
              gindex
            );
          }
        })
        .flat(1);
      gindices = Array.from(new Set(gindices));
      if (gindices.length > maxGindicesInProof) {
        throw new Error("Requested proof is too large.");
      }
      return {
        data: tree.getProof({
          type: ProofType.treeOffset,
          gindices,
        }),
      };
    },

    // Sync API

    async getBestUpdates(from, to) {
      const periods = linspace(from, to);
      return {data: await chain.lightclientUpdater.getBestUpdates(periods)};
    },

    async getLatestUpdateFinalized() {
      const update = await chain.lightclientUpdater.getLatestUpdateFinalized();
      if (!update) throw new ApiError(404, "No update available");
      return {data: update};
    },

    async getLatestUpdateNonFinalized() {
      const update = await chain.lightclientUpdater.getLatestUpdateNonFinalized();
      if (!update) throw new ApiError(404, "No update available");
      return {data: update};
    },

    // Init API

    async getInitProof(blockRoot) {
      const proof = await chain.lightClientIniter.getInitProofByBlockRoot(fromHexString(blockRoot));
      if (!proof) {
        throw new ApiError(404, "No init proof available");
      }
      return {data: proof};
    },
  };
}
