import {phase0} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/index.js";
import {Metrics} from "../../metrics/index.js";
import {GossipHandlerOpts} from "../gossip/handlers/index.js";
import {AttnetsService} from "../subnets/index.js";

export type NetworkImporterModules = {
  attnetsService: AttnetsService;
  chain: IBeaconChain;
  logger: Logger;
  metrics: Metrics | null;
  options: GossipHandlerOpts;
};

export class NetworkImporter {
  private readonly attnetsService: AttnetsService;
  private readonly chain: IBeaconChain;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private readonly options: GossipHandlerOpts;

  constructor(modules: NetworkImporterModules) {
    this.attnetsService = modules.attnetsService;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.options = modules.options;
  }

  importGossipAttestation(
    attestation: phase0.Attestation,
    indexedAttestation: phase0.IndexedAttestation,
    subnet: number,
    seenTimestampSec: number
  ): void {
    this.metrics?.registerGossipUnaggregatedAttestation(seenTimestampSec, indexedAttestation);

    // Node may be subscribe to extra subnets (long-lived random subnets). For those, validate the messages
    // but don't import them, to save CPU and RAM
    if (!this.attnetsService.shouldProcess(subnet, attestation.data.slot)) {
      return;
    }

    try {
      const insertOutcome = this.chain.attestationPool.add(attestation);
      this.metrics?.opPool.attestationPoolInsertOutcome.inc({insertOutcome});
    } catch (e) {
      this.logger.error("Error adding unaggregated attestation to pool", {subnet}, e as Error);
    }

    if (!this.options.dontSendGossipAttestationsToForkchoice) {
      try {
        this.chain.forkChoice.onAttestation(indexedAttestation);
      } catch (e) {
        this.logger.debug("Error adding gossip unaggregated attestation to forkchoice", {subnet}, e as Error);
      }
    }
  }
}
