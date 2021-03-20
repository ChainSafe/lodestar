import "mocha";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import http from "http";
import {AbortController} from "abort-controller";
import {JsonRpcHttpClient} from "../../../src/eth1/jsonRpcHttpClient";
import {goerliRpcUrl} from "../../testParams";
import {IRpcPayload} from "../../../src/eth1/interface";

chai.use(chaiAsPromised);

describe("eth1 / jsonRpcHttpClient", function () {
  this.timeout("10 seconds");

  const port = 36421;
  const noMethodError = {code: -32601, message: "Method not found"};
  const notInSpecError = "JSON RPC Error not in spec";

  const testCases: {
    id: string;
    url?: string;
    payload?: IRpcPayload;
    requestListener?: http.RequestListener;
    abort?: true;
    error: any;
  }[] = [
    {
      id: "Bad domain",
      url: "https://goerli.fake-website.io",
      error: "getaddrinfo ENOTFOUND",
    },
    {
      id: "Bad subdomain",
      url: "https://fake-website.infura.io",
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
      error: "404 Not Found",
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
      id: "Abort request",
      abort: true,
      requestListener: () => {
        // leave the request open until aborted
      },
      error: "The user aborted a request",
    },
  ];

  const afterHooks: (() => Promise<void>)[] = [];

  afterEach(async function () {
    while (afterHooks.length) {
      const afterHook = afterHooks.pop();
      if (afterHook)
        await afterHook().catch((e) => {
          // eslint-disable-next-line no-console
          console.error("Error in afterEach hook", e);
        });
    }
  });

  for (const testCase of testCases) {
    const {id, requestListener, abort} = testCase;
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

      if (!url) url = goerliRpcUrl;
      if (!payload) payload = {method: "no-method", params: []};

      const eth1JsonRpcClient = new JsonRpcHttpClient(url);
      const controller = new AbortController();
      if (abort) setTimeout(() => controller.abort(), 50);
      await expect(eth1JsonRpcClient.fetch(payload, controller.signal)).to.be.rejectedWith(error);
    });
  }
});
