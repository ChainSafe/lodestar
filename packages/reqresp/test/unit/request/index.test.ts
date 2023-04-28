import {PeerId} from "@libp2p/interface-peer-id";
import all from "it-all";
import {pipe} from "it-pipe";
import {expect} from "chai";
import {Libp2p} from "libp2p";
import sinon from "sinon";
import {Logger, LodestarError, sleep} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {RequestError, RequestErrorCode, sendRequest, SendRequestOpts} from "../../../src/request/index.js";
import {Protocol, Encoding, MixedProtocol, EncodedPayloadType, ContextBytesType} from "../../../src/types.js";
import {protocols, sszSnappyPing, sszSnappySignedBeaconBlockPhase0} from "../../fixtures/messages.js";
import {createStubbedLogger} from "../../mocks/logger.js";
import {getValidPeerId} from "../../utils/peer.js";
import {MockLibP2pStream} from "../../utils/index.js";
import {responseEncode} from "../../utils/response.js";
import {RespStatus} from "../../../src/interface.js";
import {RequestErrorMetadata} from "../../../src/index.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";

describe("request / sendRequest", () => {
  let controller: AbortController;
  let logger: Logger;
  let peerId: PeerId;
  let libp2p: Libp2p;
  const sandbox = sinon.createSandbox();

  const testCases: {
    id: string;
    protocols: MixedProtocol<any, any>[];
    requestBody: unknown;
    maxResponses?: number;
    expectedReturn: unknown[];
  }[] = [
    {
      id: "Return first chunk only for a single-chunk method",
      protocols: [protocols.ping],
      requestBody: sszSnappyPing.sszPayload.data,
      expectedReturn: [sszSnappyPing.sszPayload.data],
    },
    {
      id: "Return up to maxResponses for a multi-chunk method",
      protocols: [protocols.blocksByRange],
      requestBody: sszSnappySignedBeaconBlockPhase0.sszPayload.data,
      expectedReturn: [sszSnappySignedBeaconBlockPhase0.sszPayload.data],
    },
  ];

  beforeEach(() => {
    controller = new AbortController();
    peerId = getValidPeerId();
    logger = createStubbedLogger();
  });

  afterEach(() => {
    sandbox.restore();
    controller.abort();
  });

  for (const {id, protocols, expectedReturn, requestBody} of testCases) {
    it(id, async () => {
      libp2p = {
        dialProtocol: sinon.stub().resolves(
          new MockLibP2pStream(
            responseEncode(
              [
                {
                  status: RespStatus.SUCCESS,
                  payload: {
                    type: EncodedPayloadType.bytes,
                    bytes: protocols[0].responseType(ForkName.altair).serialize(requestBody),
                    contextBytes: {type: ContextBytesType.Empty},
                  },
                },
              ],
              protocols[0] as Protocol<any, any>
            ),
            protocols[0].method
          )
        ),
      } as unknown as Libp2p;

      const responses = await pipe(
        sendRequest(
          {logger, libp2p},
          peerId,
          protocols,
          protocols.map((p) => p.method),
          requestBody,
          controller.signal
        ),
        all
      );
      expect(responses).to.deep.equal(expectedReturn);
    });
  }

  describe("timeout cases", () => {
    const peerId = getValidPeerId();
    const metadata: RequestErrorMetadata = {
      method: protocols.ping.method,
      encoding: Encoding.SSZ_SNAPPY,
      peer: peerId.toString(),
    };

    const timeoutTestCases: {
      id: string;
      opts?: SendRequestOpts;
      source: () => AsyncGenerator<Uint8Array>;
      error?: LodestarError<any>;
    }[] = [
      {
        id: "trigger a TTFB_TIMEOUT",
        opts: {ttfbTimeoutMs: 0},
        source: async function* () {
          await sleep(30); // Pause for too long before first byte
          yield sszSnappyPing.chunks[0];
        },
        error: new RequestError({code: RequestErrorCode.TTFB_TIMEOUT}, metadata),
      },
      {
        id: "trigger a RESP_TIMEOUT",
        opts: {respTimeoutMs: 0},
        source: async function* () {
          yield sszSnappyPing.chunks[0];
          await sleep(30); // Pause for too long after first byte
          yield sszSnappyPing.chunks[1];
        },
        error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}, metadata),
      },
      {
        // Upstream "abortable-iterator" never throws with an infinite sleep.
        id: "Infinite sleep on first byte",
        opts: {ttfbTimeoutMs: 1, respTimeoutMs: 1},
        source: async function* () {
          await sleep(100000, controller.signal);
          yield sszSnappyPing.chunks[0];
        },
        error: new RequestError({code: RequestErrorCode.TTFB_TIMEOUT}, metadata),
      },
      {
        id: "Infinite sleep on second chunk",
        opts: {ttfbTimeoutMs: 1, respTimeoutMs: 1},
        source: async function* () {
          yield sszSnappyPing.chunks[0];
          await sleep(100000, controller.signal);
        },
        error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}, metadata),
      },
    ];

    for (const {id, source, opts, error} of timeoutTestCases) {
      it(id, async () => {
        libp2p = {
          dialProtocol: sinon.stub().resolves(new MockLibP2pStream(source(), protocols.ping.method)),
        } as unknown as Libp2p;

        await expectRejectedWithLodestarError(
          pipe(
            sendRequest(
              {logger, libp2p},
              peerId,
              [protocols.ping as MixedProtocol],
              [protocols.ping.method],
              sszSnappyPing.sszPayload.data,
              controller.signal,
              opts
            ),
            all
          ),
          error as LodestarError<any>
        );
      });
    }
  });
});
