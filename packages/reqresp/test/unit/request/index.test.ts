import {PeerId} from "@libp2p/interface/peer-id";
import all from "it-all";
import {pipe} from "it-pipe";
import {expect} from "chai";
import {Libp2p} from "libp2p";
import sinon from "sinon";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {LodestarError, sleep} from "@lodestar/utils";
import {RequestError, RequestErrorCode, sendRequest, SendRequestOpts} from "../../../src/request/index.js";
import {Protocol, MixedProtocol, ResponseIncoming} from "../../../src/types.js";
import {getEmptyHandler, sszSnappyPing} from "../../fixtures/messages.js";
import {getValidPeerId} from "../../utils/peer.js";
import {MockLibP2pStream} from "../../utils/index.js";
import {responseEncode} from "../../utils/response.js";
import {RespStatus} from "../../../src/interface.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {pingProtocol} from "../../fixtures/protocols.js";

describe("request / sendRequest", () => {
  const logger = getEmptyLogger();
  let controller: AbortController;
  let peerId: PeerId;
  let libp2p: Libp2p;
  const sandbox = sinon.createSandbox();
  const emptyProtocol = pingProtocol(getEmptyHandler());
  const EMPTY_REQUEST = new Uint8Array();

  const testCases: {
    id: string;
    protocols: MixedProtocol[];
    requestBody: ResponseIncoming;
    maxResponses?: number;
    expectedReturn: unknown[];
  }[] = [
    {
      id: "Return first chunk only for a single-chunk method",
      protocols: [emptyProtocol],
      requestBody: sszSnappyPing.binaryPayload,
      expectedReturn: [sszSnappyPing.binaryPayload],
    },
    // limit to max responses is no longer the responsability of this package
    // {
    //   id: "Return up to maxResponses for a multi-chunk method",
    //   protocols: [customProtocol({})],
    //   requestBody: sszSnappySignedBeaconBlockPhase0.binaryPayload,
    //   expectedReturn: [sszSnappySignedBeaconBlockPhase0.binaryPayload],
    // },
  ];

  beforeEach(() => {
    controller = new AbortController();
    peerId = getValidPeerId();
  });

  afterEach(() => {
    sandbox.restore();
    controller.abort();
  });

  for (const {id, protocols, expectedReturn, requestBody} of testCases) {
    it(id, async () => {
      libp2p = {
        dialProtocol: sinon
          .stub()
          .resolves(
            new MockLibP2pStream(
              responseEncode([{status: RespStatus.SUCCESS, payload: requestBody}], protocols[0] as Protocol),
              protocols[0].method
            )
          ),
      } as unknown as Libp2p;

      const responses = await pipe(
        sendRequest(
          {logger, libp2p, metrics: null},
          peerId,
          protocols,
          protocols.map((p) => p.method),
          EMPTY_REQUEST,
          controller.signal
        ),
        all
      );
      expect(responses).to.deep.equal(expectedReturn);
    });
  }

  describe("timeout cases", () => {
    const peerId = getValidPeerId();
    const testMethod = "req/test";

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
        error: new RequestError({code: RequestErrorCode.TTFB_TIMEOUT}),
      },
      {
        id: "trigger a RESP_TIMEOUT",
        opts: {respTimeoutMs: 0},
        source: async function* () {
          yield sszSnappyPing.chunks[0];
          await sleep(30); // Pause for too long after first byte
          yield sszSnappyPing.chunks[1];
        },
        error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}),
      },
      {
        // Upstream "abortable-iterator" never throws with an infinite sleep.
        id: "Infinite sleep on first byte",
        opts: {ttfbTimeoutMs: 1, respTimeoutMs: 1},
        source: async function* () {
          await sleep(100000, controller.signal);
          yield sszSnappyPing.chunks[0];
        },
        error: new RequestError({code: RequestErrorCode.TTFB_TIMEOUT}),
      },
      {
        id: "Infinite sleep on second chunk",
        opts: {ttfbTimeoutMs: 1, respTimeoutMs: 1},
        source: async function* () {
          yield sszSnappyPing.chunks[0];
          await sleep(100000, controller.signal);
        },
        error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}),
      },
    ];

    for (const {id, source, opts, error} of timeoutTestCases) {
      it(id, async () => {
        libp2p = {
          dialProtocol: sinon.stub().resolves(new MockLibP2pStream(source(), testMethod)),
        } as unknown as Libp2p;

        await expectRejectedWithLodestarError(
          pipe(
            sendRequest(
              {logger, libp2p, metrics: null},
              peerId,
              [emptyProtocol],
              [testMethod],
              EMPTY_REQUEST,
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
