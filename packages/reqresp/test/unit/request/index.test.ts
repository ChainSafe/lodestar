import {PeerId} from "@libp2p/interface";
import type {Libp2p} from "libp2p";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {LodestarError, sleep} from "@lodestar/utils";
import {RespStatus} from "../../../src/interface.js";
import {RequestError, RequestErrorCode, SendRequestOpts, sendRequest} from "../../../src/request/index.js";
import {MixedProtocol, Protocol, ResponseIncoming} from "../../../src/types.js";
import {getEmptyHandler, sszSnappyPing} from "../../fixtures/messages.js";
import {pingProtocol} from "../../fixtures/protocols.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {createMockStream} from "../../utils/mockStream.js";
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
    // limit to max responses is no longer the responsibility of this package
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
    vi.restoreAllMocks();
    controller.abort();
  });

  for (const {id, protocols, expectedReturn, requestBody} of testCases) {
    it(id, async () => {
      libp2p = {
        dialProtocol: vi.fn().mockResolvedValue(
          createMockStream({
            protocol: protocols[0].method,
            source: responseEncode([{status: RespStatus.SUCCESS, payload: requestBody}], protocols[0] as Protocol),
          }).stream
        ),
      } as unknown as Libp2p;

      const responses = await Array.fromAsync(
        sendRequest(
          {logger, libp2p, metrics: null},
          peerId,
          protocols,
          protocols.map((p) => p.method),
          EMPTY_REQUEST,
          controller.signal
        )
      );
      expect(responses).toEqual(expectedReturn);
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
        id: "trigger a RESP_TIMEOUT when first response is delayed",
        opts: {respTimeoutMs: 0},
        source: async function* () {
          await sleep(30); // Pause for too long before first byte
          yield sszSnappyPing.chunks[0];
        },
        error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}),
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
        opts: {respTimeoutMs: 1},
        source: async function* () {
          await sleep(100000, controller.signal);
          yield sszSnappyPing.chunks[0];
        },
        error: new RequestError({code: RequestErrorCode.RESP_TIMEOUT}),
      },
      {
        id: "Infinite sleep on second chunk",
        opts: {respTimeoutMs: 1},
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
          dialProtocol: vi.fn().mockResolvedValue(createMockStream({protocol: testMethod, source: source()}).stream),
        } as unknown as Libp2p;

        await expectRejectedWithLodestarError(
          Array.fromAsync(
            sendRequest(
              {logger, libp2p, metrics: null},
              peerId,
              [emptyProtocol],
              [testMethod],
              EMPTY_REQUEST,
              controller.signal,
              opts
            )
          ),
          error as LodestarError<any>
        );
      });
    }
  });
});
