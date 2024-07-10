import {LightClientServer} from "../../chain/lightClient/index.js";

export function assertLightClientServer(server: LightClientServer | undefined): asserts server is LightClientServer {
  if (!server) {
    throw Error("Light client server is disabled");
  }
}
