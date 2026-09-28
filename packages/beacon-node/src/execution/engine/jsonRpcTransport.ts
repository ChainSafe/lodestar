import {ForkName, ForkSeq} from "@lodestar/params";
import {ExecutionPayload, ExecutionRequests, Root, RootHex} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {BlobAndProofV2} from "@lodestar/types/fulu";
import {strip0xPrefix} from "@lodestar/utils";
import {ClientCode, ClientVersion, PayloadAttributes, PayloadId, VersionedHashes} from "./interface.js";
import {IJsonRpcHttpClient, JsonRpcHttpClientEventEmitter, ReqOpts} from "./jsonRpcHttpClient.js";
import {ForkchoiceUpdatedResult, GetPayloadResult, IEngineTransport, PayloadStatusResult} from "./transport.js";
import {
  BLOB_AND_PROOF_V2_RPC_BYTES,
  EngineApiRpcParamTypes,
  EngineApiRpcReturnTypes,
  ExecutionPayloadBody,
  ExecutionPayloadBodyV2,
  assertReqSizeLimit,
  deserializeBlobAndProofs,
  deserializeBlobAndProofsV2,
  deserializeBlobAndProofsV2IntoBytes,
  deserializeExecutionPayloadBody,
  deserializeExecutionPayloadBodyV2,
  parseExecutionPayload,
  serializeBeaconBlockRoot,
  serializeExecutionPayload,
  serializeExecutionRequests,
  serializePayloadAttributes,
  serializeVersionedHashes,
} from "./types.js";
import {bytesToData, numToQuantity} from "./utils.js";

/**
 * Maximum number of version hashes that can be sent in a getBlobs request
 * Clients must support at least 128 versionedHashes, so we avoid sending more
 * https://github.com/ethereum/execution-apis/blob/main/src/engine/cancun.md#specification-3
 */
const MAX_VERSIONED_HASHES = 128;

// Define static options once to prevent extra allocations
const notifyNewPayloadOpts: ReqOpts = {routeId: "notifyNewPayload"};
const forkchoiceUpdatedOpts: ReqOpts = {routeId: "forkchoiceUpdated"};
const getPayloadOpts: ReqOpts = {routeId: "getPayload"};
const getPayloadBodiesByHashOpts: ReqOpts = {routeId: "getPayloadBodiesByHash"};
const getPayloadBodiesByRangeOpts: ReqOpts = {routeId: "getPayloadBodiesByRange"};
const getBlobsV1Opts: ReqOpts = {routeId: "getBlobsV1"};
const getBlobsV2Opts: ReqOpts = {routeId: "getBlobsV2"};
const getClientVersionOpts: ReqOpts = {routeId: "getClientVersion"};

/**
 * Legacy `engine_*` JSON-RPC methods
 * https://github.com/ethereum/execution-apis/tree/main/src/engine
 */
export class JsonRpcEngineTransport implements IEngineTransport {
  constructor(private readonly rpc: IJsonRpcHttpClient) {}

  get emitter(): JsonRpcHttpClientEventEmitter {
    return this.rpc.emitter;
  }

  async newPayload(
    fork: ForkName,
    executionPayload: ExecutionPayload,
    versionedHashes?: VersionedHashes,
    parentBeaconBlockRoot?: Root,
    executionRequests?: ExecutionRequests
  ): Promise<PayloadStatusResult> {
    const serializedExecutionPayload = serializeExecutionPayload(fork, executionPayload);

    if (ForkSeq[fork] >= ForkSeq.deneb) {
      if (versionedHashes === undefined) {
        throw Error(`versionedHashes required in notifyNewPayload for fork=${fork}`);
      }
      if (parentBeaconBlockRoot === undefined) {
        throw Error(`parentBlockRoot required in notifyNewPayload for fork=${fork}`);
      }

      const serializedVersionedHashes = serializeVersionedHashes(versionedHashes);
      const serializedParentBeaconBlockRoot = serializeBeaconBlockRoot(parentBeaconBlockRoot);

      if (ForkSeq[fork] >= ForkSeq.electra) {
        if (executionRequests === undefined) {
          throw Error(`executionRequests required in notifyNewPayload for fork=${fork}`);
        }
        const method = ForkSeq[fork] >= ForkSeq.gloas ? "engine_newPayloadV5" : "engine_newPayloadV4";
        return this.rpc.fetchWithRetries<EngineApiRpcReturnTypes[typeof method], EngineApiRpcParamTypes[typeof method]>(
          {
            method,
            params: [
              serializedExecutionPayload,
              serializedVersionedHashes,
              serializedParentBeaconBlockRoot,
              serializeExecutionRequests(fork, executionRequests),
            ],
          },
          notifyNewPayloadOpts
        );
      }

      const method = "engine_newPayloadV3";
      return this.rpc.fetchWithRetries<EngineApiRpcReturnTypes[typeof method], EngineApiRpcParamTypes[typeof method]>(
        {method, params: [serializedExecutionPayload, serializedVersionedHashes, serializedParentBeaconBlockRoot]},
        notifyNewPayloadOpts
      );
    }

    const method = ForkSeq[fork] >= ForkSeq.capella ? "engine_newPayloadV2" : "engine_newPayloadV1";
    return this.rpc.fetchWithRetries<EngineApiRpcReturnTypes[typeof method], EngineApiRpcParamTypes[typeof method]>(
      {method, params: [serializedExecutionPayload]},
      notifyNewPayloadOpts
    );
  }

  async forkchoiceUpdated(
    fork: ForkName,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes
  ): Promise<ForkchoiceUpdatedResult> {
    const method =
      ForkSeq[fork] >= ForkSeq.gloas
        ? "engine_forkchoiceUpdatedV4"
        : ForkSeq[fork] >= ForkSeq.deneb
          ? "engine_forkchoiceUpdatedV3"
          : ForkSeq[fork] >= ForkSeq.capella
            ? "engine_forkchoiceUpdatedV2"
            : "engine_forkchoiceUpdatedV1";
    const payloadAttributesRpc = payloadAttributes ? serializePayloadAttributes(payloadAttributes) : undefined;
    // If we are just fcUing and not asking execution for payload, retry is not required
    // and we can move on, as the next fcU will be issued soon on the new slot
    const fcUReqOpts = payloadAttributes !== undefined ? forkchoiceUpdatedOpts : {...forkchoiceUpdatedOpts, retries: 0};

    const {payloadStatus, payloadId} = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({method, params: [{headBlockHash, safeBlockHash, finalizedBlockHash}, payloadAttributesRpc]}, fcUReqOpts);

    return {payloadStatus, payloadId: payloadId && payloadId !== "0x" ? payloadId : null};
  }

  async getPayload(fork: ForkName, payloadId: PayloadId): Promise<GetPayloadResult> {
    let method: keyof EngineApiRpcReturnTypes;
    switch (fork) {
      case ForkName.phase0:
      case ForkName.altair:
      case ForkName.bellatrix:
        method = "engine_getPayloadV1";
        break;
      case ForkName.capella:
        method = "engine_getPayloadV2";
        break;
      case ForkName.deneb:
        method = "engine_getPayloadV3";
        break;
      case ForkName.electra:
        method = "engine_getPayloadV4";
        break;
      case ForkName.fulu:
        method = "engine_getPayloadV5";
        break;
      default:
        method = "engine_getPayloadV6";
        break;
    }
    const payloadResponse = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({method, params: [payloadId]}, getPayloadOpts);
    return parseExecutionPayload(fork, payloadResponse);
  }

  async getPayloadBodiesByHash(_fork: ForkName, blockHashes: RootHex[]): Promise<(ExecutionPayloadBody | null)[]> {
    const method = "engine_getPayloadBodiesByHashV1";
    assertReqSizeLimit(blockHashes.length, 32);
    const response = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({method, params: [blockHashes]}, getPayloadBodiesByHashOpts);
    return response.map(deserializeExecutionPayloadBody);
  }

  async getPayloadBodiesByHashV2(blockHashes: RootHex[]): Promise<(ExecutionPayloadBodyV2 | null)[]> {
    const method = "engine_getPayloadBodiesByHashV2";
    assertReqSizeLimit(blockHashes.length, 32);
    const response = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({method, params: [blockHashes]}, getPayloadBodiesByHashOpts);
    return response.map(deserializeExecutionPayloadBodyV2);
  }

  async getPayloadBodiesByRange(
    _fork: ForkName,
    startBlockNumber: number,
    blockCount: number
  ): Promise<(ExecutionPayloadBody | null)[]> {
    const method = "engine_getPayloadBodiesByRangeV1";
    assertReqSizeLimit(blockCount, 32);
    const start = numToQuantity(startBlockNumber);
    const count = numToQuantity(blockCount);
    const response = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({method, params: [start, count]}, getPayloadBodiesByRangeOpts);
    return response.map(deserializeExecutionPayloadBody);
  }

  async getBlobsV1(versionedHashes: VersionedHashes): Promise<(BlobAndProof | null)[]> {
    assertReqSizeLimit(versionedHashes.length, MAX_VERSIONED_HASHES);
    const versionedHashesHex = versionedHashes.map(bytesToData);
    const response = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes["engine_getBlobsV1"],
      EngineApiRpcParamTypes["engine_getBlobsV1"]
    >({method: "engine_getBlobsV1", params: [versionedHashesHex]}, getBlobsV1Opts);

    if (response.length !== versionedHashesHex.length) {
      throw Error(
        `Invalid engine_getBlobsV1 response length=${response.length} versionedHashes=${versionedHashesHex.length}`
      );
    }

    return response.map(deserializeBlobAndProofs);
  }

  async getBlobsV2(versionedHashes: VersionedHashes, buffers?: Uint8Array[]): Promise<BlobAndProofV2[] | null> {
    assertReqSizeLimit(versionedHashes.length, MAX_VERSIONED_HASHES);
    const versionedHashesHex = versionedHashes.map(bytesToData);
    if (buffers) {
      // Callers preallocate one buffer per max blobs of the epoch, only the first entries are used
      if (buffers.length < versionedHashesHex.length) {
        throw Error(`Not enough buffers length=${buffers.length} versionedHashes=${versionedHashesHex.length}`);
      }

      for (const [i, buffer] of buffers.entries()) {
        if (buffer.length !== BLOB_AND_PROOF_V2_RPC_BYTES) {
          throw Error(`Invalid buffer[${i}] length=${buffer.length} expected=${BLOB_AND_PROOF_V2_RPC_BYTES}`);
        }
      }
    }

    const response = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes["engine_getBlobsV2"],
      EngineApiRpcParamTypes["engine_getBlobsV2"]
    >({method: "engine_getBlobsV2", params: [versionedHashesHex]}, getBlobsV2Opts);

    // engine_getBlobsV2 does not return partial responses. It returns null if any blob is not found
    if (response == null) {
      return null;
    }

    if (response.length !== versionedHashesHex.length) {
      throw Error(
        `Invalid engine_getBlobsV2 response length=${response.length} versionedHashes=${versionedHashesHex.length}`
      );
    }

    if (buffers) {
      // getBlobsV2() is designed to called once per slot so we expect to have buffers
      return response.map((data, i) => deserializeBlobAndProofsV2IntoBytes(data, buffers[i]));
    }

    return response.map(deserializeBlobAndProofsV2);
  }

  async getClientVersion(clientVersion: ClientVersion): Promise<ClientVersion[]> {
    const method = "engine_getClientVersionV1";

    const response = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({method, params: [{...clientVersion, commit: `0x${clientVersion.commit}`}]}, getClientVersionOpts);

    return response.map((cv) => {
      const code = cv.code in ClientCode ? ClientCode[cv.code as keyof typeof ClientCode] : ClientCode.XX;
      return {code, name: cv.name, version: cv.version, commit: strip0xPrefix(cv.commit)};
    });
  }
}
