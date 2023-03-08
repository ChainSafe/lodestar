import {LightNode} from "../../../interfaces.js";
import {createVerifiedExecutionProxy, VerifiedProxyOptions} from "../../../web3_proxy.js";
import {stdLogger} from "../../../utils/logger.js";
import {parseStartArgs, StartArgs} from "./options.js";

/**
 * Runs a beacon node.
 */
export async function startHandler(args: StartArgs): Promise<void> {
  const {network, mode, beaconBootNodes, executionRpcUrl, beaconRpcUrls: beaconRpcUrls, port} = parseStartArgs(args);
  const options: VerifiedProxyOptions = {
    logger: stdLogger,
    network,
    executionRpcUrl,
    ...(mode === LightNode.Rest
      ? {mode: LightNode.Rest, urls: beaconRpcUrls}
      : {mode: LightNode.P2P, bootnodes: beaconBootNodes}),
  };

  const {server, proofProvider} = createVerifiedExecutionProxy(options);

  server.listen(port);

  await proofProvider.sync();
}
