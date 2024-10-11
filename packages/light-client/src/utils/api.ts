import {getClient, ApiClient, ApiRequestInit} from "@lodestar/api";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";

export function getApiFromUrl(url: string, network: NetworkName, init?: ApiRequestInit): ApiClient {
  if (!(network in networksChainConfig)) {
    throw Error(`Invalid network name "${network}". Valid options are: ${Object.keys(networksChainConfig).join()}`);
  }

  return getClient({urls: [url], globalInit: init}, {config: createChainForkConfig(networksChainConfig[network])});
}

export function getChainForkConfigFromNetwork(network: NetworkName): ChainForkConfig {
  if (!(network in networksChainConfig)) {
    throw Error(`Invalid network name "${network}". Valid options are: ${Object.keys(networksChainConfig).join()}`);
  }

  return createChainForkConfig(networksChainConfig[network]);
}
