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
      url: "https://goerli.wrongurl.io",
      error: "getaddrinfo ENOTFOUND",
    },
    {
      id: "Bad subdomain",
      url: "https://goerli2.infura.io",
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
        res.statusCode = 200;
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
      id: "Bad payload method",
      payload: {method: "eth_getLogs2", params: []},
      error: "The method eth_getLogs2 does not exist/is not available",
    },
    {
      id: "Bad payload param",
      payload: {method: "eth_getLogs", params: ["WRONG_PARAM"]},
      error: "cannot unmarshal string into Go value of type eth.params",
    },
    {
      id: "Abort request",
      abort: true,
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
    const {id, requestListener, abort, error} = testCase;
    let {url, payload} = testCase;

    it(id, async function () {
      if (requestListener) {
        if (!url) url = `http://localhost:${port}`;

        const server = http.createServer(requestListener);
        await new Promise((resolve) => server.listen(port, resolve));
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
      if (!payload) payload = {method: "", params: []};

      const eth1JsonRpcClient = new JsonRpcHttpClient(url);
      const controller = new AbortController();
      if (abort) setTimeout(() => controller.abort(), 50);
      await expect(eth1JsonRpcClient.fetch(payload, controller.signal)).to.be.rejectedWith(error);
    });
  }
});
