import {concat} from "uint8arrays/concat";
import {routes} from "@lodestar/api";
import {fromHexString} from "@chainsafe/ssz";
import {SyncPeriod} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES, MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {LightClientUpdate} from "@lodestar/types/altair";
import {ssz} from "@lodestar/types";
import {RestLightClientUpdate} from "@lodestar/api/src/beacon/routes/lightclient";
import {ApiModules} from "../types.js";
import {IApiOptions} from "../../options.js";

// TODO: Import from lightclient/server package

export function getLightclientApi(
  opts: IApiOptions,
  {chain, config}: Pick<ApiModules, "chain" | "config" | "db">
): routes.lightclient.Api {
  const sszSerializeLightClientUpdates = (chunks: LightClientUpdate[]): Uint8Array => {
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
      const context = config.forkName2ForkDigest(config.getForkName(lightClientUpdate.attestedHeader.slot));
      // response_chunk_len should be u64bit long according to specification
      const responseChunkLength = ssz.UintNum64.serialize(payload.length + 4);
      concat([responseChunkLength, context, payload]);
      result.push(concat([responseChunkLength, context, payload]));
    }
    return result.reduce((acc, curr) => new Uint8Array([...acc, ...curr]));
  };

  const jsonSerializeLightClientUpdates = (chunks: LightClientUpdate[]): RestLightClientUpdate[] => {
    return chunks.map((chunk) => {
      const version = config.getForkName(chunk.attestedHeader.slot);
      return {
        version,
        data: chunk,
      };
    });
  };

  return {
    async getUpdates(startPeriod: SyncPeriod, count: number, format?: routes.debug.StateFormat) {
      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, count);
      const periods = Array.from({length: maxAllowedCount}, (_ignored, i) => i + startPeriod);
      const updates = await Promise.all(periods.map((period) => chain.lightClientServer.getUpdate(period)));
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return sszSerializeLightClientUpdates(updates) as any;
      } else {
        return jsonSerializeLightClientUpdates(updates);
      }
    },

    async getOptimisticUpdate(format?: routes.debug.StateFormat) {
      const data = chain.lightClientServer.getOptimisticUpdate();
      if (data === null) {
        throw Error("No optimistic update available");
      } else if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return ssz.altair.LightClientOptimisticUpdate.serialize(data) as any;
      } else {
        return {data};
      }
    },

    async getFinalityUpdate(format?: routes.debug.StateFormat) {
      const data = chain.lightClientServer.getFinalityUpdate();
      if (data === null) {
        throw Error("No finality update available");
      } else if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return ssz.altair.LightClientFinalityUpdate.serialize(data) as any;
      } else {
        return {data};
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

    async getCommitteeRoot(startPeriod: SyncPeriod, count: number) {
      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES, count);
      const periods = Array.from({length: maxAllowedCount}, (_ignored, i) => i + startPeriod);
      const committeeHashes = await Promise.all(
        periods.map((period) => chain.lightClientServer.getCommitteeRoot(period))
      );
      return {data: committeeHashes};
    },
  };
}
