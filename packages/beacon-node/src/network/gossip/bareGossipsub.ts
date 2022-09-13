/* eslint-disable @typescript-eslint/naming-convention */
import Libp2p from "libp2p";
import GossipsubDefault from "libp2p-gossipsub";
// TODO remove once Gossipsub goes ESM
const Gossipsub = ((GossipsubDefault as unknown) as {default: unknown}).default as typeof GossipsubDefault;
import {GossipsubMessage, MessageAcceptance, SignaturePolicy} from "libp2p-gossipsub/src/types.js";
import {PeerScoreParams} from "libp2p-gossipsub/src/score/index.js";
import PeerId from "peer-id";
import {MetricsRegister} from "libp2p-gossipsub/src/metrics";
import {IBeaconConfig} from "@lodestar/config";
import {ILogger} from "@lodestar/utils";

import {RegistryMetricCreator} from "../../metrics/index.js";
import {PeersData} from "../peers/peersData.js";
import {GossipJobQueues, ValidatorFnsByType} from "./interface.js";
import {GossipTopicCache} from "./topic.js";
import {fastMsgIdFn, simpleMsgIdFn} from "./encoding.js";

import {gossipScoreThresholds, GOSSIP_D, GOSSIP_D_HIGH, GOSSIP_D_LOW} from "./scoringParameters.js";

/* eslint-disable @typescript-eslint/naming-convention */
/** As specified in https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md */
const GOSSIPSUB_HEARTBEAT_INTERVAL = 0.7 * 1000;

// TODO: Export this type
type GossipsubEvents = {
  "gossipsub:message": {
    propagationSource: PeerId;
    msgId: string;
    msg: GossipsubMessage;
  };
};

export type Eth2GossipsubModules = {
  libp2p: Libp2p;
  logger: ILogger;
  metricRegister?: RegistryMetricCreator;
};

export type Eth2GossipsubOpts = {
  allowPublishToZeroPeers?: boolean;
  metricsTopicStrToLabel: Map<string, string>;
};

/**
 * Wrapper around js-libp2p-gossipsub with the following extensions:
 * - Eth2 message id
 * - Emits `GossipObject`, not `InMessage`
 * - Provides convenience interface:
 *   - `publishObject`
 *   - `subscribeTopic`
 *   - `unsubscribeTopic`
 *   - `handleTopic`
 *   - `unhandleTopic`
 *
 * See https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
 */
export class BareGossipsub extends Gossipsub {
  private readonly logger: ILogger;

  constructor(modules: Eth2GossipsubModules, opts: Eth2GossipsubOpts) {
    // Gossipsub parameters defined here:
    // https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
    super(modules.libp2p, {
      gossipIncoming: true,
      globalSignaturePolicy: SignaturePolicy.StrictNoSign,
      allowPublishToZeroPeers: opts.allowPublishToZeroPeers,
      D: GOSSIP_D,
      Dlo: GOSSIP_D_LOW,
      Dhi: GOSSIP_D_HIGH,
      Dlazy: 6,
      heartbeatInterval: GOSSIPSUB_HEARTBEAT_INTERVAL,
      fanoutTTL: 60 * 1000,
      mcacheLength: 6,
      mcacheGossip: 3,
      seenTTL: 550 * GOSSIPSUB_HEARTBEAT_INTERVAL,
      scoreThresholds: gossipScoreThresholds,
      // the default in gossipsub is 3s is not enough since lodestar suffers from I/O lag
      gossipsubIWantFollowupMs: 12 * 1000, // 12s
      fastMsgIdFn: fastMsgIdFn,
      msgIdFn: simpleMsgIdFn,
      // Use the bellatrix max size if the merge is configured. pre-merge using this size
      // could only be an issue on outgoing payloads, its highly unlikely we will send out
      // a chunk bigger than GOSSIP_MAX_SIZE pre merge even on mainnet network.
      //
      // TODO: figure out a way to dynamically transition to the size
      dataTransform: undefined,
      metricsRegister: (modules.metricRegister as unknown) as MetricsRegister,
      metricsTopicStrToLabel: opts.metricsTopicStrToLabel,
      asyncValidation: true,
    });

    this.logger = modules.logger;
    this.on("gossipsub:message", this.onGossipsubMessage.bind(this));
  }

  private onGossipsubMessage(event: GossipsubEvents["gossipsub:message"]): void {
    const {propagationSource, msgId, msg} = event;

    // just for debug
    // this.logger.info("onGossipsubMessage", {
    //   propagationSource: propagationSource.toString(),
    //   msgId,
    //   msg: msg.data.length,
    // });
    this.reportMessageValidationResult(msgId, propagationSource, MessageAcceptance.Accept);
  }
}
