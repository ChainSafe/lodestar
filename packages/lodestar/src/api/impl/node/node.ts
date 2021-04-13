import {phase0} from "@chainsafe/lodestar-types";
import {createKeypairFromPeerId} from "@chainsafe/discv5";

import {NodeIdentity, NodePeer} from "../../types";
import {INetwork, PeerDirection, PeerState} from "../../../network";
import {IBeaconSync} from "../../../sync";

import {IApiOptions} from "../../options";
import {ApiNamespace, IApiModules} from "../interface";
import {formatNodePeer} from "./utils";
import {INodeApi} from "./interface";
import {ApiError} from "../errors";

export class NodeApi implements INodeApi {
  namespace = ApiNamespace.NODE;

  private readonly network: INetwork;
  private readonly sync: IBeaconSync;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "network" | "sync">) {
    this.namespace = ApiNamespace.BEACON;
    this.network = modules.network;
    this.sync = modules.sync;
  }

  async getNodeIdentity(): Promise<NodeIdentity> {
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

  async getNodeStatus(): Promise<"ready" | "syncing" | "error"> {
    return this.sync.isSynced() ? "ready" : "syncing";
  }

  async getPeer(peerIdStr: string): Promise<NodePeer> {
    const connections = this.network.getConnectionsByPeer().get(peerIdStr);
    if (!connections) {
      throw new ApiError(404, "Node has not seen this peer");
    }
    return formatNodePeer(peerIdStr, connections);
  }

  async getPeers(state?: PeerState[], direction?: PeerDirection[]): Promise<NodePeer[]> {
    return Array.from(this.network.getConnectionsByPeer().entries())
      .map(([peerIdStr, connections]) => formatNodePeer(peerIdStr, connections))
      .filter(
        (nodePeer) =>
          (!state || state.length === 0 || state.includes(nodePeer.state)) &&
          (!direction || direction.length === 0 || (nodePeer.direction && direction.includes(nodePeer.direction)))
      );
  }

  async getSyncingStatus(): Promise<phase0.SyncingStatus> {
    return this.sync.getSyncStatus();
  }

  async getVersion(): Promise<string> {
    return `Lodestar/${process.env.npm_package_version || "dev"}`;
  }
}
