import {AbortController} from "@chainsafe/abort-controller";
import all from "it-all";
import pipe from "it-pipe";
import {LodestarError, sleep as _sleep} from "@chainsafe/lodestar-utils";
import {timeoutOptions} from "../../../../../src/constants";
import {responseTimeoutsHandler} from "../../../../../src/network/reqresp/request/responseTimeoutsHandler";
import {RequestErrorCode, RequestInternalError} from "../../../../../src/network/reqresp/request/errors";
import {expectRejectedWithLodestarError} from "../../../../utils/errors";

/* eslint-disable require-yield */

describe("network / reqresp / request / responseTimeoutsHandler", () => {
  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());
  async function sleep(ms: number): Promise<void> {
    await _sleep(ms, controller.signal);
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const testCases: {
    id: string;
    timeouts?: Partial<typeof timeoutOptions>;
    source: () => AsyncGenerator<Buffer>;
    responseDecoder: (source: AsyncIterable<Buffer>) => AsyncGenerator<Buffer>;
    error?: LodestarError<any>;
  }[] = [
    {
      id: "yield values without errors",
      source: async function* () {
        yield Buffer.from([0]);
        await sleep(0);
        yield Buffer.from([0]);
      },
      responseDecoder: async function* (source) {
        yield* source;
      },
    },
    {
      id: "trigger a TTFB_TIMEOUT",
      timeouts: {TTFB_TIMEOUT: 0},
      source: async function* () {
        await sleep(30); // Pause for too long before first byte
        yield Buffer.from([0]);
      },
      responseDecoder: async function* (source) {
        yield* source;
      },
      error: new RequestInternalError({code: RequestErrorCode.TTFB_TIMEOUT}),
    },
    {
      id: "trigger a RESP_TIMEOUT",
      timeouts: {RESP_TIMEOUT: 0},
      source: async function* () {
        yield Buffer.from([0]);
        await sleep(30); // Pause for too long after first byte
        yield Buffer.from([0]);
      },
      responseDecoder: async function* (source) {
        yield* source;
      },
      error: new RequestInternalError({code: RequestErrorCode.RESP_TIMEOUT}),
    },
    {
      // A slow loris attack yields bytes slowly to not trigger inter-byte timeouts
      // but the overall response take a very long time to complete
      id: "handle a slow loris attack",
      timeouts: {RESP_TIMEOUT: 60},
      source: async function* () {
        while (true) {
          yield Buffer.from([0]);
          await sleep(20);
        }
      },
      responseDecoder: async function* (source) {
        for await (const _ of source) {
          // Never yield a response_chunk
        }
      },
      error: new RequestInternalError({code: RequestErrorCode.RESP_TIMEOUT}),
    },
    {
      // Upstream "abortable-iterator" never throws with an infinite sleep.
      id: "Infinite sleep on first byte",
      timeouts: {TTFB_TIMEOUT: 1, RESP_TIMEOUT: 1},
      source: async function* () {
        await sleep(100000);
      },
      responseDecoder: async function* (source) {
        yield* source;
      },
      error: new RequestInternalError({code: RequestErrorCode.TTFB_TIMEOUT}),
    },
    {
      id: "Infinite sleep on second chunk",
      timeouts: {TTFB_TIMEOUT: 1, RESP_TIMEOUT: 1},
      source: async function* () {
        yield Buffer.from([0]);
        await sleep(100000);
      },
      responseDecoder: async function* (source) {
        yield* source;
      },
      error: new RequestInternalError({code: RequestErrorCode.RESP_TIMEOUT}),
    },
  ];
  /* eslint-enable @typescript-eslint/naming-convention */

  for (const {id, timeouts, source, responseDecoder, error} of testCases) {
    it(id, async () => {
      const testPromise = pipe(source(), responseTimeoutsHandler(responseDecoder, timeouts), all);

      if (error) {
        await expectRejectedWithLodestarError(testPromise, error);
      } else {
        await testPromise;
      }
    });
  }
});
