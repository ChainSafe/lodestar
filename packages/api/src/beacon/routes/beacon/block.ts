import {ContainerType} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {phase0, allForks, Slot, Root, ssz, RootHex, deneb, isSignedBlockContents} from "@lodestar/types";

import {
  RoutesData,
  ReturnTypes,
  ArrayOf,
  Schema,
  WithVersion,
  reqOnlyBody,
  TypeJson,
  ReqSerializers,
  ReqSerializer,
  ContainerDataExecutionOptimistic,
  WithExecutionOptimistic,
  ContainerData,
} from "../../../utils/index.js";
import {HttpStatusCode} from "../../../utils/client/httpStatusCode.js";
import {parseAcceptHeader, writeAcceptHeader} from "../../../utils/acceptHeader.js";
import {ApiClientResponse, ResponseFormat} from "../../../interfaces.js";
import {allForksSignedBlockContentsReqSerializer} from "../../../utils/routes.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type BlockId = RootHex | Slot | "head" | "genesis" | "finalized";

/**
 * True if the response references an unverified execution payload. Optimistic information may be invalidated at
 * a later time. If the field is not present, assume the False value.
 */
export type ExecutionOptimistic = boolean;

export type BlockHeaderResponse = {
  root: Root;
  canonical: boolean;
  header: phase0.SignedBeaconBlockHeader;
};

export enum BroadcastValidation {
  none = "none",
  gossip = "gossip",
  consensus = "consensus",
  consensusAndEquivocation = "consensus_and_equivocation",
}

export type BlockResponse<T extends ResponseFormat = "json"> = T extends "ssz"
  ? ApiClientResponse<{[HttpStatusCode.OK]: Uint8Array}, HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND>
  : ApiClientResponse<
      {[HttpStatusCode.OK]: {data: allForks.SignedBeaconBlock}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >;

export type BlockV2Response<T extends ResponseFormat = "json"> = T extends "ssz"
  ? ApiClientResponse<{[HttpStatusCode.OK]: Uint8Array}, HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND>
  : ApiClientResponse<
      {
        [HttpStatusCode.OK]: {
          data: allForks.SignedBeaconBlock;
          executionOptimistic: ExecutionOptimistic;
          version: ForkName;
        };
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >;

export type Api = {
  /**
   * Get block
   * Returns the complete `SignedBeaconBlock` for a given block ID.
   * Depending on the `Accept` header it can be returned either as JSON or SSZ-serialized bytes.
   *
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlock<T extends ResponseFormat = "json">(blockId: BlockId, format?: T): Promise<BlockResponse<T>>;

  /**
   * Get block
   * Retrieves block details for given block id.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockV2<T extends ResponseFormat = "json">(blockId: BlockId, format?: T): Promise<BlockV2Response<T>>;

  /**
   * Get block attestations
   * Retrieves attestation included in requested block.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockAttestations(blockId: BlockId): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: {
          data: phase0.Attestation[];
          executionOptimistic: ExecutionOptimistic;
        };
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >
  >;

  /**
   * Get block header
   * Retrieves block header for given block id.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockHeader(blockId: BlockId): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: {
          data: BlockHeaderResponse;
          executionOptimistic: ExecutionOptimistic;
        };
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >
  >;

  /**
   * Get block headers
   * Retrieves block headers matching given query. By default it will fetch current head slot blocks.
   * @param slot
   * @param parentRoot
   */
  getBlockHeaders(filters: Partial<{slot: Slot; parentRoot: string}>): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: {
          data: BlockHeaderResponse[];
          executionOptimistic: ExecutionOptimistic;
        };
      },
      HttpStatusCode.BAD_REQUEST
    >
  >;

  /**
   * Get block root
   * Retrieves hashTreeRoot of BeaconBlock/BeaconBlockHeader
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockRoot(blockId: BlockId): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: {
          data: {root: Root};
          executionOptimistic: ExecutionOptimistic;
        };
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >
  >;

  /**
   * Publish a signed block.
   * Instructs the beacon node to broadcast a newly signed beacon block to the beacon network,
   * to be included in the beacon chain. The beacon node is not required to validate the signed
   * `BeaconBlock`, and a successful response (20X) only indicates that the broadcast has been
   * successful. The beacon node is expected to integrate the new block into its state, and
   * therefore validate the block internally, however blocks which fail the validation are still
   * broadcast but a different status code is returned (202)
   *
   * @param requestBody The `SignedBeaconBlock` object composed of `BeaconBlock` object (produced by beacon node) and validator signature.
   * @returns any The block was validated successfully and has been broadcast. It has also been integrated into the beacon node's database.
   */
  publishBlock(blockOrContents: allForks.SignedBeaconBlockOrContents): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: void;
        [HttpStatusCode.ACCEPTED]: void;
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  publishBlockV2(
    blockOrContents: allForks.SignedBeaconBlockOrContents,
    opts?: {broadcastValidation?: BroadcastValidation}
  ): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: void;
        [HttpStatusCode.ACCEPTED]: void;
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  /**
   * Publish a signed blinded block by submitting it to the mev relay and patching in the block
   * transactions beacon node gets in response.
   */
  publishBlindedBlock(blindedBlock: allForks.SignedBlindedBeaconBlock): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: void;
        [HttpStatusCode.ACCEPTED]: void;
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;

  publishBlindedBlockV2(
    blindedBlockOrContents: allForks.SignedBlindedBeaconBlock,
    opts: {broadcastValidation?: BroadcastValidation}
  ): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: void;
        [HttpStatusCode.ACCEPTED]: void;
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.SERVICE_UNAVAILABLE
    >
  >;
  /**
   * Get block BlobSidecar
   * Retrieves BlobSidecar included in requested block.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlobSidecars(blockId: BlockId): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: {executionOptimistic: ExecutionOptimistic; data: deneb.BlobSidecars};
    }>
  >;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getBlock: {url: "/eth/v1/beacon/blocks/{block_id}", method: "GET"},
  getBlockV2: {url: "/eth/v2/beacon/blocks/{block_id}", method: "GET"},
  getBlockAttestations: {url: "/eth/v1/beacon/blocks/{block_id}/attestations", method: "GET"},
  getBlockHeader: {url: "/eth/v1/beacon/headers/{block_id}", method: "GET"},
  getBlockHeaders: {url: "/eth/v1/beacon/headers", method: "GET"},
  getBlockRoot: {url: "/eth/v1/beacon/blocks/{block_id}/root", method: "GET"},
  publishBlock: {url: "/eth/v1/beacon/blocks", method: "POST"},
  publishBlockV2: {url: "/eth/v2/beacon/blocks", method: "POST"},
  publishBlindedBlock: {url: "/eth/v1/beacon/blinded_blocks", method: "POST"},
  publishBlindedBlockV2: {url: "/eth/v2/beacon/blinded_blocks", method: "POST"},
  getBlobSidecars: {url: "/eth/v1/beacon/blob_sidecars/{block_id}", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */

type GetBlockReq = {params: {block_id: string}; headers: {accept?: string}};
type BlockIdOnlyReq = {params: {block_id: string}};

export type ReqTypes = {
  getBlock: GetBlockReq;
  getBlockV2: GetBlockReq;
  getBlockAttestations: BlockIdOnlyReq;
  getBlockHeader: BlockIdOnlyReq;
  getBlockHeaders: {query: {slot?: number; parent_root?: string}};
  getBlockRoot: BlockIdOnlyReq;
  publishBlock: {body: unknown};
  publishBlockV2: {body: unknown; query: {broadcast_validation?: string}};
  publishBlindedBlock: {body: unknown};
  publishBlindedBlockV2: {body: unknown; query: {broadcast_validation?: string}};
  getBlobSidecars: BlockIdOnlyReq;
};

export function getReqSerializers(config: ChainForkConfig): ReqSerializers<Api, ReqTypes> {
  const blockIdOnlyReq: ReqSerializer<Api["getBlockHeader"], BlockIdOnlyReq> = {
    writeReq: (block_id) => ({params: {block_id: String(block_id)}}),
    parseReq: ({params}) => [params.block_id],
    schema: {params: {block_id: Schema.StringRequired}},
  };

  const getBlockReq: ReqSerializer<Api["getBlock"], GetBlockReq> = {
    writeReq: (block_id, format) => ({
      params: {block_id: String(block_id)},
      headers: {accept: writeAcceptHeader(format)},
    }),
    parseReq: ({params, headers}) => [params.block_id, parseAcceptHeader(headers.accept)],
    schema: {params: {block_id: Schema.StringRequired}},
  };

  // Compute block type from JSON payload. See https://github.com/ethereum/eth2.0-APIs/pull/142
  const getSignedBeaconBlockType = (data: allForks.SignedBeaconBlock): allForks.AllForksSSZTypes["SignedBeaconBlock"] =>
    config.getForkTypes(data.message.slot).SignedBeaconBlock;

  const AllForksSignedBlockOrContents: TypeJson<allForks.SignedBeaconBlockOrContents> = {
    toJson: (data) =>
      isSignedBlockContents(data)
        ? allForksSignedBlockContentsReqSerializer(getSignedBeaconBlockType).toJson(data)
        : getSignedBeaconBlockType(data).toJson(data),

    fromJson: (data) =>
      (data as {signed_block: unknown}).signed_block !== undefined
        ? allForksSignedBlockContentsReqSerializer(getSignedBeaconBlockType).fromJson(data)
        : getSignedBeaconBlockType(data as allForks.SignedBeaconBlock).fromJson(data),
  };

  const getSignedBlindedBeaconBlockType = (
    data: allForks.SignedBlindedBeaconBlock
  ): allForks.AllForksBlindedSSZTypes["SignedBeaconBlock"] =>
    config.getBlindedForkTypes(data.message.slot).SignedBeaconBlock;

  const AllForksSignedBlindedBlock: TypeJson<allForks.SignedBlindedBeaconBlock> = {
    toJson: (data) => getSignedBlindedBeaconBlockType(data).toJson(data),
    fromJson: (data) => getSignedBlindedBeaconBlockType(data as allForks.SignedBlindedBeaconBlock).fromJson(data),
  };

  return {
    getBlock: getBlockReq,
    getBlockV2: getBlockReq,
    getBlockAttestations: blockIdOnlyReq,
    getBlockHeader: blockIdOnlyReq,
    getBlockHeaders: {
      writeReq: (filters) => ({query: {slot: filters?.slot, parent_root: filters?.parentRoot}}),
      parseReq: ({query}) => [{slot: query?.slot, parentRoot: query?.parent_root}],
      schema: {query: {slot: Schema.Uint, parent_root: Schema.String}},
    },
    getBlockRoot: blockIdOnlyReq,
    publishBlock: reqOnlyBody(AllForksSignedBlockOrContents, Schema.Object),
    publishBlockV2: {
      writeReq: (item, {broadcastValidation} = {}) => ({
        body: AllForksSignedBlockOrContents.toJson(item),
        query: {broadcast_validation: broadcastValidation},
      }),
      parseReq: ({body, query}) => [
        AllForksSignedBlockOrContents.fromJson(body),
        {broadcastValidation: query.broadcast_validation as BroadcastValidation},
      ],
      schema: {
        body: Schema.Object,
        query: {broadcast_validation: Schema.String},
      },
    },
    publishBlindedBlock: reqOnlyBody(AllForksSignedBlindedBlock, Schema.Object),
    publishBlindedBlockV2: {
      writeReq: (item, {broadcastValidation}) => ({
        body: AllForksSignedBlindedBlock.toJson(item),
        query: {broadcast_validation: broadcastValidation},
      }),
      parseReq: ({body, query}) => [
        AllForksSignedBlindedBlock.fromJson(body),
        {broadcastValidation: query.broadcast_validation as BroadcastValidation},
      ],
      schema: {
        body: Schema.Object,
        query: {broadcast_validation: Schema.String},
      },
    },
    getBlobSidecars: blockIdOnlyReq,
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const BeaconHeaderResType = new ContainerType({
    root: ssz.Root,
    canonical: ssz.Boolean,
    header: ssz.phase0.SignedBeaconBlockHeader,
  });

  const RootContainer = new ContainerType({
    root: ssz.Root,
  });

  return {
    getBlock: ContainerData(ssz.phase0.SignedBeaconBlock),
    getBlockV2: WithExecutionOptimistic(WithVersion((fork) => ssz[fork].SignedBeaconBlock)),
    getBlockAttestations: ContainerDataExecutionOptimistic(ArrayOf(ssz.phase0.Attestation)),
    getBlockHeader: ContainerDataExecutionOptimistic(BeaconHeaderResType),
    getBlockHeaders: ContainerDataExecutionOptimistic(ArrayOf(BeaconHeaderResType)),
    getBlockRoot: ContainerDataExecutionOptimistic(RootContainer),
    getBlobSidecars: ContainerDataExecutionOptimistic(ssz.deneb.BlobSidecars),
  };
}
