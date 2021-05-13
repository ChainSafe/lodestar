import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {AbortSignal} from "abort-controller";
import {HttpClient} from "../../util";
import {IApiClientValidator} from "../interface";
import {BeaconApi} from "./beacon";
import {ConfigApi} from "./config";
import {EventsApi} from "./events";
import {NodeApi} from "./node";
import {ValidatorApi} from "./validator";

// eslint-disable-next-line @typescript-eslint/naming-convention
export function ApiClientOverRest(config: IBeaconConfig, baseUrl: string): IApiClientValidator {
  const client = new HttpClient({
    baseUrl: baseUrl,
    timeout: config.params.SECONDS_PER_SLOT * 1000,
  });

  return {
    beacon: BeaconApi(config.types, client),
    config: ConfigApi(config.types, client),
    node: NodeApi(config.types, client),
    events: EventsApi(config.types, client),
    validator: ValidatorApi(config.types, client),

    url: baseUrl,
    registerAbortSignal(signal: AbortSignal) {
      client.registerAbortSignal(signal);
    },
  };
}
