import {CELLS_PER_EXT_BLOB, ForkName, ForkSeq, isForkPostBellatrix} from "@lodestar/params";
import {ExecutionPayload, ExecutionRequests, Root, RootHex, capella, deneb, electra, gloas} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {BlobAndProofV2} from "@lodestar/types/fulu";
import {LodestarError, fromHex, strip0xPrefix, toHex, toRootHex} from "@lodestar/utils";
import {
  ClientCode,
  ClientVersion,
  ExecutionPayloadStatus,
  PayloadAttributes,
  PayloadId,
  VersionedHashes,
} from "./interface.js";
import {JsonRpcHttpClientEventEmitter, ReqOpts} from "./jsonRpcHttpClient.js";
import {EngineRestHttpClient, EngineRestResponseError} from "./restHttpClient.js";
import {
  BlobsRequest,
  BlobsV1Response,
  BlobsV2Response,
  BodiesByHashRequest,
  BodiesResponseBellatrix,
  BodiesResponseCapella,
  BodiesResponseGloas,
  BuiltPayloadBellatrix,
  BuiltPayloadCapella,
  BuiltPayloadDeneb,
  BuiltPayloadElectra,
  BuiltPayloadFulu,
  BuiltPayloadGloas,
  ExecutionForkName,
  ExecutionPayloadEnvelopeBellatrix,
  ExecutionPayloadEnvelopeCapella,
  ExecutionPayloadEnvelopeDeneb,
  ExecutionPayloadEnvelopeElectra,
  ExecutionPayloadEnvelopeGloas,
  ForkchoiceUpdateBellatrix,
  ForkchoiceUpdateCapella,
  ForkchoiceUpdateDeneb,
  ForkchoiceUpdateGloas,
  ForkchoiceUpdateResponse,
  MAX_BLOBS_REQUEST,
  MAX_BODIES_REQUEST,
  PayloadStatus,
  PayloadStatusCode,
  PayloadStatusSsz,
  executionForkName,
} from "./sszTypes.js";
import {ForkchoiceUpdatedResult, GetPayloadResult, IEngineTransport, PayloadStatusResult} from "./transport.js";
import {
  ExecutionPayloadBodyV2,
  assertReqSizeLimit,
  deserializeExecutionRequestsFromBytes,
  serializeExecutionRequestsToBytes,
} from "./types.js";

export type EngineCapabilities = {
  supportedForks: Set<string>;
  blobsRevisions: Set<string>;
  limits: {bodiesMaxCount: number; blobsMaxVersionedHashes: number; payloadMaxBytes: number};
};

const DEFAULT_LIMITS: EngineCapabilities["limits"] = {
  bodiesMaxCount: MAX_BODIES_REQUEST,
  blobsMaxVersionedHashes: MAX_BLOBS_REQUEST,
  payloadMaxBytes: 2 ** 26,
};

/** Payload ids are opaque `Bytes8` tokens, hex encoded in the `GET /payloads/{payloadId}` path */
const PAYLOAD_ID_REGEX = /^0x[0-9a-fA-F]{16}$/;

const textDecoder = new TextDecoder();

// Same route ids as the JSON-RPC transport so client metrics stay comparable across transports
const notifyNewPayloadOpts: ReqOpts = {routeId: "notifyNewPayload"};
const forkchoiceUpdatedOpts: ReqOpts = {routeId: "forkchoiceUpdated"};
const getPayloadOpts: ReqOpts = {routeId: "getPayload"};
const getPayloadBodiesByHashOpts: ReqOpts = {routeId: "getPayloadBodiesByHash"};
const getBlobsV1Opts: ReqOpts = {routeId: "getBlobsV1"};
const getBlobsV2Opts: ReqOpts = {routeId: "getBlobsV2"};
const getClientVersionOpts: ReqOpts = {routeId: "getClientVersion"};
const getCapabilitiesOpts: ReqOpts = {routeId: "getCapabilities", retries: 0};

export function toExecutionForkName(fork: ForkName): ExecutionForkName {
  const name = isForkPostBellatrix(fork) ? executionForkName[fork] : null;
  if (name === null) {
    throw Error(`No execution fork name for fork=${fork}`);
  }
  return name;
}

/** The header format is not pinned by the spec, the JSON `ClientVersionV1` shape is what ELs parse today */
export function formatClientVersionHeader(clientVersion: ClientVersion): string {
  return JSON.stringify({...clientVersion, commit: `0x${clientVersion.commit}`});
}

/**
 * REST engine API with SSZ encoded bodies
 * https://github.com/ethereum/execution-apis/blob/main/src/engine/refactor.md
 */
export class RestEngineTransport implements IEngineTransport {
  private limits = DEFAULT_LIMITS;

  constructor(private readonly client: EngineRestHttpClient) {}

  get emitter(): JsonRpcHttpClientEventEmitter {
    return this.client.emitter;
  }

  /** Does not emit client events, a missing REST API must not be mistaken for an unhealthy engine */
  async getCapabilities(): Promise<EngineCapabilities> {
    const {body} = await this.client.requestWithRetries(
      {method: "GET", path: "/capabilities", responseType: "json"},
      getCapabilitiesOpts
    );
    const capabilities = parseJson(body, "getCapabilities");
    if (
      !isRecord(capabilities) ||
      !Array.isArray(capabilities.supported_forks) ||
      !capabilities.supported_forks.every(isString)
    ) {
      throw new EngineRestResponseError("getCapabilities", "supported_forks must be an array of strings");
    }
    const versioned = capabilities.independently_versioned;
    if (versioned !== undefined && !isRecord(versioned)) {
      throw new EngineRestResponseError("getCapabilities", "independently_versioned must be an object");
    }
    const blobs = versioned?.blobs ?? [];
    if (!Array.isArray(blobs) || !blobs.every(isString)) {
      throw new EngineRestResponseError("getCapabilities", "blobs revisions must be an array of strings");
    }
    const advertisedLimits = capabilities.limits;
    if (advertisedLimits !== undefined && !isRecord(advertisedLimits)) {
      throw new EngineRestResponseError("getCapabilities", "limits must be an object");
    }
    const limits = {...DEFAULT_LIMITS};
    for (const [key, name] of [
      ["bodies.max_count", "bodiesMaxCount"],
      ["blobs.max_versioned_hashes", "blobsMaxVersionedHashes"],
      ["payload.max_bytes", "payloadMaxBytes"],
    ] as const) {
      const value = advertisedLimits?.[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new EngineRestResponseError("getCapabilities", `${key} must be a positive integer`);
      }
      limits[name] = Math.min(value, DEFAULT_LIMITS[name]);
    }
    this.limits = limits;
    return {
      supportedForks: new Set(capabilities.supported_forks.map((fork) => fork.toLowerCase())),
      blobsRevisions: new Set(blobs.map((rev) => rev.toLowerCase())),
      limits,
    };
  }

  async newPayload(
    fork: ForkName,
    executionPayload: ExecutionPayload,
    _versionedHashes?: VersionedHashes,
    parentBeaconBlockRoot?: Root,
    executionRequests?: ExecutionRequests
  ): Promise<PayloadStatusResult> {
    let body: Uint8Array;
    if (ForkSeq[fork] >= ForkSeq.deneb) {
      if (parentBeaconBlockRoot === undefined) {
        throw Error(`parentBlockRoot required in notifyNewPayload for fork=${fork}`);
      }

      if (ForkSeq[fork] >= ForkSeq.electra) {
        if (executionRequests === undefined) {
          throw Error(`executionRequests required in notifyNewPayload for fork=${fork}`);
        }
        const requests = serializeExecutionRequestsToBytes(fork, executionRequests);
        body =
          ForkSeq[fork] >= ForkSeq.gloas
            ? ExecutionPayloadEnvelopeGloas.serialize({
                payload: executionPayload as gloas.ExecutionPayload,
                parentBeaconBlockRoot,
                executionRequests: requests,
              })
            : ExecutionPayloadEnvelopeElectra.serialize({
                payload: executionPayload as electra.ExecutionPayload,
                parentBeaconBlockRoot,
                executionRequests: requests,
              });
      } else {
        body = ExecutionPayloadEnvelopeDeneb.serialize({
          payload: executionPayload as deneb.ExecutionPayload,
          parentBeaconBlockRoot,
        });
      }
    } else if (ForkSeq[fork] >= ForkSeq.capella) {
      body = ExecutionPayloadEnvelopeCapella.serialize({payload: executionPayload as capella.ExecutionPayload});
    } else {
      body = ExecutionPayloadEnvelopeBellatrix.serialize({payload: executionPayload});
    }

    if (body.length > this.limits.payloadMaxBytes) {
      throw new LodestarError({
        code: "ENGINE_REST_REQUEST_TOO_LARGE",
        size: body.length,
        limit: this.limits.payloadMaxBytes,
      });
    }

    const res = await this.client.request(
      {method: "POST", path: "/payloads", executionFork: toExecutionForkName(fork), body, responseType: "ssz"},
      notifyNewPayloadOpts
    );
    return toPayloadStatusResult(PayloadStatus.deserialize(res.body));
  }

  async forkchoiceUpdated(
    fork: ForkName,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes
  ): Promise<ForkchoiceUpdatedResult> {
    const forkchoiceState = {
      headBlockHash: fromHex(headBlockHash),
      safeBlockHash: fromHex(safeBlockHash),
      finalizedBlockHash: fromHex(finalizedBlockHash),
    };

    let body: Uint8Array;
    if (ForkSeq[fork] >= ForkSeq.gloas) {
      body = ForkchoiceUpdateGloas.serialize({
        forkchoiceState,
        payloadAttributes: payloadAttributes ? [toPayloadAttributesGloas(fork, payloadAttributes)] : [],
        custodyColumns: [],
      });
    } else if (ForkSeq[fork] >= ForkSeq.deneb) {
      body = ForkchoiceUpdateDeneb.serialize({
        forkchoiceState,
        payloadAttributes: payloadAttributes ? [toPayloadAttributesDeneb(fork, payloadAttributes)] : [],
      });
    } else if (ForkSeq[fork] >= ForkSeq.capella) {
      body = ForkchoiceUpdateCapella.serialize({
        forkchoiceState,
        payloadAttributes: payloadAttributes ? [toPayloadAttributesCapella(fork, payloadAttributes)] : [],
      });
    } else {
      body = ForkchoiceUpdateBellatrix.serialize({
        forkchoiceState,
        payloadAttributes: payloadAttributes ? [toPayloadAttributesBellatrix(payloadAttributes)] : [],
      });
    }

    // If we are just fcUing and not asking execution for payload, retry is not required
    // and we can move on, as the next fcU will be issued soon on the new slot
    const fcUReqOpts = payloadAttributes !== undefined ? forkchoiceUpdatedOpts : {...forkchoiceUpdatedOpts, retries: 0};

    const res = await this.client.request(
      {method: "POST", path: "/forkchoice", executionFork: toExecutionForkName(fork), body, responseType: "ssz"},
      fcUReqOpts
    );
    const {payloadStatus, payloadId} = ForkchoiceUpdateResponse.deserialize(res.body);
    return {
      payloadStatus: toPayloadStatusResult(payloadStatus),
      payloadId: payloadId.length > 0 ? toHex(payloadId[0]) : null,
    };
  }

  async getPayload(fork: ForkName, payloadId: PayloadId): Promise<GetPayloadResult> {
    if (!PAYLOAD_ID_REGEX.test(payloadId)) {
      throw Error(`Invalid payloadId=${payloadId}, expected 0x prefixed 8 bytes hex`);
    }

    const res = await this.client.request(
      {method: "GET", path: `/payloads/${payloadId}`, executionFork: toExecutionForkName(fork), responseType: "ssz"},
      getPayloadOpts
    );

    if (ForkSeq[fork] >= ForkSeq.gloas) {
      const {payload, blockValue, blobsBundle, executionRequests, shouldOverrideBuilder} =
        BuiltPayloadGloas.deserialize(res.body);
      return {
        executionPayload: payload,
        executionPayloadValue: blockValue,
        blobsBundle,
        executionRequests: deserializeExecutionRequestsFromBytes(fork, executionRequests),
        shouldOverrideBuilder,
      };
    }
    if (ForkSeq[fork] >= ForkSeq.fulu) {
      const {payload, blockValue, blobsBundle, executionRequests, shouldOverrideBuilder} = BuiltPayloadFulu.deserialize(
        res.body
      );
      return {
        executionPayload: payload,
        executionPayloadValue: blockValue,
        blobsBundle,
        executionRequests: deserializeExecutionRequestsFromBytes(fork, executionRequests),
        shouldOverrideBuilder,
      };
    }
    if (ForkSeq[fork] >= ForkSeq.electra) {
      const {payload, blockValue, blobsBundle, executionRequests, shouldOverrideBuilder} =
        BuiltPayloadElectra.deserialize(res.body);
      return {
        executionPayload: payload,
        executionPayloadValue: blockValue,
        blobsBundle,
        executionRequests: deserializeExecutionRequestsFromBytes(fork, executionRequests),
        shouldOverrideBuilder,
      };
    }
    if (ForkSeq[fork] >= ForkSeq.deneb) {
      const {payload, blockValue, blobsBundle, shouldOverrideBuilder} = BuiltPayloadDeneb.deserialize(res.body);
      return {executionPayload: payload, executionPayloadValue: blockValue, blobsBundle, shouldOverrideBuilder};
    }
    if (ForkSeq[fork] >= ForkSeq.capella) {
      const {payload, blockValue} = BuiltPayloadCapella.deserialize(res.body);
      return {executionPayload: payload, executionPayloadValue: blockValue, shouldOverrideBuilder: false};
    }
    const {payload, blockValue} = BuiltPayloadBellatrix.deserialize(res.body);
    return {executionPayload: payload, executionPayloadValue: blockValue, shouldOverrideBuilder: false};
  }

  async getPayloadBodiesByHashV2(blockHashes: RootHex[]): Promise<(ExecutionPayloadBodyV2 | null)[]> {
    assertReqSizeLimit(blockHashes.length, this.limits.bodiesMaxCount);
    const body = BodiesByHashRequest.serialize({blockHashes: blockHashes.map((hash) => fromHex(hash))});
    const res = await this.client.request(
      {
        method: "POST",
        path: "/bodies/hash",
        executionFork: toExecutionForkName(ForkName.gloas),
        body,
        responseType: "ssz",
      },
      getPayloadBodiesByHashOpts
    );
    const bodies = deserializeBodiesResponse(ForkName.gloas, res.body);
    if (bodies.length !== blockHashes.length) {
      throw Error(`Invalid bodies response length=${bodies.length} blockHashes=${blockHashes.length}`);
    }
    return bodies;
  }

  async getBlobsV1(versionedHashes: VersionedHashes): Promise<(BlobAndProof | null)[]> {
    assertReqSizeLimit(versionedHashes.length, this.limits.blobsMaxVersionedHashes);
    const res = await this.client.request(
      {method: "POST", path: "/blobs/v1", body: BlobsRequest.serialize({versionedHashes}), responseType: "ssz"},
      getBlobsV1Opts
    );
    // 204 means the EL cannot serve blobs at all, e.g. while syncing
    if (res.status === 204) {
      return versionedHashes.map(() => null);
    }

    const {entries} = BlobsV1Response.deserialize(res.body);
    if (entries.length !== versionedHashes.length) {
      throw Error(`Invalid blobs/v1 response length=${entries.length} versionedHashes=${versionedHashes.length}`);
    }
    return entries.map((entry) => (entry.available ? entry.contents : null));
  }

  /** SSZ decoding already allocates fresh arrays, copying them into the pooled buffers would only add aliasing */
  async getBlobsV2(versionedHashes: VersionedHashes, _buffers?: Uint8Array[]): Promise<BlobAndProofV2[] | null> {
    assertReqSizeLimit(versionedHashes.length, this.limits.blobsMaxVersionedHashes);

    const res = await this.client.request(
      {method: "POST", path: "/blobs/v2", body: BlobsRequest.serialize({versionedHashes}), responseType: "ssz"},
      getBlobsV2Opts
    );
    // blobs/v2 is all-or-nothing, 204 means at least one blob is missing or the EL cannot serve blobs
    if (res.status === 204) {
      return null;
    }

    const {entries} = BlobsV2Response.deserialize(res.body);
    if (entries.length !== versionedHashes.length) {
      throw Error(`Invalid blobs/v2 response length=${entries.length} versionedHashes=${versionedHashes.length}`);
    }
    if (entries.some((entry) => !entry.available)) {
      return null;
    }

    return entries.map(({contents}) => {
      if (contents.proofs.length !== CELLS_PER_EXT_BLOB) {
        throw Error(`Invalid proofs length ${contents.proofs.length}, expected ${CELLS_PER_EXT_BLOB}`);
      }
      return contents;
    });
  }

  async getClientVersion(_clientVersion: ClientVersion): Promise<ClientVersion[]> {
    const {body} = await this.client.request(
      {method: "GET", path: "/identity", responseType: "json"},
      getClientVersionOpts
    );
    const versions = parseJson(body, "getClientVersion");
    if (!Array.isArray(versions)) {
      throw new EngineRestResponseError("getClientVersion", "Expected an array of client versions");
    }
    return versions.map((cv: unknown, i) => {
      if (
        !isRecord(cv) ||
        typeof cv.code !== "string" ||
        typeof cv.name !== "string" ||
        typeof cv.version !== "string" ||
        typeof cv.commit !== "string"
      ) {
        throw new EngineRestResponseError("getClientVersion", `Invalid client version at index ${i}`);
      }
      const code = Object.hasOwn(ClientCode, cv.code) ? ClientCode[cv.code as keyof typeof ClientCode] : ClientCode.XX;
      return {
        code,
        name: cv.name,
        version: cv.version,
        commit: strip0xPrefix(cv.commit),
      };
    });
  }
}

function toPayloadAttributesBellatrix(attributes: PayloadAttributes) {
  return {
    timestamp: attributes.timestamp,
    prevRandao: attributes.prevRandao,
    suggestedFeeRecipient: fromHex(attributes.suggestedFeeRecipient),
  };
}

function toPayloadAttributesCapella(fork: ForkName, attributes: PayloadAttributes) {
  if (attributes.withdrawals === undefined) {
    throw Error(`withdrawals required in payload attributes for fork=${fork}`);
  }
  return {...toPayloadAttributesBellatrix(attributes), withdrawals: attributes.withdrawals};
}

function toPayloadAttributesDeneb(fork: ForkName, attributes: PayloadAttributes) {
  if (attributes.parentBeaconBlockRoot === undefined) {
    throw Error(`parentBeaconBlockRoot required in payload attributes for fork=${fork}`);
  }
  return {...toPayloadAttributesCapella(fork, attributes), parentBeaconBlockRoot: attributes.parentBeaconBlockRoot};
}

function toPayloadAttributesGloas(fork: ForkName, attributes: PayloadAttributes) {
  if (attributes.slotNumber === undefined) {
    throw Error(`slotNumber required in payload attributes for fork=${fork}`);
  }
  if (attributes.targetGasLimit === undefined) {
    throw Error(`targetGasLimit required in payload attributes for fork=${fork}`);
  }
  return {
    ...toPayloadAttributesDeneb(fork, attributes),
    slotNumber: attributes.slotNumber,
    targetGasLimit: attributes.targetGasLimit,
  };
}

function toPayloadStatusResult(payloadStatus: PayloadStatusSsz): PayloadStatusResult {
  const latestValidHash = payloadStatus.latestValidHash.length > 0 ? toRootHex(payloadStatus.latestValidHash[0]) : null;
  const validationError =
    payloadStatus.validationError.length > 0 ? textDecoder.decode(payloadStatus.validationError[0]) : null;

  switch (payloadStatus.status) {
    case PayloadStatusCode.VALID:
      return {status: ExecutionPayloadStatus.VALID, latestValidHash, validationError};
    case PayloadStatusCode.INVALID:
      return {status: ExecutionPayloadStatus.INVALID, latestValidHash, validationError};
    case PayloadStatusCode.SYNCING:
      return {status: ExecutionPayloadStatus.SYNCING, latestValidHash, validationError};
    case PayloadStatusCode.ACCEPTED:
      return {status: ExecutionPayloadStatus.ACCEPTED, latestValidHash, validationError};
    default:
      return {
        status: ExecutionPayloadStatus.ELERROR,
        latestValidHash: null,
        validationError: `Unknown payload status code ${payloadStatus.status}`,
      };
  }
}

function deserializeBodiesResponse(fork: ForkName, data: Uint8Array): (ExecutionPayloadBodyV2 | null)[] {
  if (ForkSeq[fork] >= ForkSeq.gloas) {
    return BodiesResponseGloas.deserialize(data).entries.map((entry) => (entry.available ? entry.body : null));
  }
  if (ForkSeq[fork] >= ForkSeq.capella) {
    return BodiesResponseCapella.deserialize(data).entries.map((entry) =>
      entry.available ? {...entry.body, blockAccessList: null} : null
    );
  }
  return BodiesResponseBellatrix.deserialize(data).entries.map((entry) =>
    entry.available ? {transactions: entry.body.transactions, withdrawals: null, blockAccessList: null} : null
  );
}

function parseJson(body: Uint8Array, routeId: string): unknown {
  try {
    return JSON.parse(textDecoder.decode(body));
  } catch (e) {
    throw new EngineRestResponseError(routeId, `Invalid JSON: ${(e as Error).message}`);
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
