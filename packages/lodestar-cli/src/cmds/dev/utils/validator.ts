import {ApiClientOverInstance, IApiClient} from "@chainsafe/lodestar-validator/lib";
import {BeaconApi, ValidatorApi} from "@chainsafe/lodestar/lib/api/impl";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {ILogger} from "@chainsafe/lodestar-utils";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {NodeApi} from "@chainsafe/lodestar/lib/api/impl/node/node";
import {Eth1ForBlockProductionDisabled} from "@chainsafe/lodestar/lib/eth1";

export function getValidatorApiClient(url: string, logger: ILogger, node: BeaconNode): IApiClient {
  if (url === "memory") {
    return new ApiClientOverInstance({
      config: node.config,
      validator: new ValidatorApi({}, {...node, logger, eth1: new Eth1ForBlockProductionDisabled()}),
      node: new NodeApi({}, {...node}),
      beacon: new BeaconApi({}, {...node}),
    });
  } else {
    return new ApiClientOverRest(node.config, url, logger);
  }
}
