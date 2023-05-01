import {IBeaconChain} from "../../chain/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
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
      message.propagationSource.toString(),
      message.seenTimestampSec,
      message.msgSlot
    );

    if (message.startProcessUnixSec !== null) {
      this.metrics?.gossipValidationQueue.jobWaitTime.observe(
        {topic: message.topic.type},
        message.startProcessUnixSec - message.seenTimestampSec
      );
      this.metrics?.gossipValidationQueue.jobTime.observe(
        {topic: message.topic.type},
        Date.now() / 1000 - message.startProcessUnixSec
      );
    }

    // Use setTimeout to yield to the macro queue
    // This is mostly due to too many attestation messages, and a gossipsub RPC may
    // contain multiple of them. This helps avoid the I/O lag issue.
    setTimeout(
      () =>
        this.events.emit(
          NetworkEvent.gossipMessageValidationResult,
          message.msgId,
          message.propagationSource,
          acceptance
        ),
      0
    );
  }
}
