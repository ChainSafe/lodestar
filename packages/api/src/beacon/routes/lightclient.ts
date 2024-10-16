import {ListCompositeType, ValueOf} from "@chainsafe/ssz";
import {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  ssz,
  SyncPeriod,
} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ForkName, ZERO_HASH} from "@lodestar/params";
import {BeaconConfig, ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {genesisData, NetworkName} from "@lodestar/config/networks";
import {Endpoint, RouteDefinitions, Schema} from "../../utils/index.js";
import {MetaHeader, VersionCodec, VersionMeta} from "../../utils/metadata.js";
import {getLightClientForkTypes, toForkName} from "../../utils/fork.js";
import {
  EmptyArgs,
  EmptyRequestCodec,
  EmptyMeta,
  EmptyMetaCodec,
  EmptyRequest,
  WithVersion,
} from "../../utils/codecs.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export const HashListType = new ListCompositeType(ssz.Root, 10000);
export type HashList = ValueOf<typeof HashListType>;

export type Endpoints = {
  /**
   * Returns an array of best updates given a `startPeriod` and `count` number of sync committee period to return.
   * Best is defined by (in order of priority):
   * - Is finalized update
   * - Has most bits
   * - Oldest update
   */
  getLightClientUpdatesByRange: Endpoint<
    "GET",
    {startPeriod: SyncPeriod; count: number},
    {query: {start_period: number; count: number}},
    LightClientUpdate[],
    {versions: ForkName[]}
  >;

  /**
   * Returns the latest optimistic head update available. Clients should use the SSE type `light_client_optimistic_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getLightClientOptimisticUpdate: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    LightClientOptimisticUpdate,
    VersionMeta
  >;

  getLightClientFinalityUpdate: Endpoint<
    // ⏎
    "GET",
    EmptyArgs,
    EmptyRequest,
    LightClientFinalityUpdate,
    VersionMeta
  >;

  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * The trusted block root should be fetched with similar means to a weak subjectivity checkpoint.
   * Only block roots for checkpoints are guaranteed to be available.
   */
  getLightClientBootstrap: Endpoint<
    "GET",
    {blockRoot: string},
    {params: {block_root: string}},
    LightClientBootstrap,
    VersionMeta
  >;

  /**
   * Returns an array of sync committee hashes based on the provided period and count
   */
  getLightClientCommitteeRoot: Endpoint<
    "GET",
    {startPeriod: SyncPeriod; count: number},
    {query: {start_period: number; count: number}},
    HashList,
    EmptyMeta
  >;
};

export function getDefinitions(config: ChainForkConfig): RouteDefinitions<Endpoints> {
  // Cache config so fork digests don't need to be recomputed
  let beaconConfig: BeaconConfig | undefined;

  const cachedBeaconConfig = (): BeaconConfig => {
    if (beaconConfig === undefined) {
      const genesisValidatorsRoot = genesisData[config.CONFIG_NAME as NetworkName]?.genesisValidatorsRoot;
      beaconConfig = createBeaconConfig(config, genesisValidatorsRoot ? fromHex(genesisValidatorsRoot) : ZERO_HASH);
    }
    return beaconConfig;
  };

  return {
    getLightClientUpdatesByRange: {
      url: "/eth/v1/beacon/light_client/updates",
      method: "GET",
      req: {
        writeReq: ({startPeriod, count}) => ({query: {start_period: startPeriod, count}}),
        parseReq: ({query}) => ({startPeriod: query.start_period, count: query.count}),
        schema: {query: {start_period: Schema.UintRequired, count: Schema.UintRequired}},
      },
      resp: {
        data: {
          toJson: (data, meta) => {
            const json: unknown[] = [];
            for (const [i, update] of data.entries()) {
              json.push(getLightClientForkTypes(meta.versions[i]).LightClientUpdate.toJson(update));
            }
            return json;
          },
          fromJson: (data, meta) => {
            const updates = data as unknown[];
            const value: LightClientUpdate[] = [];
            for (let i = 0; i < updates.length; i++) {
              const version = meta.versions[i];
              value.push(getLightClientForkTypes(version).LightClientUpdate.fromJson(updates[i]));
            }
            return value;
          },
          serialize: (data, meta) => {
            const chunks: Uint8Array[] = [];
            for (const [i, update] of data.entries()) {
              const version = meta.versions[i];
              const forkDigest = cachedBeaconConfig().forkName2ForkDigest(version);
              const serialized = getLightClientForkTypes(version).LightClientUpdate.serialize(update);
              const length = ssz.UintNum64.serialize(4 + serialized.length);
              chunks.push(length, forkDigest, serialized);
            }
            return Buffer.concat(chunks);
          },
          deserialize: (data) => {
            let offset = 0;
            const updates: LightClientUpdate[] = [];
            while (offset < data.length) {
              const length = ssz.UintNum64.deserialize(data.subarray(offset, offset + 8));
              const forkDigest = ssz.ForkDigest.deserialize(data.subarray(offset + 8, offset + 12));
              const version = cachedBeaconConfig().forkDigest2ForkName(forkDigest);
              updates.push(
                getLightClientForkTypes(version).LightClientUpdate.deserialize(
                  data.subarray(offset + 12, offset + 8 + length)
                )
              );
              offset += 8 + length;
            }
            return updates;
          },
        },
        meta: {
          toJson: (meta) => meta,
          fromJson: (val) => val as {versions: ForkName[]},
          toHeadersObject: (meta) => ({
            [MetaHeader.Version]: meta.versions.join(","),
          }),
          fromHeaders: (headers) => {
            const versions = headers.getOrDefault(MetaHeader.Version, "");
            return {versions: versions === "" ? [] : (versions.split(",") as ForkName[])};
          },
        },
        transform: {
          toResponse: (data, meta) => {
            const updates = data as unknown[];
            const resp: unknown[] = [];
            for (let i = 0; i < updates.length; i++) {
              resp.push({data: updates[i], version: (meta as {versions: string[]}).versions[i]});
            }
            return resp;
          },
          fromResponse: (resp) => {
            if (!Array.isArray(resp)) {
              throw Error("JSON is not an array");
            }
            const updates: LightClientUpdate[] = [];
            const meta: {versions: ForkName[]} = {versions: []};
            for (const {data, version} of resp as {data: LightClientUpdate; version: string}[]) {
              updates.push(data);
              meta.versions.push(toForkName(version));
            }
            return {data: updates, meta};
          },
        },
      },
    },
    getLightClientOptimisticUpdate: {
      url: "/eth/v1/beacon/light_client/optimistic_update",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: WithVersion((fork) => getLightClientForkTypes(fork).LightClientOptimisticUpdate),
        meta: VersionCodec,
      },
    },
    getLightClientFinalityUpdate: {
      url: "/eth/v1/beacon/light_client/finality_update",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: WithVersion((fork) => getLightClientForkTypes(fork).LightClientFinalityUpdate),
        meta: VersionCodec,
      },
    },
    getLightClientBootstrap: {
      url: "/eth/v1/beacon/light_client/bootstrap/{block_root}",
      method: "GET",
      req: {
        writeReq: ({blockRoot}) => ({params: {block_root: blockRoot}}),
        parseReq: ({params}) => ({blockRoot: params.block_root}),
        schema: {params: {block_root: Schema.StringRequired}},
      },
      resp: {
        data: WithVersion((fork) => getLightClientForkTypes(fork).LightClientBootstrap),
        meta: VersionCodec,
      },
    },
    getLightClientCommitteeRoot: {
      url: "/eth/v0/beacon/light_client/committee_root",
      method: "GET",
      req: {
        writeReq: ({startPeriod, count}) => ({query: {start_period: startPeriod, count}}),
        parseReq: ({query}) => ({startPeriod: query.start_period, count: query.count}),
        schema: {query: {start_period: Schema.UintRequired, count: Schema.UintRequired}},
      },
      resp: {
        data: HashListType,
        meta: EmptyMetaCodec,
      },
    },
  };
}
