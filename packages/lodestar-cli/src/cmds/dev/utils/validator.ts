import {ApiClientOverInstance, IApiClient} from "@chainsafe/lodestar-validator/lib";
import {BeaconApi, EventsApi, ValidatorApi} from "@chainsafe/lodestar/lib/api/impl";
import {BeaconNode} from "@chainsafe/lodestar";
import {ILogger} from "@chainsafe/lodestar-utils";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {NodeApi} from "@chainsafe/lodestar/lib/api/impl/node/node";
import {Eth1ForBlockProductionDisabled} from "@chainsafe/lodestar/lib/eth1";
import {IEventsApi} from "@chainsafe/lodestar-validator/lib/api/interface/events";
import {ConfigApi} from "@chainsafe/lodestar/lib/api/impl/config";

export function getValidatorApiClient(url: string, logger: ILogger, node: BeaconNode): IApiClient {
  if (url === "memory") {
    return new ApiClientOverInstance({
      config: node.config,
      validator: new ValidatorApi({}, {...node, logger, eth1: new Eth1ForBlockProductionDisabled()}),
      node: new NodeApi({}, {...node}),
      beacon: new BeaconApi({}, {...node}),
      events: new EventsApi({}, {...node}) as IEventsApi,
      configApi: new ConfigApi({}, {config: node.config}),
    });
  } else {
    return new ApiClientOverRest(node.config, url, logger);
  }
}
