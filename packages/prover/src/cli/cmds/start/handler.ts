import {ChainConfig, chainConfigFromJson} from "@lodestar/config";
import {readFile} from "../../../utils/file.js";
import {VerifiedProxyOptions, createVerifiedExecutionProxy} from "../../../web3_proxy.js";
import {GlobalArgs, parseGlobalArgs} from "../../options.js";
import {StartArgs, parseStartArgs} from "./options.js";

/**
 * Runs a beacon node.
 */
export async function proverProxyStartHandler(args: StartArgs & GlobalArgs): Promise<void> {
  const {network, logLevel, paramsFile} = parseGlobalArgs(args);
  const opts = parseStartArgs(args);

  const config: Partial<ChainConfig> = paramsFile ? chainConfigFromJson(readFile(paramsFile)) : {};

  const options: VerifiedProxyOptions = {
    ...opts,
    logLevel,
    ...(network ? {network} : {config}),
  };

  const {server, proofProvider} = createVerifiedExecutionProxy(options);

  server.listen(opts.port);

  await proofProvider.waitToBeReady();
}
