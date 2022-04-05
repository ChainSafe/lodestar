import {ApiModules} from "../types";
import {resolveStateId} from "../beacon/state/utils";
import {routes} from "@chainsafe/lodestar-api";
import {linspace} from "../../../util/numpy";
import {fromHexString} from "@chainsafe/ssz";
import {ProofType, Tree} from "@chainsafe/persistent-merkle-tree";
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

    async getCommitteeUpdates(from, to) {
      const periods = linspace(from, to);
      const updates = await Promise.all(periods.map((period) => chain.lightClientServer.getCommitteeUpdates(period)));
      return {data: updates};
    },

    async getHeadUpdate() {
      return {data: await chain.lightClientServer.getLatestHeadUpdate()};
    },

    async getLatestHeadUpdate() {
      return {data: await chain.lightClientServer.getLatestHeadUpdate()};
    },

    async getLatestFinalizedHeadUpdate() {
      return {data: await chain.lightClientServer.getFinalizedHeadUpdate()};
    },

    async getSnapshot(blockRoot) {
      const snapshotProof = await chain.lightClientServer.getSnapshot(fromHexString(blockRoot));
      return {data: snapshotProof};
    },
  };
}
