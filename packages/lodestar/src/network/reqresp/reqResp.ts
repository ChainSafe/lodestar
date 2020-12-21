/**
 * @module network
 */
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  Metadata,
  Ping,
  RequestBody,
  ResponseBody,
  SignedBeaconBlock,
  Status,
} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {AbortController} from "abort-controller";
import LibP2p from "libp2p";
import PeerId from "peer-id";
import {IReqEventEmitterClass, IReqRespModules, sendRequest} from ".";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../constants";
import {requestDecode} from "./encoders/requestDecode";
import {updateRpcScore} from "../error";
import {IReqResp, ReqRespHandler} from "../interface";
import {IPeerMetadataStore} from "../peers/interface";
import {IRpcScoreTracker, RpcScoreEvent} from "../peers/score";
import {createRpcProtocol, randomRequestId} from "../util";
import {EventEmitter} from "events";
import {responseEncodeError, responseEncodeSuccess} from "./encoders/responseEncode";

class InvalidRequestError extends Error {}

/**
 * Implementation of eth2 p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#the-reqresp-domain
 */
export class ReqResp extends (EventEmitter as IReqEventEmitterClass) implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private peerMetadata: IPeerMetadataStore;
  private blockProviderScores: IRpcScoreTracker;
  private controller: AbortController | undefined;

  private performRequestHandler: ReqRespHandler | null;

  public constructor({config, libp2p, peerMetadata, blockProviderScores, logger}: IReqRespModules) {
    super();
    this.config = config;
    this.libp2p = libp2p;
    this.peerMetadata = peerMetadata;
    this.logger = logger;
    this.blockProviderScores = blockProviderScores;

    this.performRequestHandler = null;
  }

  public async start(): Promise<void> {
    this.controller = new AbortController();
    for (const method of Object.values(Method)) {
      for (const encoding of Object.values(ReqRespEncoding)) {
        this.libp2p.handle(createRpcProtocol(method, encoding), async ({connection, stream}) => {
          // Re-declare to properly type
          const streamSource = stream.source as AsyncIterable<Buffer>;
          const streamSink = stream.sink as (source: AsyncIterable<Buffer>) => Promise<void>;

          const requestId = randomRequestId();
          const peerId = connection.remotePeer;
          this.storePeerEncodingPreference(peerId, method, encoding);

          try {
            const responseSource = this.handleRequest(streamSource, method, encoding, peerId);
            await streamSink(responseSource);
          } catch (e) {
            // In case sending the error fails
          } finally {
            // Extra cleanup? Close connection?
          }
        });
      }
    }
  }

  async *handleRequest(
    streamSource: AsyncIterable<Buffer>,
    method: Method,
    encoding: ReqRespEncoding,
    peerId: PeerId
  ): AsyncGenerator<Buffer, void, undefined> {
    try {
      const requestDecodeSink = requestDecode(this.config, method, encoding);
      const requestBody = await requestDecodeSink(streamSource).catch((e) => {
        throw new InvalidRequestError(e.message);
      });

      // This syntax allows to recycle the same streamSink to send success and error chunks
      // in case request whose body is a List fails at chunk_i > 0

      const responseBodySource = this.performRequest(method, requestBody, peerId);
      yield* responseEncodeSuccess(this.config, method, encoding)(responseBodySource);
    } catch (e) {
      const status =
        e instanceof InvalidRequestError ? RpcResponseStatus.INVALID_REQUEST : RpcResponseStatus.SERVER_ERROR;
      yield* responseEncodeError(status, e.message);
    } finally {
      // Extra cleanup?
    }
  }

  registerHandler(handler: ReqRespHandler): void {
    if (this.performRequestHandler) {
      throw new Error("Already registered handler");
    }
    this.performRequestHandler = handler;
  }

  unregisterHandler(): void {
    this.performRequestHandler = null;
  }

  /**
   * Consumers could emit the handler function itself and this module will store them
   * Then it will use the registry of stored handlers to serve requests
   */
  async *performRequest(method: Method, requestBody: RequestBody, peerId: PeerId): AsyncIterable<ResponseBody> {
    if (!this.performRequestHandler) {
      throw Error("performRequestHandler not registered");
    }

    yield* this.performRequestHandler(method, requestBody, peerId);
    // this.emit(
    //   "request",
    //   {id: requestId, method, encoding, body: requestBody} as ReqRespRequest<RequestBody>,
    //   peerId,
    //   streamSink
    // );
  }

  public async stop(): Promise<void> {
    for (const method of Object.values(Method)) {
      for (const encoding of Object.values(ReqRespEncoding)) {
        this.libp2p.unhandle(createRpcProtocol(method, encoding));
      }
    }
    this.controller?.abort();
  }

  public async status(peerId: PeerId, request: Status): Promise<Status | null> {
    return await this.sendRequest<Status>(peerId, Method.Status, request);
  }

  public async goodbye(peerId: PeerId, request: Goodbye): Promise<void> {
    await this.sendRequest<Goodbye>(peerId, Method.Goodbye, request);
  }

  public async ping(peerId: PeerId, request: Ping): Promise<Ping | null> {
    return await this.sendRequest<Ping>(peerId, Method.Ping, request);
  }

  public async metadata(peerId: PeerId): Promise<Metadata | null> {
    return await this.sendRequest<Metadata>(peerId, Method.Metadata, null);
  }

  public async beaconBlocksByRange(
    peerId: PeerId,
    request: BeaconBlocksByRangeRequest
  ): Promise<SignedBeaconBlock[] | null> {
    try {
      const result = await this.sendRequest<SignedBeaconBlock[]>(
        peerId,
        Method.BeaconBlocksByRange,
        request,
        request.count
      );
      this.blockProviderScores.update(peerId, RpcScoreEvent.SUCCESS_BLOCK_RANGE);
      return result;
    } catch (e) {
      updateRpcScore(this.blockProviderScores, peerId, e);
      throw e;
    }
  }

  public async beaconBlocksByRoot(
    peerId: PeerId,
    request: BeaconBlocksByRootRequest
  ): Promise<SignedBeaconBlock[] | null> {
    try {
      const result = await this.sendRequest<SignedBeaconBlock[]>(
        peerId,
        Method.BeaconBlocksByRoot,
        request,
        request.length
      );
      this.blockProviderScores.update(peerId, RpcScoreEvent.SUCCESS_BLOCK_ROOT);
      return result;
    } catch (e) {
      updateRpcScore(this.blockProviderScores, peerId, e);
      throw e;
    }
  }

  private storePeerEncodingPreference(peerId: PeerId, method: Method, encoding: ReqRespEncoding): void {
    const peerReputations = this.peerMetadata;
    if (method === Method.Status) {
      peerReputations.setEncoding(peerId, encoding);
    }
  }

  // Helper to reduce code duplication
  private async sendRequest<T extends ResponseBody | ResponseBody[]>(
    peerId: PeerId,
    method: Method,
    body: RequestBody,
    maxResponses?: number
  ): Promise<T | null> {
    return await sendRequest<T>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      method,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      body,
      maxResponses,
      this.controller?.signal
    );
  }
}
