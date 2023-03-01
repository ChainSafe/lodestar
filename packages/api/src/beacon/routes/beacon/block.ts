import {ContainerType} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {phase0, allForks, Slot, Root, ssz, RootHex, deneb} from "@lodestar/types";

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
import {ApiClientResponse} from "../../../interfaces.js";

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

export type Api = {
  /**
   * Get block
   * Returns the complete `SignedBeaconBlock` for a given block ID.
   * Depending on the `Accept` header it can be returned either as JSON or SSZ-serialized bytes.
   *
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlock(blockId: BlockId): Promise<ApiClientResponse<{[HttpStatusCode.OK]: {data: allForks.SignedBeaconBlock}}>>;

  /**
   * Get block
   * Retrieves block details for given block id.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockV2(
    blockId: BlockId
  ): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: {
          data: allForks.SignedBeaconBlock;
          executionOptimistic: ExecutionOptimistic;
          version: ForkName;
        };
      },
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >
  >;

  /**
   * Get block attestations
   * Retrieves attestation included in requested block.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockAttestations(
    blockId: BlockId
  ): Promise<
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
  getBlockHeader(
    blockId: BlockId
  ): Promise<
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
  getBlockHeaders(
    filters: Partial<{slot: Slot; parentRoot: string}>
  ): Promise<
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
  getBlockRoot(
    blockId: BlockId
  ): Promise<
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
  publishBlock(
    block: allForks.SignedBeaconBlock
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
  publishBlindedBlock(
    block: allForks.SignedBlindedBeaconBlock
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
   * Get block BlobsSidecar
   * Retrieves BlobsSidecar included in requested block.
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlobsSidecar(
    blockId: BlockId
  ): Promise<
    ApiClientResponse<{
      [HttpStatusCode.OK]: {executionOptimistic: ExecutionOptimistic; data: deneb.BlobsSidecar};
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
  publishBlindedBlock: {url: "/eth/v1/beacon/blinded_blocks", method: "POST"},
  getBlobsSidecar: {url: "/eth/v1/beacon/blobs_sidecars/{block_id}", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */

type BlockIdOnlyReq = {params: {block_id: string}};

export type ReqTypes = {
  getBlock: BlockIdOnlyReq;
  getBlockV2: BlockIdOnlyReq;
  getBlockAttestations: BlockIdOnlyReq;
  getBlockHeader: BlockIdOnlyReq;
  getBlockHeaders: {query: {slot?: number; parent_root?: string}};
  getBlockRoot: BlockIdOnlyReq;
  publishBlock: {body: unknown};
  publishBlindedBlock: {body: unknown};
  getBlobsSidecar: BlockIdOnlyReq;
};

export function getReqSerializers(config: ChainForkConfig): ReqSerializers<Api, ReqTypes> {
  const blockIdOnlyReq: ReqSerializer<Api["getBlock"], BlockIdOnlyReq> = {
    writeReq: (block_id) => ({params: {block_id: String(block_id)}}),
    parseReq: ({params}) => [params.block_id],
    schema: {params: {block_id: Schema.StringRequired}},
  };

  // Compute block type from JSON payload. See https://github.com/ethereum/eth2.0-APIs/pull/142
  const getSignedBeaconBlockType = (data: allForks.SignedBeaconBlock): allForks.AllForksSSZTypes["SignedBeaconBlock"] =>
    config.getForkTypes(data.message.slot).SignedBeaconBlock;

  const AllForksSignedBeaconBlock: TypeJson<allForks.SignedBeaconBlock> = {
    toJson: (data) => getSignedBeaconBlockType(data).toJson(data),
    fromJson: (data) => getSignedBeaconBlockType((data as unknown) as allForks.SignedBeaconBlock).fromJson(data),
  };

  const getSignedBlindedBeaconBlockType = (
    data: allForks.SignedBlindedBeaconBlock
  ): allForks.AllForksBlindedSSZTypes["SignedBeaconBlock"] =>
    config.getBlindedForkTypes(data.message.slot).SignedBeaconBlock;

  const AllForksSignedBlindedBeaconBlock: TypeJson<allForks.SignedBlindedBeaconBlock> = {
    toJson: (data) => getSignedBlindedBeaconBlockType(data).toJson(data),
    fromJson: (data) =>
      getSignedBlindedBeaconBlockType((data as unknown) as allForks.SignedBlindedBeaconBlock).fromJson(data),
  };

  return {
    getBlock: blockIdOnlyReq,
    getBlockV2: blockIdOnlyReq,
    getBlockAttestations: blockIdOnlyReq,
    getBlockHeader: blockIdOnlyReq,
    getBlockHeaders: {
      writeReq: (filters) => ({query: {slot: filters?.slot, parent_root: filters?.parentRoot}}),
      parseReq: ({query}) => [{slot: query?.slot, parentRoot: query?.parent_root}],
      schema: {query: {slot: Schema.Uint, parent_root: Schema.String}},
    },
    getBlockRoot: blockIdOnlyReq,
    publishBlock: reqOnlyBody(AllForksSignedBeaconBlock, Schema.Object),
    publishBlindedBlock: reqOnlyBody(AllForksSignedBlindedBeaconBlock, Schema.Object),
    getBlobsSidecar: blockIdOnlyReq,
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
    getBlobsSidecar: ContainerDataExecutionOptimistic(ssz.deneb.BlobsSidecar),
  };
}
