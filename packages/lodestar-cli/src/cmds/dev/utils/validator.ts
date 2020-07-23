import {ApiClientOverInstance, IApiClient} from "@chainsafe/lodestar-validator/lib";
import {BeaconApi, ValidatorApi} from "@chainsafe/lodestar/lib/api/impl";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {ILogger} from "@chainsafe/lodestar-utils";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {NodeApi} from "@chainsafe/lodestar/lib/api/impl/node/node";

export function getValidatorApiClient(url: string, logger: ILogger, node: BeaconNode): IApiClient {

  if(url === "memory") {
    return new ApiClientOverInstance({
      config: node.config,
      validator: new ValidatorApi({}, {...node, logger}),
      node: new NodeApi({}, {...node}),
      beacon: new BeaconApi({}, {...node}),
    });
  } else {
    return new ApiClientOverRest(node.config, url, logger);
  }

}
