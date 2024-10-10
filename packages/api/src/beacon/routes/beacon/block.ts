import {ContainerType, ListCompositeType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {
  Slot,
  ssz,
  RootHex,
  deneb,
  isSignedBlockContents,
  SignedBeaconBlock,
  BeaconBlockBody,
  SignedBeaconBlockOrContents,
  SignedBlindedBeaconBlock,
  SignedBlockContents,
  sszTypesFor,
} from "@lodestar/types";
import {ForkName, ForkPreElectra, ForkPreExecution, isForkBlobs, isForkExecution} from "@lodestar/params";
import {Endpoint, RequestCodec, RouteDefinitions, Schema} from "../../../utils/index.js";
import {EmptyMeta, EmptyResponseCodec, EmptyResponseData, WithVersion} from "../../../utils/codecs.js";
import {
  ExecutionOptimisticAndFinalizedCodec,
  ExecutionOptimisticAndFinalizedMeta,
  ExecutionOptimisticFinalizedAndVersionCodec,
  ExecutionOptimisticFinalizedAndVersionMeta,
  MetaHeader,
} from "../../../utils/metadata.js";
import {getExecutionForkTypes, toForkName} from "../../../utils/fork.js";
import {fromHeaders} from "../../../utils/headers.js";
import {WireFormat} from "../../../utils/wireFormat.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export const BlockHeaderResponseType = new ContainerType({
  root: ssz.Root,
  canonical: ssz.Boolean,
  header: ssz.phase0.SignedBeaconBlockHeader,
});
export const BlockHeadersResponseType = new ListCompositeType(BlockHeaderResponseType, 1000);
export const RootResponseType = new ContainerType({
  root: ssz.Root,
});

export type BlockHeaderResponse = ValueOf<typeof BlockHeaderResponseType>;
export type BlockHeadersResponse = ValueOf<typeof BlockHeadersResponseType>;
export type RootResponse = ValueOf<typeof RootResponseType>;

export type BlockId = RootHex | Slot | "head" | "genesis" | "finalized" | "justified";

export type BlockArgs = {
  /**
   * Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  blockId: BlockId;
};

export enum BroadcastValidation {
  /**
  NOTE: The value `none` is not part of the spec. 

  In case a node is configured only with the unknownBlockSync, it needs to know the unknown parent blocks on the network 
  to initiate the syncing process. Such cases can be covered only if we publish blocks and make sure no gossip validation 
  is performed on those. But this behavior is not the default.
  */
  none = "none",
  gossip = "gossip",
  consensus = "consensus",
  consensusAndEquivocation = "consensus_and_equivocation",
}

export type Endpoints = {
  /**
   * Get block
   * Retrieves block details for given block id.
   */
  getBlockV2: Endpoint<
    "GET",
    BlockArgs,
    {params: {block_id: string}},
    SignedBeaconBlock,
    ExecutionOptimisticFinalizedAndVersionMeta
  >;

  /**
   * Get blinded block
   * Retrieves blinded block for given block id.
   */
  getBlindedBlock: Endpoint<
    "GET",
    BlockArgs,
    {params: {block_id: string}},
    SignedBlindedBeaconBlock | SignedBeaconBlock<ForkPreExecution>,
    ExecutionOptimisticFinalizedAndVersionMeta
  >;

  /**
   * Get block attestations
   * Retrieves attestation included in requested block.
   */
  getBlockAttestations: Endpoint<
    "GET",
    BlockArgs,
    {params: {block_id: string}},
    BeaconBlockBody<ForkPreElectra>["attestations"],
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get block attestations
   * Retrieves attestation included in requested block.
   */
  getBlockAttestationsV2: Endpoint<
    "GET",
    BlockArgs,
    {params: {block_id: string}},
    BeaconBlockBody["attestations"],
    ExecutionOptimisticFinalizedAndVersionMeta
  >;

  /**
   * Get block header
   * Retrieves block header for given block id.
   */
  getBlockHeader: Endpoint<
    "GET",
    BlockArgs,
    {params: {block_id: string}},
    BlockHeaderResponse,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get block headers
   * Retrieves block headers matching given query. By default it will fetch current head slot blocks.
   */
  getBlockHeaders: Endpoint<
    "GET",
    {slot?: Slot; parentRoot?: string},
    {query: {slot?: number; parent_root?: string}},
    BlockHeaderResponse[],
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get block root
   * Retrieves hashTreeRoot of BeaconBlock/BeaconBlockHeader
   */
  getBlockRoot: Endpoint<
    "GET",
    BlockArgs,
    {params: {block_id: string}},
    RootResponse,
    ExecutionOptimisticAndFinalizedMeta
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
   * Returns if the block was validated successfully and has been broadcast. It has also been integrated into the beacon node's database.
   */
  publishBlock: Endpoint<
    "POST",
    {signedBlockOrContents: SignedBeaconBlockOrContents},
    {body: unknown; headers: {[MetaHeader.Version]: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  publishBlockV2: Endpoint<
    "POST",
    {
      signedBlockOrContents: SignedBeaconBlockOrContents;
      broadcastValidation?: BroadcastValidation;
    },
    {body: unknown; headers: {[MetaHeader.Version]: string}; query: {broadcast_validation?: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Publish a signed blinded block by submitting it to the mev relay and patching in the block
   * transactions beacon node gets in response.
   */
  publishBlindedBlock: Endpoint<
    "POST",
    {signedBlindedBlock: SignedBlindedBeaconBlock},
    {body: unknown; headers: {[MetaHeader.Version]: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  publishBlindedBlockV2: Endpoint<
    "POST",
    {
      signedBlindedBlock: SignedBlindedBeaconBlock;
      broadcastValidation?: BroadcastValidation;
    },
    {body: unknown; headers: {[MetaHeader.Version]: string}; query: {broadcast_validation?: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Get block BlobSidecar
   * Retrieves BlobSidecar included in requested block.
   */
  getBlobSidecars: Endpoint<
    "GET",
    BlockArgs & {
      /**
       * Array of indices for blob sidecars to request for in the specified block.
       * Returns all blob sidecars in the block if not specified.
       */
      indices?: number[];
    },
    {params: {block_id: string}; query: {indices?: number[]}},
    deneb.BlobSidecars,
    ExecutionOptimisticFinalizedAndVersionMeta
  >;
};

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
const blockIdOnlyReq: RequestCodec<Endpoint<"GET", {blockId: BlockId}, {params: {block_id: string}}, any, any>> = {
  writeReq: ({blockId}) => ({params: {block_id: blockId.toString()}}),
  parseReq: ({params}) => ({blockId: params.block_id}),
  schema: {params: {block_id: Schema.StringRequired}},
};

export function getDefinitions(config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getBlockV2: {
      url: "/eth/v2/beacon/blocks/{block_id}",
      method: "GET",
      req: blockIdOnlyReq,
      resp: {
        data: WithVersion((fork) => ssz[fork].SignedBeaconBlock),
        meta: ExecutionOptimisticFinalizedAndVersionCodec,
      },
    },
    getBlindedBlock: {
      url: "/eth/v1/beacon/blinded_blocks/{block_id}",
      method: "GET",
      req: blockIdOnlyReq,
      resp: {
        data: WithVersion((fork) =>
          isForkExecution(fork) ? ssz[fork].SignedBlindedBeaconBlock : ssz[fork].SignedBeaconBlock
        ),
        meta: ExecutionOptimisticFinalizedAndVersionCodec,
      },
    },
    getBlockAttestations: {
      url: "/eth/v1/beacon/blocks/{block_id}/attestations",
      method: "GET",
      req: blockIdOnlyReq,
      resp: {
        data: ssz.phase0.BeaconBlockBody.fields.attestations,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getBlockAttestationsV2: {
      url: "/eth/v2/beacon/blocks/{block_id}/attestations",
      method: "GET",
      req: blockIdOnlyReq,
      resp: {
        data: WithVersion((fork) => ssz[fork].BeaconBlockBody.fields.attestations),
        meta: ExecutionOptimisticFinalizedAndVersionCodec,
      },
    },
    getBlockHeader: {
      url: "/eth/v1/beacon/headers/{block_id}",
      method: "GET",
      req: blockIdOnlyReq,
      resp: {
        data: BlockHeaderResponseType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getBlockHeaders: {
      url: "/eth/v1/beacon/headers",
      method: "GET",
      req: {
        writeReq: ({slot, parentRoot}) => ({query: {slot, parent_root: parentRoot}}),
        parseReq: ({query}) => ({slot: query.slot, parentRoot: query.parent_root}),
        schema: {query: {slot: Schema.Uint, parent_root: Schema.String}},
      },
      resp: {
        data: BlockHeadersResponseType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getBlockRoot: {
      url: "/eth/v1/beacon/blocks/{block_id}/root",
      method: "GET",
      req: blockIdOnlyReq,
      resp: {
        data: RootResponseType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    publishBlock: {
      url: "/eth/v1/beacon/blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlockOrContents}) => {
          const slot = isSignedBlockContents(signedBlockOrContents)
            ? signedBlockOrContents.signedBlock.message.slot
            : signedBlockOrContents.message.slot;
          const fork = config.getForkName(slot);

          return {
            body: isForkBlobs(fork)
              ? sszTypesFor(fork).SignedBlockContents.toJson(signedBlockOrContents as SignedBlockContents)
              : sszTypesFor(fork).SignedBeaconBlock.toJson(signedBlockOrContents as SignedBeaconBlock),
            headers: {
              [MetaHeader.Version]: config.getForkName(slot),
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          let forkName: ForkName;
          // As per spec, version header is optional for JSON requests
          const versionHeader = fromHeaders(headers, MetaHeader.Version, false);
          if (versionHeader !== undefined) {
            forkName = toForkName(versionHeader);
          } else {
            // Determine fork from slot in JSON payload
            forkName = config.getForkName(
              (body as {signed_block: unknown}).signed_block !== undefined
                ? (body as {signed_block: SignedBeaconBlock}).signed_block.message.slot
                : (body as SignedBeaconBlock).message.slot
            );
          }
          return {
            signedBlockOrContents: isForkBlobs(forkName)
              ? sszTypesFor(forkName).SignedBlockContents.fromJson(body)
              : ssz[forkName].SignedBeaconBlock.fromJson(body),
          };
        },
        writeReqSsz: ({signedBlockOrContents}) => {
          const slot = isSignedBlockContents(signedBlockOrContents)
            ? signedBlockOrContents.signedBlock.message.slot
            : signedBlockOrContents.message.slot;
          const fork = config.getForkName(slot);

          return {
            body: isForkBlobs(fork)
              ? sszTypesFor(fork).SignedBlockContents.serialize(signedBlockOrContents as SignedBlockContents)
              : sszTypesFor(fork).SignedBeaconBlock.serialize(signedBlockOrContents as SignedBeaconBlock),
            headers: {
              [MetaHeader.Version]: config.getForkName(slot),
            },
          };
        },
        parseReqSsz: ({body, headers}) => {
          const forkName = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlockOrContents: isForkBlobs(forkName)
              ? sszTypesFor(forkName).SignedBlockContents.deserialize(body)
              : ssz[forkName].SignedBeaconBlock.deserialize(body),
          };
        },
        schema: {
          body: Schema.Object,
          headers: {[MetaHeader.Version]: Schema.String},
        },
      },
      resp: EmptyResponseCodec,
      init: {
        requestWireFormat: WireFormat.ssz,
      },
    },
    publishBlockV2: {
      url: "/eth/v2/beacon/blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlockOrContents, broadcastValidation}) => {
          const slot = isSignedBlockContents(signedBlockOrContents)
            ? signedBlockOrContents.signedBlock.message.slot
            : signedBlockOrContents.message.slot;
          const fork = config.getForkName(slot);
          return {
            body: isForkBlobs(fork)
              ? sszTypesFor(fork).SignedBlockContents.toJson(signedBlockOrContents as SignedBlockContents)
              : sszTypesFor(fork).SignedBeaconBlock.toJson(signedBlockOrContents as SignedBeaconBlock),
            headers: {
              [MetaHeader.Version]: fork,
            },
            query: {broadcast_validation: broadcastValidation},
          };
        },
        parseReqJson: ({body, headers, query}) => {
          const forkName = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlockOrContents: isForkBlobs(forkName)
              ? sszTypesFor(forkName).SignedBlockContents.fromJson(body)
              : ssz[forkName].SignedBeaconBlock.fromJson(body),
            broadcastValidation: query.broadcast_validation as BroadcastValidation,
          };
        },
        writeReqSsz: ({signedBlockOrContents, broadcastValidation}) => {
          const slot = isSignedBlockContents(signedBlockOrContents)
            ? signedBlockOrContents.signedBlock.message.slot
            : signedBlockOrContents.message.slot;
          const fork = config.getForkName(slot);

          return {
            body: isForkBlobs(fork)
              ? sszTypesFor(fork).SignedBlockContents.serialize(signedBlockOrContents as SignedBlockContents)
              : sszTypesFor(fork).SignedBeaconBlock.serialize(signedBlockOrContents as SignedBeaconBlock),
            headers: {
              [MetaHeader.Version]: fork,
            },
            query: {broadcast_validation: broadcastValidation},
          };
        },
        parseReqSsz: ({body, headers, query}) => {
          const forkName = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlockOrContents: isForkBlobs(forkName)
              ? sszTypesFor(forkName).SignedBlockContents.deserialize(body)
              : ssz[forkName].SignedBeaconBlock.deserialize(body),
            broadcastValidation: query.broadcast_validation as BroadcastValidation,
          };
        },
        schema: {
          body: Schema.Object,
          query: {broadcast_validation: Schema.String},
          headers: {[MetaHeader.Version]: Schema.String},
        },
      },
      resp: EmptyResponseCodec,
      init: {
        requestWireFormat: WireFormat.ssz,
      },
    },
    publishBlindedBlock: {
      url: "/eth/v1/beacon/blinded_blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlindedBlock}) => {
          const fork = config.getForkName(signedBlindedBlock.message.slot);
          return {
            body: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.toJson(signedBlindedBlock),
            headers: {
              [MetaHeader.Version]: fork,
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          let fork: ForkName;
          // As per spec, version header is optional for JSON requests
          const versionHeader = fromHeaders(headers, MetaHeader.Version, false);
          if (versionHeader !== undefined) {
            fork = toForkName(versionHeader);
          } else {
            // Determine fork from slot in JSON payload
            fork = config.getForkName((body as SignedBlindedBeaconBlock).message.slot);
          }

          return {
            signedBlindedBlock: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.fromJson(body),
          };
        },
        writeReqSsz: ({signedBlindedBlock}) => {
          const fork = config.getForkName(signedBlindedBlock.message.slot);
          return {
            body: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.serialize(signedBlindedBlock),
            headers: {
              [MetaHeader.Version]: fork,
            },
          };
        },
        parseReqSsz: ({body, headers}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlindedBlock: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.deserialize(body),
          };
        },
        schema: {
          body: Schema.Object,
          headers: {[MetaHeader.Version]: Schema.String},
        },
      },
      resp: EmptyResponseCodec,
      init: {
        requestWireFormat: WireFormat.ssz,
      },
    },
    publishBlindedBlockV2: {
      url: "/eth/v2/beacon/blinded_blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlindedBlock, broadcastValidation}) => {
          const fork = config.getForkName(signedBlindedBlock.message.slot);
          return {
            body: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.toJson(signedBlindedBlock),

            headers: {
              [MetaHeader.Version]: fork,
            },
            query: {broadcast_validation: broadcastValidation},
          };
        },
        parseReqJson: ({body, headers, query}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlindedBlock: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.fromJson(body),
            broadcastValidation: query.broadcast_validation as BroadcastValidation,
          };
        },
        writeReqSsz: ({signedBlindedBlock, broadcastValidation}) => {
          const fork = config.getForkName(signedBlindedBlock.message.slot);
          return {
            body: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.serialize(signedBlindedBlock),
            headers: {
              [MetaHeader.Version]: fork,
            },
            query: {broadcast_validation: broadcastValidation},
          };
        },
        parseReqSsz: ({body, headers, query}) => {
          const fork = toForkName(fromHeaders(headers, MetaHeader.Version));
          return {
            signedBlindedBlock: getExecutionForkTypes(fork).SignedBlindedBeaconBlock.deserialize(body),
            broadcastValidation: query.broadcast_validation as BroadcastValidation,
          };
        },
        schema: {
          body: Schema.Object,
          query: {broadcast_validation: Schema.String},
          headers: {[MetaHeader.Version]: Schema.String},
        },
      },
      resp: EmptyResponseCodec,
      init: {
        requestWireFormat: WireFormat.ssz,
      },
    },
    getBlobSidecars: {
      url: "/eth/v1/beacon/blob_sidecars/{block_id}",
      method: "GET",
      req: {
        writeReq: ({blockId, indices}) => ({params: {block_id: blockId.toString()}, query: {indices}}),
        parseReq: ({params, query}) => ({blockId: params.block_id, indices: query.indices}),
        schema: {params: {block_id: Schema.StringRequired}, query: {indices: Schema.UintArray}},
      },
      resp: {
        data: ssz.deneb.BlobSidecars,
        meta: ExecutionOptimisticFinalizedAndVersionCodec,
      },
    },
  };
}
