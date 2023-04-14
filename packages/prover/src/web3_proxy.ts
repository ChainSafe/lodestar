import http from "node:http";
import https from "node:https";
import url from "node:url";
import httpProxy from "http-proxy";
import {NetworkName} from "@lodestar/config/networks";
import {ConsensusNodeOptions, LogOptions} from "./interfaces.js";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "./types.js";
import {generateRPCResponseForPayload} from "./utils/json_rpc.js";
import {getLogger} from "./utils/logger.js";
import {fetchRequestPayload, fetchResponseBody} from "./utils/req_resp.js";
import {processAndVerifyRequest} from "./utils/process.js";

export type VerifiedProxyOptions = {
  network: NetworkName;
  executionRpcUrl: string;
  wsCheckpoint?: string;
  signal?: AbortSignal;
} & LogOptions &
  ConsensusNodeOptions;

export function createVerifiedExecutionProxy(opts: VerifiedProxyOptions): {
  server: http.Server;
  proofProvider: ProofProvider;
} {
  const {executionRpcUrl, network} = opts;
  const signal = opts.signal ?? new AbortController().signal;
  const logger = getLogger(opts);

  const proofProvider = ProofProvider.init({
    ...opts,
    network,
    signal,
    logger,
  });

  logger.info("Creating http proxy", {url: executionRpcUrl});
  const proxy = httpProxy.createProxy({
    target: executionRpcUrl,
    ws: executionRpcUrl.startsWith("ws"),
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
          signal,
          headers: {
            "Content-Type": "application/json",
          },
        },
        (res) => {
          fetchResponseBody(res).then(resolve).catch(reject);
        }
      );
      logger.debug("Sending request to proxy endpoint", {method: payload.method});
      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  logger.info("Creating http server");
  const proxyServer = http.createServer(function proxyRequestHandler(req, res) {
    if (req.url === "/proxy") {
      logger.verbose("Forwarding request to execution layer");
      proxy.web(req, res);
      return;
    }

    let payload: ELRequestPayload;
    fetchRequestPayload(req)
      .then((data) => {
        payload = data;
        logger.debug("Received request", {method: payload.method});
        return processAndVerifyRequest({payload, proofProvider, handler, logger, network});
      })
      .then((response) => {
        logger.debug("Sending response", {method: payload.method});
        res.write(JSON.stringify(response));
        res.end();
      })
      .catch((err) => {
        logger.error("Error processing request", {method: payload.method}, err);
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
    logger.debug("Upgrading the ws connection");
    proxy.ws(req, socket, head);
  });

  signal.addEventListener("abort", () => {
    proxyServer.close();
  });

  return {server: proxyServer, proofProvider};
}
