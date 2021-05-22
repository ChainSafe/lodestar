import Multiaddr from "multiaddr";
import PeerId from "peer-id";
import {IDebugBeaconApi} from "./beacon/interface";

export interface IDebugApi {
  beacon: IDebugBeaconApi;

  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void>;
  disconnectPeer(peer: PeerId): Promise<void>;
}
