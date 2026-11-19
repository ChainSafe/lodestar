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
      const encodedResponse = await Array.fromAsync(
        responseEncode([{status: RespStatus.SUCCESS, payload: requestBody}], protocols[0] as Protocol)
      );

      libp2p = {
        dialProtocol: vi.fn().mockImplementation(
          async () =>
            (
              await createMockStream({
                protocol: protocols[0].method,
                source: (async function* (): AsyncIterable<Uint8Array> {
                  yield Buffer.concat(encodedResponse);
                })(),
              })
            ).stream
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
      expect(responses.map((r) => ({...r, data: Buffer.from(r.data)}))).toEqual(expectedReturn);
    });
  }

  it("closes stream gracefully when caller stops consuming responses early", async () => {
    const encodedResponse = await Array.fromAsync(
      responseEncode(
        [
          {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
          {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
        ],
        emptyProtocol as Protocol
      )
    );

    let abortCalled = false;
    let getStreamState = (): {status: string; readStatus: string; writeStatus: string} => ({
      status: "not-created",
      readStatus: "not-created",
      writeStatus: "not-created",
    });
    libp2p = {
      dialProtocol: vi.fn().mockImplementation(async () => {
        const streamResult = await createMockStream({
          protocol: emptyProtocol.method,
          source: (async function* (): AsyncIterable<Uint8Array> {
            yield Buffer.concat(encodedResponse);
            await sleep(100000, controller.signal);
          })(),
        });
        const reqStream = streamResult.stream as unknown as {
          status: string;
          readStatus: string;
          writeStatus: string;
          abort: (error: Error) => void;
        };
        const abort = reqStream.abort.bind(reqStream);
        reqStream.abort = (error: Error): void => {
          abortCalled = true;
          abort(error);
        };
        getStreamState = () => ({
          status: reqStream.status,
          readStatus: reqStream.readStatus,
          writeStatus: reqStream.writeStatus,
        });
        return streamResult.stream;
      }),
    } as unknown as Libp2p;

    let responseCount = 0;
    for await (const _ of sendRequest(
      {logger, libp2p, metrics: null},
      peerId,
      [emptyProtocol],
      [emptyProtocol.method],
      EMPTY_REQUEST,
      controller.signal
    )) {
      responseCount++;
      break;
    }

    expect(responseCount).toBe(1);
    expect(abortCalled).toBe(false);
    const streamState = getStreamState();
    expect(streamState.status).not.toBe("aborted");
    expect(streamState.readStatus).toBe("closed");
    expect(streamState.writeStatus).toBe("closed");
  });

  it("aborts stream if remote never closes after early consumer exit", async () => {
    const encodedResponse = await Array.fromAsync(
      responseEncode([{status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload}], emptyProtocol as Protocol)
    );

    let getStreamStatus = (): string => "not-created";
    libp2p = {
      dialProtocol: vi.fn().mockImplementation(async () => {
        const streamResult = await createMockStream({
          protocol: emptyProtocol.method,
          source: (async function* (): AsyncIterable<Uint8Array> {
            yield Buffer.concat(encodedResponse);
            await sleep(100000, controller.signal);
          })(),
        });
        const reqStream = streamResult.stream as unknown as {status: string};
        getStreamStatus = () => reqStream.status;
        return streamResult.stream;
      }),
    } as unknown as Libp2p;

    for await (const _ of sendRequest(
      {logger, libp2p, metrics: null},
      peerId,
      [emptyProtocol],
      [emptyProtocol.method],
      EMPTY_REQUEST,
      controller.signal,
      {respTimeoutMs: 20}
    )) {
      break;
    }

    expect(getStreamStatus()).not.toBe("aborted");
    await sleep(50, controller.signal);
    expect(getStreamStatus()).toBe("aborted");
  });

  it("aborts stream on RESP_TIMEOUT", async () => {
    const testMethod = "req/test";
    let getStreamStatus = (): string => "not-created";
    libp2p = {
      dialProtocol: vi.fn().mockImplementation(async () => {
        const streamResult = await createMockStream({
          protocol: testMethod,
          source: (async function* (): AsyncIterable<Uint8Array> {
            await sleep(100000, controller.signal);
            yield new Uint8Array();
          })(),
        });
        const reqStream = streamResult.stream as unknown as {status: string};
        getStreamStatus = () => reqStream.status;
        return streamResult.stream;
      }),
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
          {respTimeoutMs: 1}
        )
      ),
      new RequestError({code: RequestErrorCode.RESP_TIMEOUT})
    );
    expect(getStreamStatus()).toBe("aborted");
  });

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
          dialProtocol: vi
            .fn()
            .mockImplementation(async () => (await createMockStream({protocol: testMethod, source: source()})).stream),
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
