import {INetwork} from "..";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import PeerId from "peer-id";
import {findMissingSubnets, gossipPeersToDisconnect, syncPeersToDisconnect} from "../peers/utils";

export interface IDiversifyPeersModules {
  network: INetwork;
  logger: ILogger;
}

/*
 ** A task to run periodically to make sure we have at least one peer per subnet
 ** so we can spread all attestations to the network and let them be aggregated in the end.
 ** Also, we want this task to prune useless peers.
 */
export class DiversifyPeersBySubnetTask {
  private readonly config: IBeaconConfig;
  private readonly network: INetwork;

  private readonly logger: ILogger;
  private testInterval?: NodeJS.Timeout;
  private isSynced: boolean;

  public constructor(config: IBeaconConfig, modules: IDiversifyPeersModules) {
    this.config = config;
    this.network = modules.network;
    this.logger = modules.logger;
    this.isSynced = false;
  }

  public async start(): Promise<void> {
    this.testInterval = setInterval(
      this.run,
      1 * this.config.params.SLOTS_PER_EPOCH * this.config.params.SECONDS_PER_SLOT * 1000
    );
  }

  public async stop(): Promise<void> {
    if (this.testInterval) {
      clearInterval(this.testInterval);
    }
  }

  public async handleSyncCompleted(): Promise<void> {
    this.isSynced = true;
  }

  public run = async (): Promise<void> => {
    this.logger.info("Running DiversifyPeersBySubnetTask");
    this.logger.profile("DiversifyPeersBySubnetTask");
    const missingSubnets = this.isSynced ? findMissingSubnets(this.network) : [];
    if (missingSubnets.length > 0) {
      this.logger.verbose("Searching peers for missing subnets", {missingSubnets});
    } else {
      this.logger.info(
        this.isSynced
          ? "Our peers subscribed to all subnets!"
          : "Node not synced, no need to search for missing subnets"
      );
    }
    const toDiscPeers: PeerId[] = this.isSynced
      ? gossipPeersToDisconnect(this.network, missingSubnets.length, this.network.getMaxPeer()) || []
      : syncPeersToDisconnect(this.network) || [];
    if (toDiscPeers.length > 0) {
      this.logger.verbose("Disconnecting peers to find new peers", {
        peersToDisconnect: toDiscPeers.length,
        peersToConnect: missingSubnets.length,
      });
      try {
        await Promise.all(toDiscPeers.map((peer) => this.network.disconnect(peer)));
      } catch (e) {
        this.logger.warn("Cannot disconnect peers", {error: e.message});
      }
    }
    await Promise.all(
      missingSubnets.map(async (subnet) => {
        try {
          await this.network.searchSubnetPeers(String(subnet));
        } catch (e) {
          this.logger.warn("Cannot connect to peers on subnet", {subnet, error: e.message});
        }
      })
    );
    this.logger.profile("DiversifyPeersBySubnetTask");
  };
}
