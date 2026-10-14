import {BitArray} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {BlobsBundle, ExecutionPayload, ExecutionRequests, Root, RootHex, Wei} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {BlobAndProofV2} from "@lodestar/types/fulu";
import {ClientVersion, ExecutionPayloadStatus, PayloadAttributes, PayloadId, VersionedHashes} from "./interface.js";
import {JsonRpcHttpClientEventEmitter, ReqOpts} from "./jsonRpcHttpClient.js";
import {ExecutionPayloadBodyV2} from "./types.js";

export type PayloadStatusResult = {
  status: ExecutionPayloadStatus;
  latestValidHash: RootHex | null;
  validationError: string | null;
};

export type ForkchoiceUpdatedResult = {
  payloadStatus: PayloadStatusResult;
  payloadId: PayloadId | null;
};

export type GetPayloadResult = {
  executionPayload: ExecutionPayload;
  executionPayloadValue: Wei;
  blobsBundle?: BlobsBundle;
  executionRequests?: ExecutionRequests;
  shouldOverrideBuilder?: boolean;
};

/**
 * Wire-level access to the engine API of the execution client. Implementations only translate
 * between Lodestar types and the encoding of their transport, `ExecutionEngineHttp` owns request
 * ordering, engine state and result interpretation.
 */
export interface IEngineTransport {
  readonly emitter: JsonRpcHttpClientEventEmitter;

  newPayload(
    fork: ForkName,
    executionPayload: ExecutionPayload,
    versionedHashes?: VersionedHashes,
    parentBeaconBlockRoot?: Root,
    executionRequests?: ExecutionRequests
  ): Promise<PayloadStatusResult>;

  forkchoiceUpdated(
    fork: ForkName,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes,
    custodyColumns?: BitArray | null,
    opts?: ReqOpts
  ): Promise<ForkchoiceUpdatedResult>;

  getPayload(fork: ForkName, payloadId: PayloadId, opts?: ReqOpts): Promise<GetPayloadResult>;

  getPayloadBodiesByHashV2(blockHashes: RootHex[]): Promise<(ExecutionPayloadBodyV2 | null)[]>;

  getBlobsV1(versionedHashes: VersionedHashes): Promise<(BlobAndProof | null)[]>;

  getBlobsV2(versionedHashes: VersionedHashes, buffers?: Uint8Array[]): Promise<BlobAndProofV2[] | null>;

  getClientVersion(clientVersion: ClientVersion): Promise<ClientVersion[]>;
}
