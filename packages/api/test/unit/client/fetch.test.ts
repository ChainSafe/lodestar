import crypto from "node:crypto";
import http from "node:http";
import {describe, it, expect, afterEach} from "vitest";
import {FetchError, FetchErrorType, fetch} from "../../../src/utils/client/fetch.js";

describe("FetchError", () => {
  const port = 37421;
  const randomHex = crypto.randomBytes(32).toString("hex");

  const testCases: {
    id: string;
    url?: string;
    requestListener?: http.RequestListener;
    signalHandler?: () => AbortSignal;
    errorType: FetchErrorType;
    errorCode: string;
    expectCause: boolean;
  }[] = [
    {
      id: "Bad domain",
      // Use random bytes to ensure no collisions
      url: `https://${randomHex}.infura.io`,
      errorType: "failed",
      errorCode: "ENOTFOUND",
      expectCause: true,
    },
    {
      id: "Bad port",
      url: `http://localhost:${port + 1}`,
      requestListener: (_req, res) => res.end(),
      errorType: "failed",
      errorCode: "ECONNREFUSED",
      expectCause: true,
    },
    {
      id: "Socket error",
      requestListener: (_req, res) => res.socket?.destroy(),
      errorType: "failed",
      errorCode: "UND_ERR_SOCKET",
      expectCause: true,
    },
    {
      id: "Headers overflow",
      requestListener: (_req, res) => {
        res.setHeader("Large-Header", "a".repeat(1e6));
        res.end();
      },
      errorType: "failed",
      errorCode: "UND_ERR_HEADERS_OVERFLOW",
      expectCause: true,
    },
    {
      id: "Unknown scheme",
      url: `httsp://localhost:${port}`,
      errorType: "failed",
      errorCode: "ERR_FETCH_FAILED",
      expectCause: true,
    },
    {
      id: "Invalid URL",
      url: "invalid-url",
      errorType: "input",
      errorCode: "ERR_INVALID_URL",
      expectCause: true,
    },
    {
      id: "Aborted request",
      requestListener: () => {
        // leave the request open until aborted
      },
      signalHandler: () => AbortSignal.abort(),
      errorType: "aborted",
      errorCode: "ERR_ABORTED",
      expectCause: false,
    },
    {
      id: "Timeout request",
      requestListener: () => {
        // leave the request open until timeout
      },
      signalHandler: () => AbortSignal.timeout(10),
      errorType: "timeout",
      errorCode: "ERR_TIMEOUT",
      expectCause: false,
    },
  ];

  const afterHooks: (() => Promise<void>)[] = [];

  afterEach(async () => {
    while (afterHooks.length) {
      const afterHook = afterHooks.pop();
      if (afterHook)
        await afterHook().catch((e: Error) => {
          console.error("Error in afterEach hook", e);
        });
    }
  });

  for (const testCase of testCases) {
    const {id, url = `http://localhost:${port}`, requestListener, signalHandler} = testCase;

    it(id, async () => {
      if (requestListener) {
        const server = http.createServer(requestListener);
        await new Promise<void>((resolve) => server.listen(port, resolve));
        afterHooks.push(
          () =>
            new Promise((resolve, reject) =>
              server.close((err) => {
                if (err) reject(err);
                else resolve();
              })
            )
        );
      }

      await expect(fetch(url, {signal: signalHandler?.()})).rejects.toSatisfy((err) => {
        expect(err).toBeInstanceOf(FetchError);
        expect((err as FetchError).code).toBe(testCase.errorCode);
        expect((err as FetchError).type).toBe(testCase.errorType);

        if (testCase.expectCause) {
          expect((err as FetchError).cause).toBeInstanceOf(Error);
        }

        return true;
      });
    });
  }
});
