import {LCTransport} from "../../../interfaces.js";
import {createVerifiedExecutionProxy, VerifiedProxyOptions} from "../../../web3_proxy.js";
import {GlobalArgs, parseGlobalArgs} from "../../options.js";
import {parseStartArgs, StartArgs} from "./options.js";

/**
 * Runs a beacon node.
 */
export async function proverProxyStartHandler(args: StartArgs & GlobalArgs): Promise<void> {
  const {network, logLevel} = parseGlobalArgs(args);
  const opts = parseStartArgs(args);
  const {executionRpcUrl, port, wsCheckpoint} = opts;

  const options: VerifiedProxyOptions = {
    logLevel,
    network,
    executionRpcUrl,
    wsCheckpoint,
    ...(opts.transport === LCTransport.Rest
      ? {transport: LCTransport.Rest, urls: opts.urls}
      : {transport: LCTransport.P2P, bootnodes: opts.bootnodes}),
  };

  const {server, proofProvider} = createVerifiedExecutionProxy(options);

  server.listen(port);

  await proofProvider.waitToBeReady();
}
