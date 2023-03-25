import {LCTransport} from "../../../interfaces.js";
import {createVerifiedExecutionProxy, VerifiedProxyOptions} from "../../../web3_proxy.js";
import {stdLogger} from "../../../utils/logger.js";
import {parseStartArgs, StartArgs} from "./options.js";

/**
 * Runs a beacon node.
 */
export async function proverProxyStartHandler(args: StartArgs): Promise<void> {
  const opts = parseStartArgs(args);
  const {network, executionRpcUrl, port, wsCheckpoint} = opts;
  const options: VerifiedProxyOptions = {
    logger: stdLogger,
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
