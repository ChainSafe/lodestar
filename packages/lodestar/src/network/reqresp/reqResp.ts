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
    Object.values(Method).forEach((method) => {
      Object.values(ReqRespEncoding).forEach((encoding) => {
        this.libp2p.handle(createRpcProtocol(method, encoding), async ({connection, stream}) => {
          const peerId = connection.remotePeer;
          pipe(
            stream.source,
            eth2RequestDecode(this.config, this.logger, method, encoding),
            this.storePeerEncodingPreference(peerId, method, encoding),
            this.handleRpcRequest(peerId, method, encoding, stream.sink)
          );
        });
      });
    });
  }

  public async stop(): Promise<void> {
    Object.values(Method).forEach((method) => {
      Object.values(ReqRespEncoding).forEach((encoding) => {
        this.libp2p.unhandle(createRpcProtocol(method, encoding));
      });
    });
    this.controller?.abort();
  }

  public async status(peerId: PeerId, request: Status): Promise<Status | null> {
    return await sendRequest<Status>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      Method.Status,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      request,
      this.controller?.signal
    );
  }

  public async goodbye(peerId: PeerId, request: Goodbye): Promise<void> {
    await sendRequest<Goodbye>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      Method.Goodbye,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      request,
      this.controller?.signal
    );
  }

  public async ping(peerId: PeerId, request: Ping): Promise<Ping | null> {
    return await sendRequest<Ping>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      Method.Ping,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      request,
      this.controller?.signal
    );
  }

  public async metadata(peerId: PeerId): Promise<Metadata | null> {
    return await sendRequest<Metadata>(
      {libp2p: this.libp2p, logger: this.logger, config: this.config},
      peerId,
      Method.Metadata,
      this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
      undefined,
      this.controller?.signal
    );
  }

  public async beaconBlocksByRange(
    peerId: PeerId,
    request: BeaconBlocksByRangeRequest
  ): Promise<SignedBeaconBlock[] | null> {
    try {
      const result = await sendRequest<SignedBeaconBlock[]>(
        {libp2p: this.libp2p, logger: this.logger, config: this.config},
        peerId,
        Method.BeaconBlocksByRange,
        this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
        request,
        this.controller?.signal
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
      const result = await sendRequest<SignedBeaconBlock[]>(
        {libp2p: this.libp2p, logger: this.logger, config: this.config},
        peerId,
        Method.BeaconBlocksByRoot,
        this.peerMetadata.getEncoding(peerId) ?? ReqRespEncoding.SSZ_SNAPPY,
        request,
        this.controller?.signal
      );
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
            new RpcError(RpcResponseStatus.ERR_INVALID_REQ, "Invalid request")
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
}
