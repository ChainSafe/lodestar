import Multiaddr from "multiaddr";
import PeerId from "peer-id";
import {IApiOptions} from "../../options";
import {IApiModules} from "../interface";
import {DebugBeaconApi} from "./beacon";
import {IDebugBeaconApi} from "./beacon/interface";
import {IDebugApi} from "./interface";

export class DebugApi implements IDebugApi {
  beacon: IDebugBeaconApi;

  constructor(
    opts: Partial<IApiOptions>,
    private readonly modules: Pick<IApiModules, "config" | "logger" | "chain" | "db" | "network">
  ) {
    this.beacon = new DebugBeaconApi(opts, modules);
  }

  async connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    await this.modules.network.connectToPeer(peer, multiaddr);
  }

  async disconnectPeer(peer: PeerId): Promise<void> {
    await this.modules.network.disconnectPeer(peer);
  }
}
