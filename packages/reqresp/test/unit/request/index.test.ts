import {PeerId} from "@libp2p/interface";
import {Libp2p} from "libp2p";
import {Uint8ArrayList} from "uint8arraylist";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {LodestarError, sleep} from "@lodestar/utils";
import {RespStatus} from "../../../src/interface.js";
import {RequestError, RequestErrorCode, SendRequestOpts, sendRequest} from "../../../src/request/index.js";
import {MixedProtocol, Protocol, ResponseIncoming} from "../../../src/types.js";
import {getEmptyHandler, sszSnappyPing} from "../../fixtures/messages.js";
import {pingProtocol} from "../../fixtures/protocols.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {MockLibP2pStream} from "../../utils/index.js";
import {getValidPeerId} from "../../utils/peer.js";
import {responseEncode} from "../../utils/response.js";

describe("request / sendRequest", () => {
  const logger = getEmptyLogger();
  let controller: AbortController;
  let peerId: PeerId;
  let libp2p: Libp2p;
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
      expectedReturn: [{...sszSnappyPing.binaryPayload, data: Buffer.from(sszSnappyPing.binaryPayload.data)}],
    },
  ];

  beforeEach(() => {
    controller = new AbortController();
    peerId = getValidPeerId();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    controller.abort();
  });

  for (const {id, protocols, expectedReturn, requestBody} of testCases) {
    it(id, async () => {
      const encodedChunks = responseEncode(
        [{status: RespStatus.SUCCESS, payload: requestBody}],
        protocols[0] as Protocol
      );
      libp2p = {
        dialProtocol: vi.fn().mockResolvedValue(new MockLibP2pStream(encodedChunks, protocols[0].method)),
      } as unknown as Libp2p;

      // Collect responses
      const responses: ResponseIncoming[] = [];
      for await (const response of sendRequest(
        {logger, libp2p, metrics: null},
        peerId,
        protocols,
        protocols.map((p) => p.method),
        EMPTY_REQUEST,
        controller.signal
      )) {
        responses.push(response);
      }

      expect(responses).toEqual(expectedReturn);
    });
  }

  describe("timeout cases", () => {
    const peerId = getValidPeerId();
    const testMethod = "req/test";

    const timeoutTestCases: {
      id: string;
      opts?: SendRequestOpts;
      source: () => AsyncGenerator<Uint8ArrayList>;
      error?: LodestarError<any>;
    }[] = [
      {
        // Note: TTFB tracking removed per spec relaxation. Now using single RESP_TIMEOUT
        id: "trigger a RESP_TIMEOUT on slow response",
        opts: {respTimeoutMs: 10},
        source: async function* () {
          await sleep(50); // Pause for too long
          yield new Uint8ArrayList(sszSnappyPing.chunks[0]);
        },
        error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}),
      },
      {
        id: "Infinite sleep should timeout",
        opts: {respTimeoutMs: 10},
        source: async function* () {
          await sleep(100000, controller.signal);
          yield new Uint8ArrayList(sszSnappyPing.chunks[0]);
        },
        error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}),
      },
    ];

    for (const {id, source, opts, error} of timeoutTestCases) {
      it(id, async () => {
        libp2p = {
          dialProtocol: vi.fn().mockResolvedValue(new MockLibP2pStream(source(), testMethod)),
        } as unknown as Libp2p;

        // Collect responses and expect error
        const collectAll = async (): Promise<ResponseIncoming[]> => {
          const responses: ResponseIncoming[] = [];
          for await (const response of sendRequest(
            {logger, libp2p, metrics: null},
            peerId,
            [emptyProtocol],
            [testMethod],
            EMPTY_REQUEST,
            controller.signal,
            opts
          )) {
            responses.push(response);
          }
          return responses;
        };

        await expectRejectedWithLodestarError(collectAll(), error as LodestarError<any>);
      });
    }
  });
});
