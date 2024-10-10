import {CompactMultiProof, ProofType} from "@chainsafe/persistent-merkle-tree";
import {ByteListType, ContainerType} from "@chainsafe/ssz";
import {fromHex, toHex} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {Endpoint, RouteDefinitions, Schema} from "../../utils/index.js";
import {ArrayOf} from "../../utils/codecs.js";
import {VersionCodec, VersionMeta} from "../../utils/metadata.js";

export const CompactMultiProofType = new ContainerType({
  leaves: ArrayOf(ssz.Root, 10000),
  descriptor: new ByteListType(2048),
});

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type Endpoints = {
  /**
   * Returns a multiproof of `descriptor` at the requested `stateId`.
   * The requested `stateId` may not be available. Regular nodes only keep recent states in memory.
   */
  getStateProof: Endpoint<
    "GET",
    {stateId: string; descriptor: Uint8Array},
    {params: {state_id: string}; query: {format: string}},
    CompactMultiProof,
    VersionMeta
  >;
  /**
   * Returns a multiproof of `descriptor` at the requested `blockId`.
   * The requested `blockId` may not be available. Regular nodes only keep recent states in memory.
   */
  getBlockProof: Endpoint<
    "GET",
    {blockId: string; descriptor: Uint8Array},
    {params: {block_id: string}; query: {format: string}},
    CompactMultiProof,
    VersionMeta
  >;
};

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getStateProof: {
      url: "/eth/v0/beacon/proof/state/{state_id}",
      method: "GET",
      req: {
        writeReq: ({stateId, descriptor}) => ({params: {state_id: stateId}, query: {format: toHex(descriptor)}}),
        parseReq: ({params, query}) => ({stateId: params.state_id, descriptor: fromHex(query.format)}),
        schema: {params: {state_id: Schema.StringRequired}, query: {format: Schema.StringRequired}},
      },
      resp: {
        data: {
          toJson: (data) => CompactMultiProofType.toJson(data),
          fromJson: (data) => ({...CompactMultiProofType.fromJson(data), type: ProofType.compactMulti}),
          serialize: (data) => CompactMultiProofType.serialize(data),
          deserialize: (data) => ({...CompactMultiProofType.deserialize(data), type: ProofType.compactMulti}),
        },
        meta: VersionCodec,
      },
    },
    getBlockProof: {
      url: "/eth/v0/beacon/proof/block/{block_id}",
      method: "GET",
      req: {
        writeReq: ({blockId, descriptor}) => ({params: {block_id: blockId}, query: {format: toHex(descriptor)}}),
        parseReq: ({params, query}) => ({blockId: params.block_id, descriptor: fromHex(query.format)}),
        schema: {params: {block_id: Schema.StringRequired}, query: {format: Schema.StringRequired}},
      },
      resp: {
        data: {
          toJson: (data) => CompactMultiProofType.toJson(data),
          fromJson: (data) => ({...CompactMultiProofType.fromJson(data), type: ProofType.compactMulti}),
          serialize: (data) => CompactMultiProofType.serialize(data),
          deserialize: (data) => ({...CompactMultiProofType.deserialize(data), type: ProofType.compactMulti}),
        },
        meta: VersionCodec,
      },
    },
  };
}
