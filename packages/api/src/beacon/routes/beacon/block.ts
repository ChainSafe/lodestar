/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ListCompositeType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {allForks, Slot, ssz, RootHex, deneb, phase0, isSignedBlockContents} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {Endpoint, RequestCodec, RouteDefinitions, Schema} from "../../../utils/index.js";
import {
  EmptyMeta,
  EmptyMetaCodec,
  EmptyResponseCodec,
  EmptyResponseData,
  ExecutionOptimisticAndFinalizedCodec,
  ExecutionOptimisticAndFinalizedMeta,
  ExecutionOptimisticFinalizedAndVersionCodec,
  ExecutionOptimisticFinalizedAndVersionMeta,
  WithVersion,
} from "../../../utils/codecs.js";
import {toForkName} from "../../../utils/serdes.js";
import {fromRequestHeaders} from "../../../utils/headers.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

// ssz types

export const BlockHeaderResponseType = new ContainerType({
  root: ssz.Root,
  canonical: ssz.Boolean,
  header: ssz.phase0.SignedBeaconBlockHeader,
});
export const BlockHeadersResponseType = new ListCompositeType(BlockHeaderResponseType, 1000);
export const RootResponseType = new ContainerType({
  root: ssz.Root,
});
export const SignedBlockContentsType = new ContainerType(
  {
    signedBlock: ssz.deneb.SignedBeaconBlock,
    kzgProofs: ssz.deneb.KZGProofs,
    blobs: ssz.deneb.Blobs,
  },
  {jsonCase: "eth2"}
);

export type BlockHeaderResponse = ValueOf<typeof BlockHeaderResponseType>;
export type BlockHeadersResponse = ValueOf<typeof BlockHeadersResponseType>;
export type RootResponse = ValueOf<typeof RootResponseType>;
export type SignedBlockContents = ValueOf<typeof SignedBlockContentsType>;

export type BlockId = RootHex | Slot | "head" | "genesis" | "finalized" | "justified";

export enum BroadcastValidation {
  /* 
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
   * Returns the complete `SignedBeaconBlock` for a given block ID.
   *
   * param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlock: Endpoint<
    //
    "GET",
    {blockId: BlockId},
    {params: {block_id: string}},
    phase0.SignedBeaconBlock,
    EmptyMeta
  >;

  /**
   * Get block
   * Retrieves block details for given block id.
   *
   * param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockV2: Endpoint<
    "GET",
    {blockId: BlockId},
    {params: {block_id: string}},
    allForks.SignedBeaconBlock,
    ExecutionOptimisticFinalizedAndVersionMeta
  >;

  /**
   * Get block attestations
   * Retrieves attestation included in requested block.
   *
   * param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockAttestations: Endpoint<
    "GET",
    {blockId: BlockId},
    {params: {block_id: string}},
    allForks.BeaconBlockBody["attestations"],
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get block header
   * Retrieves block header for given block id.
   *
   * param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockHeader: Endpoint<
    "GET",
    {blockId: BlockId},
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
   *
   * param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockRoot: Endpoint<
    "GET",
    {blockId: BlockId},
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
   * param requestBody The `SignedBeaconBlock` object composed of `BeaconBlock` object (produced by beacon node) and validator signature.
   * returns The block was validated successfully and has been broadcast. It has also been integrated into the beacon node's database.
   */
  publishBlock: Endpoint<
    //
    "POST",
    {signedBlockOrContents: allForks.SignedBeaconBlockOrContents},
    {body: unknown; headers: {"Eth-Consensus-Version": string}},
    EmptyResponseData,
    EmptyMeta
  >;

  publishBlockV2: Endpoint<
    "POST",
    {signedBlockOrContents: allForks.SignedBeaconBlockOrContents; broadcastValidation?: BroadcastValidation},
    {body: unknown; headers: {"Eth-Consensus-Version": string}; query: {broadcast_validation?: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Publish a signed blinded block by submitting it to the mev relay and patching in the block
   * transactions beacon node gets in response.
   */
  publishBlindedBlock: Endpoint<
    "POST",
    {signedBlindedBlock: allForks.SignedBlindedBeaconBlock},
    {body: unknown; headers: {"Eth-Consensus-Version": string}},
    EmptyResponseData,
    EmptyMeta
  >;

  publishBlindedBlockV2: Endpoint<
    "POST",
    {
      signedBlindedBlock: allForks.SignedBlindedBeaconBlock;
      broadcastValidation?: BroadcastValidation;
    },
    {body: unknown; headers: {"Eth-Consensus-Version": string}; query: {broadcast_validation?: string}},
    EmptyResponseData,
    EmptyMeta
  >;

  /**
   * Get block BlobSidecar
   * Retrieves BlobSidecar included in requested block.
   *
   * param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   * indices Array of indices for blob sidecars to request for in the specified block. Returns all blob sidecars in the block if not specified.
   */
  getBlobSidecars: Endpoint<
    "GET",
    {blockId: BlockId; indices?: number[]},
    {params: {block_id: string}; query: {indices?: number[]}},
    deneb.BlobSidecars,
    ExecutionOptimisticAndFinalizedMeta
  >;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blockIdOnlyReq: RequestCodec<Endpoint<"GET", {blockId: BlockId}, {params: {block_id: string}}, any, any>> = {
  writeReq: ({blockId}) => ({params: {block_id: blockId.toString()}}),
  parseReq: ({params}) => ({blockId: params.block_id}),
  schema: {params: {block_id: Schema.StringRequired}},
};

export function getDefinitions(config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getBlock: {
      url: "/eth/v1/beacon/blocks/{block_id}",
      method: "GET",
      req: blockIdOnlyReq,
      resp: {
        data: ssz.phase0.SignedBeaconBlock,
        meta: EmptyMetaCodec,
      },
    },
    getBlockV2: {
      url: "/eth/v2/beacon/blocks/{block_id}",
      method: "GET",
      req: blockIdOnlyReq,
      resp: {
        data: WithVersion((fork) => ssz[fork].SignedBeaconBlock),
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
          return {
            body:
              config.getForkSeq(slot) < ForkSeq.deneb
                ? config
                    .getForkTypes(slot)
                    .SignedBeaconBlock.toJson(signedBlockOrContents as allForks.SignedBeaconBlock)
                : SignedBlockContentsType.toJson(signedBlockOrContents as SignedBlockContents),
            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          const forkName = toForkName(fromRequestHeaders(headers, "Eth-Consensus-Version"));
          const forkSeq = config.forks[forkName].seq;
          return {
            signedBlockOrContents:
              forkSeq < ForkSeq.deneb
                ? ssz[forkName].SignedBeaconBlock.fromJson(body)
                : SignedBlockContentsType.fromJson(body),
          };
        },
        writeReqSsz: ({signedBlockOrContents}) => {
          const slot = isSignedBlockContents(signedBlockOrContents)
            ? signedBlockOrContents.signedBlock.message.slot
            : signedBlockOrContents.message.slot;
          return {
            body:
              config.getForkSeq(slot) < ForkSeq.deneb
                ? config
                    .getForkTypes(slot)
                    .SignedBeaconBlock.serialize(signedBlockOrContents as allForks.SignedBeaconBlock)
                : SignedBlockContentsType.serialize(signedBlockOrContents as SignedBlockContents),
            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
          };
        },
        parseReqSsz: ({body, headers}) => {
          const forkName = toForkName(fromRequestHeaders(headers, "Eth-Consensus-Version"));
          const forkSeq = config.forks[forkName].seq;
          return {
            signedBlockOrContents:
              forkSeq < ForkSeq.deneb
                ? ssz[forkName].SignedBeaconBlock.deserialize(body)
                : SignedBlockContentsType.deserialize(body),
          };
        },
        schema: {
          body: Schema.Object,
          headers: {"Eth-Consensus-Version": Schema.StringRequired},
        },
      },
      resp: EmptyResponseCodec,
    },
    publishBlockV2: {
      url: "/eth/v2/beacon/blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlockOrContents, broadcastValidation}) => {
          const slot = isSignedBlockContents(signedBlockOrContents)
            ? signedBlockOrContents.signedBlock.message.slot
            : signedBlockOrContents.message.slot;
          return {
            body:
              config.getForkSeq(slot) < ForkSeq.deneb
                ? config
                    .getForkTypes(slot)
                    .SignedBeaconBlock.toJson(signedBlockOrContents as allForks.SignedBeaconBlock)
                : SignedBlockContentsType.toJson(signedBlockOrContents as SignedBlockContents),
            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
            query: {broadcast_validation: broadcastValidation},
          };
        },
        parseReqJson: ({body, headers, query}) => {
          const forkName = toForkName(fromRequestHeaders(headers, "Eth-Consensus-Version"));
          const forkSeq = config.forks[forkName].seq;
          return {
            signedBlockOrContents:
              forkSeq < ForkSeq.deneb
                ? ssz[forkName].SignedBeaconBlock.fromJson(body)
                : SignedBlockContentsType.fromJson(body),
            broadcastValidation: query.broadcast_validation as BroadcastValidation,
          };
        },
        writeReqSsz: ({signedBlockOrContents, broadcastValidation}) => {
          const slot = isSignedBlockContents(signedBlockOrContents)
            ? signedBlockOrContents.signedBlock.message.slot
            : signedBlockOrContents.message.slot;
          return {
            body:
              config.getForkSeq(slot) < ForkSeq.deneb
                ? config
                    .getForkTypes(slot)
                    .SignedBeaconBlock.serialize(signedBlockOrContents as allForks.SignedBeaconBlock)
                : SignedBlockContentsType.serialize(signedBlockOrContents as SignedBlockContents),
            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
            query: {broadcast_validation: broadcastValidation},
          };
        },
        parseReqSsz: ({body, headers, query}) => {
          const forkName = toForkName(fromRequestHeaders(headers, "Eth-Consensus-Version")); // TODO validation
          const forkSeq = config.forks[forkName].seq;
          return {
            signedBlockOrContents:
              forkSeq < ForkSeq.deneb
                ? ssz[forkName].SignedBeaconBlock.deserialize(body)
                : SignedBlockContentsType.deserialize(body),
            broadcastValidation: query.broadcast_validation as BroadcastValidation,
          };
        },
        schema: {
          body: Schema.Object,
          query: {broadcast_validation: Schema.String},
          headers: {"Eth-Consensus-Version": Schema.StringRequired},
        },
      },
      resp: EmptyResponseCodec,
    },
    publishBlindedBlock: {
      url: "/eth/v1/beacon/blinded_blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlindedBlock}) => {
          const slot = signedBlindedBlock.message.slot;
          return {
            body: config.getBlindedForkTypes(slot).SignedBeaconBlock.toJson(signedBlindedBlock),
            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
          };
        },
        parseReqJson: ({body, headers}) => {
          const forkName = toForkName(fromRequestHeaders(headers, "Eth-Consensus-Version"));
          const forkSeq = config.forks[forkName].seq;
          if (forkSeq < ForkSeq.bellatrix) throw new Error("TODO"); // TODO
          return {
            signedBlindedBlock: ssz[forkName as "bellatrix"].SignedBlindedBeaconBlock.fromJson(body),
          };
        },
        writeReqSsz: ({signedBlindedBlock}) => {
          const slot = signedBlindedBlock.message.slot;
          return {
            body: config.getBlindedForkTypes(slot).SignedBeaconBlock.serialize(signedBlindedBlock),
            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
          };
        },
        parseReqSsz: ({body, headers}) => {
          const forkName = toForkName(fromRequestHeaders(headers, "Eth-Consensus-Version"));
          const forkSeq = config.forks[forkName].seq;
          if (forkSeq < ForkSeq.bellatrix) throw new Error("TODO"); // TODO
          return {
            signedBlindedBlock: ssz[forkName as "bellatrix"].SignedBlindedBeaconBlock.deserialize(body),
          };
        },
        schema: {
          body: Schema.Object,
          headers: {"Eth-Consensus-Version": Schema.StringRequired},
        },
      },
      resp: EmptyResponseCodec,
    },
    publishBlindedBlockV2: {
      url: "/eth/v2/beacon/blinded_blocks",
      method: "POST",
      req: {
        writeReqJson: ({signedBlindedBlock, broadcastValidation}) => {
          const slot = signedBlindedBlock.message.slot;
          return {
            body: config.getBlindedForkTypes(slot).SignedBeaconBlock.toJson(signedBlindedBlock),

            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
            query: {broadcast_validation: broadcastValidation},
          };
        },
        parseReqJson: ({body, headers, query}) => {
          const forkName = toForkName(fromRequestHeaders(headers, "Eth-Consensus-Version"));
          const forkSeq = config.forks[forkName].seq;
          if (forkSeq < ForkSeq.bellatrix) throw new Error("TODO"); // TODO
          return {
            signedBlindedBlock: ssz[forkName as "bellatrix"].SignedBlindedBeaconBlock.fromJson(body),
            broadcastValidation: query.broadcast_validation as BroadcastValidation,
          };
        },
        writeReqSsz: ({signedBlindedBlock, broadcastValidation}) => {
          const slot = signedBlindedBlock.message.slot;
          return {
            body: config.getBlindedForkTypes(slot).SignedBeaconBlock.serialize(signedBlindedBlock),
            headers: {
              "Eth-Consensus-Version": config.getForkName(slot),
            },
            query: {broadcast_validation: broadcastValidation},
          };
        },
        parseReqSsz: ({body, headers, query}) => {
          const forkName = toForkName(fromRequestHeaders(headers, "Eth-Consensus-Version"));
          const forkSeq = config.forks[forkName].seq;
          if (forkSeq < ForkSeq.bellatrix) throw new Error("TODO"); // TODO
          return {
            signedBlindedBlock: ssz[forkName as "bellatrix"].SignedBlindedBeaconBlock.deserialize(body),
            broadcastValidation: query.broadcast_validation as BroadcastValidation,
          };
        },
        schema: {
          body: Schema.Object,
          query: {broadcast_validation: Schema.String},
          headers: {"Eth-Consensus-Version": Schema.StringRequired},
        },
      },
      resp: EmptyResponseCodec,
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
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
  };
}
