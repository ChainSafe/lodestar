import {Api as BeaconApi} from "./beacon/routes/beacon/index.js";
import {Api as ConfigApi} from "./beacon/routes/config.js";
import {Api as DebugApi} from "./beacon/routes/debug.js";
import {Api as EventsApi} from "./beacon/routes/events.js";
import {Api as LightclientApi} from "./beacon/routes/lightclient.js";
import {Api as LodestarApi} from "./beacon/routes/lodestar.js";
import {Api as NodeApi} from "./beacon/routes/node.js";
import {Api as ValidatorApi} from "./beacon/routes/validator.js";

export type Api = {
  beacon: BeaconApi;
  config: ConfigApi;
  debug: DebugApi;
  events: EventsApi;
  lightclient: LightclientApi;
  lodestar: LodestarApi;
  node: NodeApi;
  validator: ValidatorApi;
};

// Declare namespaces for CLI options
export type ApiNamespace = keyof Api;
const allNamespacesObj: {[K in keyof Api]: true} = {
  beacon: true,
  config: true,
  debug: true,
  events: true,
  lightclient: true,
  lodestar: true,
  node: true,
  validator: true,
};
export const allNamespaces = Object.keys(allNamespacesObj) as ApiNamespace[];
