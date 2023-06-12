import http from "node:http";
import https from "node:https";
import url from "node:url";
import httpProxy from "http-proxy";
import {getNodeLogger} from "@lodestar/logger/node";
import {LogLevel} from "@lodestar/logger";
import {VerifiedExecutionInitOptions} from "./interfaces.js";
import {ProofProvider} from "./proof_provider/proof_provider.js";
import {JsonRpcRequestPayload} from "./types.js";
import {getResponseForRequest, isBatchRequest} from "./utils/json_rpc.js";
import {fetchRequestPayload} from "./utils/req_resp.js";
import {processAndVerifyRequest} from "./utils/process.js";
import {ELRpc, createHttpHandler} from "./utils/rpc.js";

export type VerifiedProxyOptions = VerifiedExecutionInitOptions & {
  executionRpcUrl: string;
  requestTimeout: number;
};

export function createVerifiedExecutionProxy(opts: VerifiedProxyOptions): {
  server: http.Server;
  proofProvider: ProofProvider;
} {
  const {executionRpcUrl, requestTimeout} = opts;
  const signal = opts.signal ?? new AbortController().signal;
  const logger = opts.logger ?? getNodeLogger({level: opts.logLevel ?? LogLevel.info});

  const proofProvider = ProofProvider.init({
    ...opts,
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
  const rpc = new ELRpc(
    createHttpHandler({
      signal,
      info: () => {
        if (!proxyServerListeningAddress) {
          return "Proxy server not listening";
        }

        return {
          port: proxyServerListeningAddress.port,
          host: proxyServerListeningAddress.host,
          timeout: requestTimeout,
        };
      },
    }),
    logger
  );

  rpc.verifyCompatibility().catch((err) => {
    logger.error("Error verifying execution layer support", err);
    process.exit(1);
  });

  logger.info("Creating http server");
  const proxyServer = http.createServer(function proxyRequestHandler(req, res) {
    if (req.url === "/proxy") {
      logger.debug("Forwarding request to execution layer");
      proxy.web(req, res);
      return;
    }

    let payload: JsonRpcRequestPayload;
    fetchRequestPayload(req)
      .then((data) => {
        payload = data;
        return processAndVerifyRequest({payload, proofProvider, rpc, logger});
      })
      .then((response) => {
        res.write(JSON.stringify(response));
        res.end();
      })
      .catch((err) => {
        logger.error("Error processing request", err);
        const message = (err as Error).message;
        if (isBatchRequest(payload)) {
          res.write(JSON.stringify(payload.map((req) => getResponseForRequest(req, {message}))));
        } else {
          res.write(JSON.stringify(getResponseForRequest(payload, undefined, {message})));
        }

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
