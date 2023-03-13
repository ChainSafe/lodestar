import http from "node:http";
import https from "node:https";
import url from "node:url";
import httpProxy from "http-proxy";
import {NetworkName} from "@lodestar/config/networks";
import {Logger} from "@lodestar/utils";
import {LightNode} from "./interfaces.js";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";
import {processAndVerifyRequest} from "./utils/execution.js";
import {logRequest} from "./utils/logger.js";
import {generateRPCResponseForPayload} from "./utils/json_rpc.js";
import {fetchRequestPayload, fetchResponseBody} from "./utils/req_resp.js";

export type VerifiedProxyOptions = {
  network: NetworkName;
  executionRpcUrl: string;
  logger: Logger;
  checkpoint?: string;
} & ({mode: LightNode.Rest; urls: string[]} | {mode: LightNode.P2P; bootnodes: string[]});

export function createVerifiedExecutionProxy(
  opts: VerifiedProxyOptions
): {server: http.Server; proofProvider: ProofProvider} {
  const {executionRpcUrl: executionUrl, logger, network} = opts;
  const controller = new AbortController();

  const proofProvider = ProofProvider.init({
    ...opts,
    network: network,
    signal: controller.signal,
  });

  const proxy = httpProxy.createProxy({
    target: executionUrl,
    ws: executionUrl.startsWith("ws"),
    agent: https.globalAgent,
    xfwd: true,
    ignorePath: true,
    changeOrigin: true,
  });

  let proxyServerListeningAddress: {host: string; port: number} | undefined;

  function handler(payload: ELRequestPayload): Promise<ELResponse | undefined> {
    return new Promise((resolve, reject) => {
      if (!proxyServerListeningAddress) return reject(new Error("Proxy server not listening"));
      const req = http.request(
        {
          method: "POST",
          path: "/proxy",
          port: proxyServerListeningAddress.port,
          host: proxyServerListeningAddress.host,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
          },
        },
        (res) => {
          fetchResponseBody(res).then(resolve).catch(reject);
        }
      );
      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  const proxyServer = http.createServer(function proxyRequestHandler(req, res) {
    if (req.url === "/proxy") {
      proxy.web(req, res);
      return;
    }

    let payload: ELRequestPayload;
    fetchRequestPayload(req)
      .then((data) => {
        payload = data;
        logRequest({payload, logger});
        return processAndVerifyRequest({payload, proofProvider, handler});
      })
      .then((response) => {
        res.write(JSON.stringify(response));
        res.end();
      })
      .catch((err) => {
        res.write(JSON.stringify(generateRPCResponseForPayload(payload, undefined, {message: (err as Error).message})));
        res.end();
      });
  });

  proxyServer.on("listening", () => {
    const address = proxyServer.address();

    if (address === null) {
      throw new Error("Invalid proxy server address");
    }

    if (typeof address === "string") {
      const rawUrl = url.parse(address);
      if (!rawUrl.host || !rawUrl.port || !rawUrl.protocol) {
        throw new Error(`Invalid proxy server address: ${address}`);
      }
      proxyServerListeningAddress = {host: rawUrl.host, port: parseInt(rawUrl.port)};
    } else {
      proxyServerListeningAddress = {host: address.address, port: address.port};
    }

    logger.info(
      `Lodestar Prover Proxy listening on ${proxyServerListeningAddress.host}:${proxyServerListeningAddress.port}`
    );
  });

  proxyServer.on("upgrade", function proxyRequestUpgrade(req, socket, head) {
    proxy.ws(req, socket, head);
  });

  controller.signal.addEventListener("abort", () => {
    proxyServer.close();
  });

  return {server: proxyServer, proofProvider};
}
