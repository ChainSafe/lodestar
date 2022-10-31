import "mocha";
import crypto from "node:crypto";
import http from "node:http";
import {expect} from "chai";
import {JsonRpcHttpClient} from "../../../src/eth1/provider/jsonRpcHttpClient.js";
import {getGoerliRpcUrl} from "../../testParams.js";
import {IRpcPayload} from "../../../src/eth1/interface.js";

describe("eth1 / jsonRpcHttpClient", function () {
  this.timeout("10 seconds");

  const port = 36421;
  const noMethodError = {code: -32601, message: "Method not found"};
  const notInSpecError = "JSON RPC Error not in spec";
  const randomHex = crypto.randomBytes(32).toString("hex");

  const testCases: {
    id: string;
    url?: string;
    payload?: IRpcPayload;
    requestListener?: http.RequestListener;
    abort?: true;
    timeout?: number;
    error: any;
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
      error: "getaddrinfo ENOTFOUND",
    },
    {
      id: "Bad port",
      url: `http://localhost:${port + 1}`,
      requestListener: (req, res) => res.end(),
      error: "connect ECONNREFUSED",
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
      if (afterHook)
        await afterHook().catch((e: Error) => {
          // eslint-disable-next-line no-console
          console.error("Error in afterEach hook", e);
        });
    }
  });

  for (const testCase of testCases) {
    const {id, requestListener, abort, timeout} = testCase;
    const error = testCase.error as Error;
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
      await expect(eth1JsonRpcClient.fetch(payload, {timeout})).to.be.rejectedWith(error);
    });
  }
});

describe("eth1 / jsonRpcHttpClient - with retries", function () {
  this.timeout("10 seconds");
  const port = 36421;
  const noMethodError = {code: -32601, message: "Method not found"};
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

  it("should retry ENOTFOUND", async function () {
    let retryCount = 0;

    const url = "https://goerli.fake-website.io";
    const payload = {method: "get", params: []};
    const retryAttempts = 2;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(
      eth1JsonRpcClient.fetchWithRetries(payload, {
        retryAttempts,
        shouldRetry: () => {
          // using the shouldRetry function to keep tab of the retried requests
          retryCount++;
          return true;
        },
      })
    ).to.be.rejectedWith("getaddrinfo ENOTFOUND");
    expect(retryCount).to.be.equal(retryAttempts, "ENOTFOUND should be retried before failing");
  });

  it("should retry ECONNREFUSED", async function () {
    let retryCount = 0;

    const url = `http://localhost:${port + 1}`;
    const payload = {method: "get", params: []};
    const retryAttempts = 2;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(
      eth1JsonRpcClient.fetchWithRetries(payload, {
        retryAttempts,
        shouldRetry: () => {
          // using the shouldRetry function to keep tab of the retried requests
          retryCount++;
          return true;
        },
      })
    ).to.be.rejectedWith("connect ECONNREFUSED");
    expect(retryCount).to.be.equal(retryAttempts, "connect ECONNREFUSED should be retried before failing");
  });

  it("should retry 404", async function () {
    let retryCount = 0;

    const server = http.createServer((req, res) => {
      retryCount++;
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
    const retryAttempts = 2;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(eth1JsonRpcClient.fetchWithRetries(payload, {retryAttempts})).to.be.rejectedWith("Not Found");
    expect(retryCount).to.be.equal(retryAttempts, "404 responses should be retried before failing");
  });

  it("should retry timeout", async function () {
    let retryCount = 0;

    const server = http.createServer(() => {
      retryCount++;
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
    const retryAttempts = 2;
    const timeout = 2000;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(eth1JsonRpcClient.fetchWithRetries(payload, {retryAttempts, timeout})).to.be.rejectedWith(
      "Timeout request"
    );
    expect(retryCount).to.be.equal(retryAttempts, "Timeout request should be retried before failing");
  });

  it("should retry aborted", async function () {
    let retryCount = 0;
    const server = http.createServer(() => {
      retryCount++;
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
    const retryAttempts = 2;
    const timeout = 2000;

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(eth1JsonRpcClient.fetchWithRetries(payload, {retryAttempts, timeout})).to.be.rejectedWith(
      "Aborted request"
    );
    expect(retryCount).to.be.equal(retryAttempts, "Aborted request should be retried before failing");
  });

  it("should not retry payload error", async function () {
    let retryCount = 0;

    const server = http.createServer((req, res) => {
      retryCount++;
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
    const retryAttempts = 2;

    const controller = new AbortController();
    const eth1JsonRpcClient = new JsonRpcHttpClient([url], {signal: controller.signal});
    await expect(eth1JsonRpcClient.fetchWithRetries(payload, {retryAttempts})).to.be.rejectedWith("Method not found");
    expect(retryCount).to.be.equal(1, "Payload error (non-network error) should not be retried");
  });
});
