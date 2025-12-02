import {ENR} from "@chainsafe/enr";
import {BeaconConfig} from "@lodestar/config";
import {IClock} from "../../util/clock.js";
import {ENRKey} from "../metadata.js";

export enum ENRRelevance {
  no_tcp = "no_tcp",
  no_eth2 = "no_eth2",
  // biome-ignore lint/style/useNamingConvention: Need to use the this name for network convention
  unknown_forkDigest = "unknown_forkDigest",
  current_fork_mismatch = "current_fork_mismatch",
  relevant = "relevant",
}

export function enrRelevance(enr: ENR, config: BeaconConfig, clock: IClock): ENRRelevance {
  // We are not interested in peers that don't advertise their tcp addr
  const multiaddrTCP = enr.getLocationMultiaddr(ENRKey.tcp);
  if (!multiaddrTCP) {
    return ENRRelevance.no_tcp;
  }

  // Check if the ENR.eth2 field matches and is of interest
  const eth2 = enr.kvs.get(ENRKey.eth2);
  if (!eth2) {
    return ENRRelevance.no_eth2;
  }

  // Fast de-serialization without SSZ
  const forkDigest = eth2.slice(0, 4);
  // Check if forkDigest matches any of our known forks.
  const {fork: forkName} = config.forkDigest2ForkBoundaryOption(forkDigest) ?? {};
  if (forkName === undefined) {
    return ENRRelevance.unknown_forkDigest;
  }

  // Check if fork digest's fork matches ours
  const currentSlot = clock.slotWithFutureTolerance(config.MAXIMUM_GOSSIP_CLOCK_DISPARITY / 1000);
  const localForkInfo = config.getForkInfo(currentSlot);
  // We only connect if the ENR's fork matches our current fork.
  // We also allow it to be the previous fork due to delay and infrequent update of DHT.
  if (forkName !== localForkInfo.name && forkName !== localForkInfo.prevForkName) {
    return ENRRelevance.current_fork_mismatch;
  }

  // TODO: If we have next fork scheduled, check if next fork info matches ours
  // const enrForkId = ssz.phase0.ENRForkID.deserialize(eth2);

  return ENRRelevance.relevant;
}
