import {LCTransport} from "../../../interfaces.js";
import {createVerifiedExecutionProxy, VerifiedProxyOptions} from "../../../web3_proxy.js";
import {stdLogger} from "../../../utils/logger.js";
import {parseStartArgs, StartArgs} from "./options.js";

/**
 * Runs a beacon node.
 */
export async function proverProxyStartHandler(args: StartArgs): Promise<void> {
  const {
    network,
    transport,
    beaconBootnodes: beaconBootNodes,
    executionUrl: executionRpcUrl,
    beaconUrls: beaconRpcUrls,
    port,
    wsCheckpoint,
  } = parseStartArgs(args);
  const options: VerifiedProxyOptions = {
    logger: stdLogger,
    network,
    executionRpcUrl,
    wsCheckpoint,
    ...(transport === LCTransport.Rest
      ? {transport: LCTransport.Rest, urls: beaconRpcUrls}
      : {transport: LCTransport.P2P, bootnodes: beaconBootNodes}),
  };

  const {server, proofProvider} = createVerifiedExecutionProxy(options);

  server.listen(port);

  await proofProvider.waitToBeReady();
}
