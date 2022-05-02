import {Api, routes} from "@chainsafe/lodestar-api";
import {AbortController} from "@chainsafe/abort-controller";
import {createIBeaconConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {Epoch} from "@chainsafe/lodestar-types";
import {Genesis} from "@chainsafe/lodestar-types/phase0";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Clock, extendError} from "./util";

export type ValidatorMonitorOptions = {
  api: Api;
  logger: ILogger;
  config: IChainForkConfig;
};

enum Status {
  running,
  stopped,
}

type State = {status: Status.running; controller: AbortController} | {status: Status.stopped};

/**
 * This helps monitor performance of validators by periodically polling prepareBeaconCommitteeSubnet
 */
export class ValidatorMonitor {
  private api: Api;
  private logger: ILogger;
  private clock: Clock;
  private state: State = {status: Status.stopped};

  constructor(opts: ValidatorMonitorOptions, readonly genesis: Genesis, readonly validatorIndexes: number[]) {
    this.api = opts.api;
    this.logger = opts.logger;
    const config = createIBeaconConfig(opts.config, genesis.genesisValidatorsRoot);
    this.clock = new Clock(config, opts.logger, {genesisTime: Number(genesis.genesisTime)});
    this.clock.runEveryEpoch(this.runDutiesTasks);
  }

  async start(): Promise<void> {
    if (this.state.status === Status.running) return;
    const controller = new AbortController();
    this.state = {status: Status.running, controller};
    const {signal} = controller;
    this.clock.start(signal);
  }

  async stop(): Promise<void> {
    if (this.state.status === Status.stopped) return;
    this.state.controller.abort();
    this.state = {status: Status.stopped};
  }

  private runDutiesTasks = async (epoch: Epoch): Promise<void> => {
    // Don't fetch duties for epochs before genesis. However, should fetch epoch 0 duties at epoch -1
    if (epoch < 0) {
      return;
    }

    const currentEpoch = epoch;
    const nextEpoch = epoch + 1;

    for (const epoch of [currentEpoch, nextEpoch]) {
      const attesterDuties = await this.api.validator
        .getAttesterDuties(epoch, this.validatorIndexes)
        .catch((e: Error) => {
          throw extendError(e, "Failed to obtain attester duty");
        });
      this.logger.info("Got duties", {epoch, numDuties: attesterDuties.data.length});
      const beaconCommitteeSubscriptions: routes.validator.BeaconCommitteeSubscription[] = [];
      for (const duty of attesterDuties.data) {
        beaconCommitteeSubscriptions.push({
          validatorIndex: duty.validatorIndex,
          committeesAtSlot: duty.committeesAtSlot,
          committeeIndex: duty.committeeIndex,
          slot: duty.slot,
          isAggregator: false,
        });
        this.logger.verbose(
          `Validator ${duty.validatorIndex} has attestation duty at slot ${duty.slot}, committee ${duty.committeeIndex}`
        );
      }
      if (beaconCommitteeSubscriptions.length > 0) {
        // TODO: Should log or throw?
        await this.api.validator.prepareBeaconCommitteeSubnet(beaconCommitteeSubscriptions).catch((e: Error) => {
          throw extendError(e, "Failed to subscribe to beacon committee subnets");
        });
        this.logger.info("Called prepareBeaconCommitteeSubnet api successfully", {
          epoch,
          subscriptions: beaconCommitteeSubscriptions.length,
        });
      }
    }
  };
}
