import crypto from "node:crypto";
import http from "node:http";
import {describe, it, expect, afterEach, vi} from "vitest";
import {FetchError} from "@lodestar/api";
import {sleep} from "@lodestar/utils";
import {JsonRpcHttpClient} from "../../../src/eth1/provider/jsonRpcHttpClient.js";
import {getGoerliRpcUrl} from "../../testParams.js";
import {RpcPayload} from "../../../src/eth1/interface.js";

describe("eth1 / jsonRpcHttpClient", function () {
  vi.setConfig({testTimeout: 10_000});

  const port = 36421;
  const noMethodError = {code: -32601, message: "Method not found"};
  const notInSpecError = "JSON RPC Error not in spec";
  const randomHex = crypto.randomBytes(32).toString("hex");

  const testCases: {
    id: string;
    url?: string;
    payload?: RpcPayload;
    requestListener?: http.RequestListener;
    abort?: true;
    timeout?: number;
    error: any;
    errorCode?: string;
  }[] = [
    // // NOTE: This DNS query is very expensive, all cache miss. So it can timeout the tests and cause false positives
    // {
    //   id: "Bad domain",
    //   url: `https://${randomHex}.com`,
    //   error: "getaddrinfo ENOTFOUND",
    // },
    {
      id: "Bad subdomain",
      // Use random bytes to ensure no collisions
      url: `https://${randomHex}.infura.io`,
      error: "",
      errorCode: "ENOTFOUND",
    },
    {
      id: "Bad port",
      url: `http://localhost:${port + 1}`,
      requestListener: (req, res) => res.end(),
      error: "",
      errorCode: "ECONNREFUSED",
    },
    {
      id: "Not a JSON RPC endpoint",
      requestListener: (req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end("<html></html>");
      },
      error: "Error parsing JSON",
    },
    {
      id: "Endpoint returns HTTP error",
      requestListener: (req, res) => {
        res.statusCode = 404;
        res.end();
      },
      error: "Not Found",
    },
    {
      id: "RPC payload with error",
      requestListener: (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({jsonrpc: "2.0", id: 83, error: noMethodError}));
      },
      error: noMethodError.message,
    },
    {
      id: "RPC payload with non-spec error: error has no message",
      requestListener: (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({jsonrpc: "2.0", id: 83, error: {code: noMethodError.code}}));
      },
      error: noMethodError.message,
    },
    {
      id: "RPC payload with non-spec error: error is a string",
      requestListener: (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({jsonrpc: "2.0", id: 83, error: notInSpecError}));
      },
      error: notInSpecError,
    },
    {
      id: "RPC payload with no result",
      requestListener: (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({jsonrpc: "2.0", id: 83}));
      },
      error: "no result",
    },
    {
      id: "Aborted request",
      abort: true,
      requestListener: () => {
        // leave the request open until aborted
      },
      error: "Aborted request",
    },
    {
      id: "Timeout request",
      timeout: 1,
      requestListener: () => {
        // leave the request open until timeout
      },
      error: "Timeout request",
    },
  ];

  const afterHooks: (() => Promise<void>)[] = [];

  afterEach(async function () {
    while (afterHooks.length) {
      const afterHook = afterHooks.pop();
      if (afterHook) await afterHook();
    }
  });

  for (const testCase of testCases) {
    const {id, requestListener, abort, timeout} = testCase;
    let {url, payload} = testCase;

    it(id, async function () {
      if (requestListener) {
        if (!url) url = `http://localhost:${port}`;

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

      if (!url) url = getGoerliRpcUrl();
      if (!payload) payload = {method: "no-method", params: []};

      const controller = new AbortController();
      if (abort) setTimeout(() => controller.abort(), 50);
      const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});

      try {
        await eth1JsonRpcClient.fetch(payload, {timeout});
      } catch (error) {
        if (testCase.errorCode) {
          expect((error as FetchError).code).toBe(testCase.errorCode);
        } else {
          expect((error as Error).message).toEqual(expect.stringContaining(testCase.error));
        }
      }
      expect.assertions(1);
    });
  }
});

describe("eth1 / jsonRpcHttpClient - with retries", function () {
  vi.setConfig({testTimeout: 10_000});

  const port = 36421;
  const noMethodError = {code: -32601, message: "Method not found"};
  const afterHooks: (() => Promise<void>)[] = [];

  afterEach(async function () {
    while (afterHooks.length) {
      const afterHook = afterHooks.pop();
      if (afterHook)
        await afterHook().catch((e: Error) => {
          console.error("Error in afterEach hook", e);
        });
    }
  });

  it("should retry ENOTFOUND", async function () {
    let retryCount = 0;

    const url = "https://goerli.fake-website.io";
    const payload = {method: "get", params: []};
    const retries = 2;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(
      eth1JsonRpcClient.fetchWithRetries(payload, {
        retries,
        shouldRetry: () => {
          // using the shouldRetry function to keep tab of the retried requests
          retryCount++;
          return true;
        },
      })
    ).rejects.toThrow("getaddrinfo ENOTFOUND");
    expect(retryCount).toBeWithMessage(retries, "ENOTFOUND should be retried before failing");
  });

  it("should retry ECONNREFUSED", async function () {
    let retryCount = 0;

    const url = `http://localhost:${port + 1}`;
    const payload = {method: "get", params: []};
    const retries = 2;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(
      eth1JsonRpcClient.fetchWithRetries(payload, {
        retries,
        shouldRetry: () => {
          // using the shouldRetry function to keep tab of the retried requests
          retryCount++;
          return true;
        },
      })
    ).rejects.toThrow(expect.objectContaining({code: "ECONNREFUSED"}));
    expect(retryCount).toBeWithMessage(retries, "code ECONNREFUSED should be retried before failing");
  });

  it("should retry 404", async function () {
    let requestCount = 0;

    const server = http.createServer((req, res) => {
      requestCount++;
      res.statusCode = 404;
      res.end();
    });

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

    const url = `http://localhost:${port}`;
    const payload = {method: "get", params: []};
    const retries = 2;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(eth1JsonRpcClient.fetchWithRetries(payload, {retries})).rejects.toThrow("Not Found");
    expect(requestCount).toBeWithMessage(retries + 1, "404 responses should be retried before failing");
  });

  it("should retry timeout", async function () {
    let requestCount = 0;

    const server = http.createServer(async () => {
      requestCount++;
    });

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
    // it's observed that immediate request after the server started end up ECONNRESET
    await sleep(100);

    const url = `http://localhost:${port}`;
    const payload = {method: "get", params: []};
    const retries = 2;
    const timeout = 200;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(eth1JsonRpcClient.fetchWithRetries(payload, {retries, timeout})).rejects.toThrow("Timeout request");
    expect(requestCount).toBeWithMessage(retries + 1, "Timeout request should be retried before failing");
  });

  it("should not retry aborted", async function () {
    let requestCount = 0;
    const server = http.createServer(() => {
      requestCount++;
      // leave the request open until timeout
    });

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

    const url = `http://localhost:${port}`;
    const payload = {method: "get", params: []};
    const retries = 2;
    const timeout = 200;

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(eth1JsonRpcClient.fetchWithRetries(payload, {retries, timeout})).rejects.toThrow("Aborted");
    expect(requestCount).toBeWithMessage(1, "Aborted request should not be retried");
  });

  it("should not retry payload error", async function () {
    let requestCount = 0;

    const server = http.createServer((req, res) => {
      requestCount++;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({jsonrpc: "2.0", id: 83, error: noMethodError}));
    });

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

    const url = `http://localhost:${port}`;
    const payload = {method: "get", params: []};
    const retries = 2;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(eth1JsonRpcClient.fetchWithRetries(payload, {retries})).rejects.toThrow("Method not found");
    expect(requestCount).toBeWithMessage(1, "Payload error (non-network error) should not be retried");
  });
});
