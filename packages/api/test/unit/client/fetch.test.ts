import crypto from "node:crypto";
import http from "node:http";
import {expect} from "chai";
import {FetchError, FetchErrorType, fetch} from "../../../src/utils/client/fetch.js";

describe("FetchError", function () {
  const port = 37421;
  const randomHex = crypto.randomBytes(32).toString("hex");

  const testCases: {
    id: string;
    url?: string;
    requestListener?: http.RequestListener;
    abort?: true;
    timeout?: number;
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
      abort: true,
      requestListener: () => {
        // leave the request open until aborted
      },
      errorType: "aborted",
      errorCode: "ERR_ABORTED",
      expectCause: false,
    },
  ];

  const afterHooks: (() => Promise<void>)[] = [];

  afterEach(async function () {
    while (afterHooks.length) {
      const afterHook = afterHooks.pop();
      if (afterHook)
        await afterHook().catch((e: Error) => {
          // eslint-disable-next-line no-console
          console.error("Error in afterEach hook", e);
        });
    }
  });

  for (const testCase of testCases) {
    const {id, url = `http://localhost:${port}`, requestListener, abort} = testCase;

    it(id, async function () {
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

      const controller = new AbortController();
      if (abort) setTimeout(() => controller.abort(), 20);
      await expect(fetch(url, {signal: controller.signal})).to.be.rejected.then((error: FetchError) => {
        expect(error.type).to.be.equal(testCase.errorType);
        expect(error.code).to.be.equal(testCase.errorCode);
        if (testCase.expectCause) {
          expect(error.cause).to.be.instanceof(Error);
        }
      });
    });
  }
});
