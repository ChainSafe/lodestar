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
import {pipe} from "it-pipe";
import LibP2p from "libp2p";
import PeerId from "peer-id";
import {IReqEventEmitterClass, IReqRespModules, sendRequest} from ".";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../constants";
import {IValidatedRequestBody} from "../encoders/interface";
import {eth2RequestDecode} from "../encoders/request";
import {RpcError, updateRpcScore} from "../error";
import {IReqResp} from "../interface";
import {IPeerMetadataStore} from "../peers/interface";
import {IRpcScoreTracker, RpcScoreEvent} from "../peers/score";
import {createRpcProtocol, randomRequestId} from "../util";
import {ReqRespRequest} from "./interface";
import {sendResponse} from "./respUtils";
import {EventEmitter} from "events";

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

  public constructor({config, libp2p, peerMetadata, blockProviderScores, logger}: IReqRespModules) {
    super();
    this.config = config;
    this.libp2p = libp2p;
    this.peerMetadata = peerMetadata;
    this.logger = logger;
    this.blockProviderScores = blockProviderScores;
  }

  public async start(): Promise<void> {
    this.controller = new AbortController();
    for (const method of Object.values(Method)) {
      for (const encoding of Object.values(ReqRespEncoding)) {
        this.libp2p.handle(createRpcProtocol(method, encoding), async ({connection, stream}) => {
          const peerId = connection.remotePeer;
          void pipe(
            stream.source as AsyncIterable<Buffer>,
            eth2RequestDecode(this.config, this.logger, method, encoding),
            this.storePeerEncodingPreference(peerId, method, encoding),
            this.handleRpcRequest(peerId, method, encoding, stream.sink)
          );
        });
      }
    }
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
    return await this.sendRequest<Metadata>(peerId, Method.Metadata);
  }

  public async beaconBlocksByRange(
    peerId: PeerId,
    request: BeaconBlocksByRangeRequest
  ): Promise<SignedBeaconBlock[] | null> {
    try {
      const result = await this.sendRequest<SignedBeaconBlock[]>(peerId, Method.BeaconBlocksByRange, request);
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
      const result = await this.sendRequest<SignedBeaconBlock[]>(peerId, Method.BeaconBlocksByRoot, request);
      this.blockProviderScores.update(peerId, RpcScoreEvent.SUCCESS_BLOCK_ROOT);
      return result;
    } catch (e) {
      updateRpcScore(this.blockProviderScores, peerId, e);
      throw e;
    }
  }

  private storePeerEncodingPreference(
    peerId: PeerId,
    method: Method,
    encoding: ReqRespEncoding
  ): (source: AsyncIterable<IValidatedRequestBody>) => AsyncGenerator<IValidatedRequestBody> {
    const peerReputations = this.peerMetadata;
    return async function* (source) {
      if (method === Method.Status) {
        peerReputations.setEncoding(peerId, encoding);
      }
      yield* source;
    };
  }

  private handleRpcRequest(
    peerId: PeerId,
    method: Method,
    encoding: ReqRespEncoding,
    sink: Sink<unknown, unknown>
  ): (source: AsyncIterable<IValidatedRequestBody>) => Promise<void> {
    const {config, logger} = this;
    const emit = this.emit.bind(this);
    return async (source) => {
      for await (const request of source) {
        if (!request.isValid) {
          await sendResponse(
            {config, logger},
            randomRequestId(),
            method,
            encoding,
            sink,
            new RpcError(RpcResponseStatus.INVALID_REQ, "Invalid request")
          );
        } else {
          emit(
            "request",
            {id: randomRequestId(), method, encoding, body: request.body ?? null} as ReqRespRequest<RequestBody>,
            peerId,
            sink
          );
        }
        return;
      }
    };
  }

  // Helper to reduce code duplication
  private async sendRequest<T extends ResponseBody | ResponseBody[]>(
    peerId: PeerId,
    method: Method,
    body?: RequestBody
  ): Promise<T | null> {
    return await sendRequest<T>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      method,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      body,
      this.controller?.signal
    );
  }
}
