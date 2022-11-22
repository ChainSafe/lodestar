import {Libp2p} from "libp2p";
import {PeersData} from "@lodestar/reqresp/peers/peersData";

export interface ReqRespLightClientModules {
  libp2p: Libp2p;
  peersData: PeersData;
}

export enum ReqRespMethod {
  BeaconBlocksByRoot = "beacon_blocks_by_root",
  LightClientBootstrap = "light_client_bootstrap",
  LightClientUpdatesByRange = "light_client_updates_by_range",
  LightClientFinalityUpdate = "light_client_finality_update",
  LightClientOptimisticUpdate = "light_client_optimistic_update",
}
