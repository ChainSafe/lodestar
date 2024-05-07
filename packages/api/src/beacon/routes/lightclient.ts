/* eslint-disable @typescript-eslint/naming-convention */
import {ListCompositeType, ValueOf, byteArrayEquals} from "@chainsafe/ssz";
import {ssz, SyncPeriod, allForks, deneb} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {BeaconConfig, ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {Endpoint, RouteDefinitions, Schema} from "../../utils/index.js";
import {MetaHeader, VersionCodec, VersionMeta} from "../../utils/metadata.js";
import {getLightClientForkTypes} from "../../utils/fork.js";
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
    {
      startPeriod: SyncPeriod;
      count: number;
      /** Only required for ssz response wire encoding */
      genesisValidatorsRoot?: Uint8Array;
    },
    {query: {start_period: number; count: number}},
    allForks.LightClientUpdate[],
    {version: ForkName[]}
  >;

  /**
   * Returns the latest optimistic head update available. Clients should use the SSE type `light_client_optimistic_update`
   * unless to get the very first head update after syncing, or if SSE are not supported by the server.
   */
  getLightClientOptimisticUpdate: Endpoint<
    //
    "GET",
    EmptyArgs,
    EmptyRequest,
    allForks.LightClientOptimisticUpdate,
    VersionMeta
  >;

  getLightClientFinalityUpdate: Endpoint<
    //
    "GET",
    EmptyArgs,
    EmptyRequest,
    allForks.LightClientFinalityUpdate,
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
    allForks.LightClientBootstrap,
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

export function definitions(config: ChainForkConfig): RouteDefinitions<Endpoints> {
  // this beacon config will be stored here in this closure so fork digests don't need to be recomputed
  let beaconConfig: BeaconConfig | undefined;

  return {
    getLightClientUpdatesByRange: {
      url: "/eth/v1/beacon/light_client/updates",
      method: "GET",
      req: {
        writeReq: ({startPeriod, count, genesisValidatorsRoot}) => {
          // store the beacon config if its a new genesisValidatorsRoot
          if (
            genesisValidatorsRoot &&
            (beaconConfig === undefined || !byteArrayEquals(beaconConfig.genesisValidatorsRoot, genesisValidatorsRoot))
          ) {
            beaconConfig = createBeaconConfig(config, genesisValidatorsRoot);
          }
          return {query: {start_period: startPeriod, count}};
        },
        parseReq: ({query}) => ({startPeriod: query.start_period, count: query.count}),
        schema: {query: {start_period: Schema.UintRequired, count: Schema.UintRequired}},
      },
      resp: {
        data: {
          toJson: (data, meta) => {
            if (data.length !== meta.version.length) {
              throw new Error("TODO"); // TODO
            }
            const json: unknown[] = [];
            for (const [i, version] of meta.version.entries()) {
              json.push(getLightClientForkTypes(version).LightClientUpdate.toJson(data[i] as deneb.LightClientUpdate));
            }
            return json;
          },
          fromJson: (data, meta) => {
            const value: allForks.LightClientUpdate[] = [];
            for (let i = 0; i < meta.version.length; i++) {
              const version = meta.version[i];
              value.push(getLightClientForkTypes(version).LightClientUpdate.fromJson((data as unknown[])[i]));
            }
            return value;
          },
          serialize: (data, meta) => {
            if (data.length !== meta.version.length) {
              throw new Error("TODO"); // TODO
            }
            if (!beaconConfig) {
              throw new Error("TODO"); // TODO
            }
            const bufs: Uint8Array[] = [];
            for (const [i, version] of meta.version.entries()) {
              const forkDigest = beaconConfig.forkName2ForkDigest(version);
              const serialized = getLightClientForkTypes(version).LightClientUpdate.serialize(
                data[i] as deneb.LightClientUpdate
              );
              const length = ssz.UintNum64.serialize(4 + serialized.length);
              bufs.push(length, forkDigest, serialized);
            }
            return Buffer.concat(bufs);
          },
          deserialize: (data) => {
            if (!beaconConfig) {
              throw new Error("TODO"); // TODO
            }
            let offset = 0;
            const value: allForks.LightClientUpdate[] = [];
            while (offset < data.length) {
              const length = ssz.UintNum64.deserialize(data.subarray(offset, offset + 8));
              const forkDigest = ssz.ForkDigest.deserialize(data.subarray(offset + 8, offset + 12));
              const version = beaconConfig.forkDigest2ForkName(forkDigest);
              value.push(
                getLightClientForkTypes(version).LightClientUpdate.deserialize(
                  data.subarray(offset + 12, offset + length)
                )
              );
              offset += length;
            }
            return value;
          },
        },
        meta: {
          toJson: (meta) => meta,
          fromJson: (val) => val as {version: ForkName[]},
          toHeadersObject: (meta) => ({
            [MetaHeader.Version]: meta.version.join(","),
          }),
          fromHeaders: (headers) => ({
            // TODO: this header format is not spec compliant, do we care?
            version: headers.getRequired(MetaHeader.Version).split(",") as ForkName[],
          }),
        },
        transform: {
          toResponse: (data, meta) => {
            const r: unknown[] = [];
            for (let i = 0; i < (data as unknown[]).length; i++) {
              r.push({data: (data as unknown[])[i], version: (meta as {version: string[]}).version[i]});
            }
            return r;
          },
          fromResponse: (resp) => {
            const d: allForks.LightClientUpdate[] = [];
            const meta: {version: ForkName[]} = {version: []};
            for (const {data, version} of resp as {data: allForks.LightClientUpdate; version: ForkName}[]) {
              d.push(data);
              meta.version.push(version);
            }
            return {data: d, meta};
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
