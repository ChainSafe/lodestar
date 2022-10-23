import varint from "varint";
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
  // We want some sort of resistance against this DoS vector.
  const maxGindicesInProof = opts.maxGindicesInProof ?? 512;

  const serializeLightClientUpdates = (chunks: LightClientUpdate[]): Uint8Array => {
    // https://github.com/ethereum/beacon-APIs/blob/master/apis/beacon/light_client/updates.yaml#L39
    /**
     * Sequence of zero or more `response_chunk`. Each _successful_ `response_chunk` MUST contain a single `LightClientUpdate` payload:
     * ```
     * (
     *   response_chunk_len: Little-endian Uint64 byte length of `response_chunk`
     *   response_chunk: (
     *     context: 4 byte `ForkDigest`
     *     payload: SSZ serialized payload bytes
     *   )
     * )
     */
    const result: Uint8Array[] = [];
    for (const lightClientUpdate of chunks) {
      const payload = ssz.altair.LightClientUpdate.serialize(lightClientUpdate);
      const forkDigest = config.forkName2ForkDigest(config.getForkName(lightClientUpdate.attestedHeader.slot));
      const responseChunk = new Uint8Array([...forkDigest, ...payload]);
      // length portion should be u64bit long according to specification
      const length = new Uint8Array(8);
      length.set(Uint8Array.from(varint.encode(responseChunk.length)), 0);
      result.push(new Uint8Array([...length, ...responseChunk]));
    }
    return result.reduce((acc, curr) => new Uint8Array([...acc, ...curr]));
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
        return serializeLightClientUpdates(updates) as any;
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
