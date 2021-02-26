import {phase0} from "@chainsafe/lodestar-types";
import {createKeypairFromPeerId} from "@chainsafe/discv5";

import {NodeIdentity, NodePeer} from "../../types";
import {INetwork, PeerDirection, PeerState} from "../../../network";
import {IBeaconSync} from "../../../sync";

import {IApiOptions} from "../../options";
import {ApiNamespace, IApiModules} from "../interface";
import {formatNodePeer} from "./utils";
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
    const discoveryAddresses = [
      enr?.getLocationMultiaddr("tcp")?.toString() ?? null,
      enr?.getLocationMultiaddr("udp")?.toString() ?? null,
    ].filter((addr): addr is string => Boolean(addr));

    return {
      peerId: this.network.peerId.toB58String(),
      enr: enr?.encodeTxt(keypair.privateKey) || "",
      discoveryAddresses,
      p2pAddresses: this.network.localMultiaddrs.map((m) => m.toString()),
      metadata: this.network.metadata,
    };
  }

  public async getNodeStatus(): Promise<"ready" | "syncing" | "error"> {
    return this.sync.isSynced() ? "ready" : "syncing";
  }

  public async getPeer(peerIdStr: string): Promise<NodePeer | null> {
    const connections = this.network.getConnectionsByPeer().get(peerIdStr);
    if (!connections) return null; // Node has not seen this peer
    return formatNodePeer(peerIdStr, connections);
  }

  public async getPeers(state?: PeerState[], direction?: PeerDirection[]): Promise<NodePeer[]> {
    return Array.from(this.network.getConnectionsByPeer().entries())
      .map(([peerIdStr, connections]) => formatNodePeer(peerIdStr, connections))
      .filter(
        (nodePeer) =>
          (!state || state.length === 0 || state.includes(nodePeer.state)) &&
          (!direction || direction.length === 0 || (nodePeer.direction && direction.includes(nodePeer.direction)))
      );
  }

  public async getSyncingStatus(): Promise<phase0.SyncingStatus> {
    return this.sync.getSyncStatus();
  }

  public async getVersion(): Promise<string> {
    return `Lodestar/${process.env.npm_package_version || "dev"}`;
  }
}
