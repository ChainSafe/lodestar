import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkPostAltair, isForkPostGloas} from "@lodestar/params";

/** Duties that consume a slot's critical-path work */
export enum ConsumerTarget {
  attestationDue = "attestation_due",
  aggregateDue = "aggregate_due",
  syncMessageDue = "sync_message_due",
  contributionDue = "contribution_due",
  payloadDue = "payload_due",
  payloadAttestationDue = "payload_attestation_due",
}

/** Each consumer target in ms from the slot start, null where the fork has no such duty */
export type ConsumerTargetsMs = Record<ConsumerTarget, number | null>;

export function getConsumerTargetsMs(config: ChainForkConfig, fork: ForkName): ConsumerTargetsMs {
  const altair = isForkPostAltair(fork);
  const gloas = isForkPostGloas(fork);
  return {
    [ConsumerTarget.attestationDue]: config.getAttestationDueMs(fork),
    [ConsumerTarget.aggregateDue]: config.getAggregateDueMs(fork),
    [ConsumerTarget.syncMessageDue]: altair ? config.getSyncMessageDueMs(fork) : null,
    [ConsumerTarget.contributionDue]: altair ? config.getSyncContributionDueMs(fork) : null,
    [ConsumerTarget.payloadDue]: gloas ? config.getPayloadDueMs() : null,
    [ConsumerTarget.payloadAttestationDue]: gloas
      ? config.getSlotComponentDurationMs(config.PAYLOAD_ATTESTATION_DUE_BPS)
      : null,
  };
}
