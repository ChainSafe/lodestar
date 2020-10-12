import {SyncingStatus} from "@chainsafe/lodestar-types";
import {createKeypairFromPeerId} from "@chainsafe/discv5";

import {NodeIdentity, NodePeer} from "../../types";
import {INetwork} from "../../../network";
import {IBeaconSync} from "../../../sync";

import {IApiOptions} from "../../options";
import {ApiNamespace, IApiModules} from "../interface";
import {getPeerState} from "./utils";
import {INodeApi} from "./interface";

export class NodeApi implements INodeApi {
  public namespace = ApiNamespace.NODE;

  private readonly network: INetwork;
  private readonly sync: IBeaconSync;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "network" | "sync">) {
    this.namespace = ApiNamespace.BEACON;
    this.network = modules.network;
    this.sync = modules.sync;
  }

  public async getNodeIdentity(): Promise<NodeIdentity> {
    const enr = this.network.getEnr();
    const keypair = createKeypairFromPeerId(this.network.peerId);
    const discoveryAddresses = [] as string[];
    if (enr?.getLocationMultiaddr("tcp")) discoveryAddresses.push(enr?.getLocationMultiaddr("tcp")?.toString()!);
    if (enr?.getLocationMultiaddr("udp")) discoveryAddresses.push(enr?.getLocationMultiaddr("udp")?.toString()!);
    return {
      peerId: this.network.peerId.toB58String(),
      enr: enr?.encodeTxt(keypair.privateKey) || "",
      discoveryAddresses,
      p2pAddresses: this.network.localMultiaddrs.map((m) => m.toString()),
      metadata: this.network.metadata,
    };
  }

  public async getNodeStatus(): Promise<"ready" | "syncing" | "error"> {
    return (await this.sync.isSynced()) ? "ready" : "syncing";
  }

  public async getPeer(peerId: string): Promise<NodePeer | null> {
    return (await this.getPeers()).find((peer) => peer.peerId === peerId) || null;
  }

  public async getPeers(): Promise<NodePeer[]> {
    const peers: NodePeer[] = [];
    for (const peer of this.network.getPeers({connected: true})) {
      const conn = this.network.getPeerConnection(peer.id);
      if (conn) {
        peers.push({
          peerId: peer.id.toB58String(),
          //TODO: figure out how to get enr of peer
          enr: "",
          address: conn.remoteAddr.toString(),
          direction: conn.stat.direction,
          state: getPeerState(conn.stat.status),
        });
      }
    }
    return peers;
  }

  public async getSyncingStatus(): Promise<SyncingStatus> {
    return this.sync.getSyncStatus();
  }

  public async getVersion(): Promise<string> {
    return `Lodestar/${process.env.npm_package_version || "dev"}`;
  }
}
