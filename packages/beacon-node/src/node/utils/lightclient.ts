import {LightClientServer} from "../../chain/lightClient/index.js";

export function assertLightClientServer(server: LightClientServer | undefined): asserts server is LightClientServer {
  if (!server) {
    throw Error("LightclientServer is not running on this node. To server this endpoint we need this");
  }
}
