import {INodeApi} from "./interface";
import {ApiNamespace, IApiModules} from "../../index";
import {IApiOptions} from "../../options";
import {NodeIdentity, NodePeer} from "../../types";
import {SyncingStatus} from "@chainsafe/lodestar-types";
import {INetwork} from "../../../network";
import {getPeerState} from "./utils";
import {IBeaconSync} from "../../../sync";
import {createKeypairFromPeerId} from "@chainsafe/discv5/lib";

export class NodeApi implements INodeApi {
  public namespace = ApiNamespace.NODE;

  private readonly network: INetwork;
  private readonly sync: IBeaconSync;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "network"|"sync">) {
    this.namespace = ApiNamespace.BEACON;
    this.network = modules.network;
    this.sync = modules.sync;
  }

  public async getNodeIdentity(): Promise<NodeIdentity> {
    const enr = this.network.getEnr();
    const keypair = createKeypairFromPeerId(this.network.peerId);
    return {
      peerId: this.network.peerId.toB58String(),
      enr: enr?.encodeTxt(keypair.privateKey) || "",
      discoveryAddresses: [enr?.multiaddrTCP?.toString(), enr?.multiaddrUDP?.toString()].filter(v => !!v),
      p2pAddresses: this.network.multiaddrs.map((m) => m.toString()),
      metadata: this.network.metadata
    };
  }

  public async getNodeStatus(): Promise<"ready" | "syncing" | "error"> {
    return (await this.sync.isSynced()) ? "ready" : "syncing";
  }

  public async getPeer(peerId: string): Promise<NodePeer|null> {
    return (await this.getPeers()).find((peer) => peer.peerId === peerId) || null;
  }

  public async getPeers(): Promise<NodePeer[]> {
    return this.network.getPeers().map((peer) => {
      const conn = this.network.getPeerConnection(peer);
      return {
        peerId: peer.toB58String(),
        //TODO: figure out how to get enr of peer
        enr: "",
        address: conn.remoteAddr.toString(),
        direction: conn.stat.direction,
        state: getPeerState(conn.stat.status)
      };
    });
  }

  public async getSyncingStatus(): Promise<SyncingStatus> {
    return this.sync.getSyncStatus();
  }

  public async getVersion(): Promise<string> {
    return `Lodestar/${process.env.npm_package_version || "dev"}`;
  }

}
