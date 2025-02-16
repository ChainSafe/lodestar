import {Endpoints as BeaconEndpoints} from "./beacon/index.js";
import {Endpoints as ConfigEndpoints} from "./config.js";
import {Endpoints as DebugEndpoints} from "./debug.js";
import {Endpoints as EventsEndpoints} from "./events.js";
import {Endpoints as LightclientEndpoints} from "./lightclient.js";
import {Endpoints as LodestarEndpoints} from "./lodestar.js";
import {Endpoints as NodeEndpoints} from "./node.js";
import {Endpoints as ProofEndpoints} from "./proof.js";
import {Endpoints as ValidatorEndpoints} from "./validator.js";

import * as beacon from "./beacon/index.js";
import * as config from "./config.js";
import * as debug from "./debug.js";
import * as events from "./events.js";
import * as lightclient from "./lightclient.js";
import * as lodestar from "./lodestar.js";
import * as node from "./node.js";
import * as proof from "./proof.js";
import * as validator from "./validator.js";
export {beacon, config, debug, events, lightclient, lodestar, node, proof, validator};

export type Endpoints = {
  beacon: BeaconEndpoints;
  config: ConfigEndpoints;
  debug: DebugEndpoints;
  events: EventsEndpoints;
  lightclient: LightclientEndpoints;
  lodestar: LodestarEndpoints;
  node: NodeEndpoints;
  proof: ProofEndpoints;
  validator: ValidatorEndpoints;
};
