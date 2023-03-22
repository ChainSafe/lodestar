import {IBeaconChain} from "../../chain/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {NetworkEventBus} from "../events.js";
import {Eth2Gossipsub} from "../gossip/index.js";
import {GossipHandlers, GossipValidatorFn} from "../gossip/interface.js";
import {getGossipHandlers, GossipHandlerOpts, ValidatorFnsModules} from "./gossipHandlers.js";
import {getGossipValidatorFn, ValidatorFnModules} from "./gossipValidatorFn.js";
import {PendingGossipsubMessage} from "./types.js";

export type NetworkWorkerModules = ValidatorFnsModules &
  ValidatorFnModules & {
    chain: IBeaconChain;
    gossipsub: Eth2Gossipsub;
    events: NetworkEventBus;
    metrics: Metrics | null;
    // Optionally pass custom GossipHandlers, for testing
    gossipHandlers?: GossipHandlers;
  };

export class NetworkWorker {
  private readonly events: NetworkEventBus;
  private readonly metrics: Metrics | null;
  private readonly gossipsub: Eth2Gossipsub;
  private readonly gossipValidatorFn: GossipValidatorFn;

  constructor(modules: NetworkWorkerModules, opts: GossipHandlerOpts) {
    this.events = modules.events;
    this.metrics = modules.metrics;
    this.gossipsub = modules.gossipsub;
    this.gossipValidatorFn = getGossipValidatorFn(modules.gossipHandlers ?? getGossipHandlers(modules, opts), modules);
  }

  async processPendingGossipsubMessage(message: PendingGossipsubMessage): Promise<void> {
    message.startProcessUnixSec = Date.now() / 1000;

    const acceptance = await this.gossipValidatorFn(
      message.topic,
      message.msg,
      message.propagationSource.toString(),
      message.seenTimestampSec
    );

    if (message.startProcessUnixSec !== null) {
      this.metrics?.gossipValidationQueueJobWaitTime.observe(
        {topic: message.topic.type},
        message.startProcessUnixSec - message.seenTimestampSec
      );
      this.metrics?.gossipValidationQueueJobTime.observe(
        {topic: message.topic.type},
        Date.now() / 1000 - message.startProcessUnixSec
      );
    }

    this.gossipsub.reportMessageValidationResult(message.msgId, message.propagationSource, acceptance);
  }
}
