import {BitArray} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {
  BlobsBundle,
  ColumnIndex,
  ExecutionPayload,
  ExecutionRequests,
  Root,
  RootHex,
  Wei,
  bellatrix,
} from "@lodestar/types";
import {BlobAndProofV2} from "@lodestar/types/fulu";
import {
  BlobCellsAndProofs,
  ClientVersion,
  ForkchoiceUpdatedResult,
  PayloadAttributes,
  PayloadId,
  PayloadStatusResult,
  VersionedHashes,
} from "./interface.js";
import {JsonRpcHttpClientEventEmitter} from "./jsonRpcHttpClient.js";
import {ExecutionPayloadBodyV2} from "./types.js";

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
    executionRequests?: ExecutionRequests,
    inclusionListTransactions?: bellatrix.Transactions
  ): Promise<PayloadStatusResult>;

  forkchoiceUpdated(
    fork: ForkName,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes,
    custodyColumns?: BitArray
  ): Promise<ForkchoiceUpdatedResult>;

  getPayload(fork: ForkName, payloadId: PayloadId): Promise<GetPayloadResult>;

  getPayloadBodiesByHashV2(blockHashes: RootHex[]): Promise<(ExecutionPayloadBodyV2 | null)[]>;

  getBlobsV2(versionedHashes: VersionedHashes, buffers?: Uint8Array[]): Promise<BlobAndProofV2[] | null>;

  getBlobsV4(versionedHashes: VersionedHashes, columns: ColumnIndex[]): Promise<(BlobCellsAndProofs | null)[] | null>;

  exchangeCapabilities(methods: string[]): Promise<string[]>;

  getClientVersion(clientVersion: ClientVersion): Promise<ClientVersion[]>;

  getInclusionList(): Promise<bellatrix.Transactions>;
}
