import {ENR} from "@chainsafe/enr";
import {BeaconConfig} from "@lodestar/config";
import {ENRKey} from "../metadata.js";

export enum ENRRelevance {
  no_tcp = "no_tcp",
  no_eth2 = "no_eth2",
  // biome-ignore lint/style/useNamingConvention: Need to use the this name for network convention
  unknown_forkDigest = "unknown_forkDigest",
  relevant = "relevant",
}

export function enrRelevance(enr: ENR, config: BeaconConfig): ENRRelevance {
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
  const forkName = config.forkDigest2ForkNameOption(forkDigest);
  if (forkName == null) {
    return ENRRelevance.unknown_forkDigest;
  }

  // TODO: Then check if the next fork info matches ours
  // const enrForkId = ssz.phase0.ENRForkID.deserialize(eth2);

  return ENRRelevance.relevant;
}
