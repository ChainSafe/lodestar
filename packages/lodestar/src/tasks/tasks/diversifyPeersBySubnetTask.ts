import {INetwork} from "../../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IReputationStore} from "../../sync/IReputation";
import {findMissingSubnets, selectPeersToDisconnect} from "../../sync/utils/reputation";
import PeerId from "peer-id";

export interface IDiversifyPeersModules {
  network: INetwork;
  reps: IReputationStore;
  logger: ILogger;
}

/*
 ** A task to run periodically to make sure we have at least one peer per subnet
 ** so we can spread all attestations to the network and let them be aggregated in the end.
 */
export class DiversifyPeersBySubnetTask {
  private readonly config: IBeaconConfig;
  private readonly network: INetwork;
  private peerReputations: IReputationStore;

  private readonly logger: ILogger;
  private testInterval?: NodeJS.Timeout;

  public constructor(config: IBeaconConfig, modules: IDiversifyPeersModules) {
    this.config = config;
    this.network = modules.network;
    this.peerReputations = modules.reps;
    this.logger = modules.logger;
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

  public run = async (): Promise<void> => {
    this.logger.info("Running DiversifyPeersBySubnetTask");
    this.logger.profile("DiversifyPeersBySubnetTask");
    const missingSubnets = findMissingSubnets(this.peerReputations, this.network);
    if (missingSubnets.length > 0) {
      this.logger.verbose(`Search for ${missingSubnets.length} peers with subnets: ` + missingSubnets.join(","));
    } else {
      this.logger.info("Our peers subscribed to all subnets!");
      this.logger.profile("DiversifyPeersBySubnetTask");
      return;
    }
    const toDiscPeers: PeerId[] =
      selectPeersToDisconnect(this.network, missingSubnets.length, this.network.getMaxPeer(), this.peerReputations) ||
      [];
    if (toDiscPeers.length > 0) {
      this.logger.verbose(`Disconnecting ${toDiscPeers.length} peers to find ${missingSubnets.length} new peers`);
      try {
        await Promise.all(toDiscPeers.map((peer) => this.network.disconnect(peer)));
      } catch (e) {
        this.logger.warn("Cannot disconnect peers", e.message);
      }
    }
    await Promise.all(
      missingSubnets.map(async (subnet) => {
        try {
          await this.network.searchSubnetPeers(String(subnet));
        } catch (e) {
          this.logger.warn("Cannot connect to peers for subnet " + subnet, e.message);
        }
      })
    );
    this.logger.profile("DiversifyPeersBySubnetTask");
  };
}
