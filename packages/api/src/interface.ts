import {Api as BeaconApi} from "./routes/beacon";
import {Api as ConfigApi} from "./routes/config";
import {Api as DebugApi} from "./routes/debug";
import {Api as EventsApi} from "./routes/events";
import {Api as LightclientApi} from "./routes/lightclient";
import {Api as LodestarApi} from "./routes/lodestar";
import {Api as NodeApi} from "./routes/node";
import {Api as ValidatorApi} from "./routes/validator";

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
