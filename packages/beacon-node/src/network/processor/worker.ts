import {IBeaconChain} from "../../chain/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {NetworkEvent, NetworkEventBus, ReprocessGossipMessageType} from "../events.js";
import {GossipHandlers, GossipValidatorFn} from "../gossip/interface.js";
import {getGossipHandlers, GossipHandlerOpts, ValidatorFnsModules} from "./gossipHandlers.js";
import {getGossipValidatorFn, ValidatorFnModules} from "./gossipValidatorFn.js";
import {PendingGossipsubMessage} from "./types.js";

export type NetworkWorkerModules = ValidatorFnsModules &
  ValidatorFnModules & {
    chain: IBeaconChain;
    events: NetworkEventBus;
    metrics: Metrics | null;
    // Optionally pass custom GossipHandlers, for testing
    gossipHandlers?: GossipHandlers;
  };

export class NetworkWorker {
  private readonly events: NetworkEventBus;
  private readonly metrics: Metrics | null;
  private readonly gossipValidatorFn: GossipValidatorFn;

  constructor(modules: NetworkWorkerModules, opts: GossipHandlerOpts) {
    this.events = modules.events;
    this.metrics = modules.metrics;
    this.gossipValidatorFn = getGossipValidatorFn(modules.gossipHandlers ?? getGossipHandlers(modules, opts), modules);
  }

  async processPendingGossipsubMessage(message: PendingGossipsubMessage): Promise<void> {
    message.startProcessUnixSec = Date.now() / 1000;

    const acceptance = await this.gossipValidatorFn(
      message.topic,
      message.msg,
      // gossipObject is only available on 2nd validation
      message.gossipObject,
      message.propagationSource.toString(),
      message.seenTimestampSec
    );

    if (acceptance.type === "done") {
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

      this.events.emit(
        NetworkEvent.gossipMessageValidationResult,
        message.msgId,
        message.propagationSource,
        acceptance.result
      );
    } else if (acceptance.type === "retryUnknownBlock") {
      // we don't have to deserialize to gossip object the next time
      message.gossipObject = acceptance.gossipObject;
      this.events.emit(NetworkEvent.reprocessGossipsubMessage, message, ReprocessGossipMessageType.unknownBlock);
    }
  }
}
