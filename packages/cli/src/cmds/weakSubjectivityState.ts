import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {TreeBacked} from "@chainsafe/ssz";
import {getStateTypeFromBytes} from "@chainsafe/lodestar/lib/util/multifork";
import {IGlobalArgs} from "../options";
import {IBeaconArgs} from "./beacon/options";
import got from "got";

// TODO this is a local infura account.  switch with a ChainSafe account when available
export enum WeakSubjectivityServers {
  mainnet = "https://1sla4tyOFn0bB1ohyCKaH2sLmHu:b8cdb9d881039fd04fe982a5ec57b0b8@eth2-beacon-mainnet.infura.io/eth/v1/debug/beacon/states",
  prater = "https://1sla4tyOFn0bB1ohyCKaH2sLmHu:b8cdb9d881039fd04fe982a5ec57b0b8@eth2-beacon-prater.infura.io/eth/v1/debug/beacon/states",
  pyrmont = "https://1sla4tyOFn0bB1ohyCKaH2sLmHu:b8cdb9d881039fd04fe982a5ec57b0b8@eth2-beacon-pyrmont.infura.io/eth/v1/debug/beacon/states",
}

export async function getWeakSubjectivityState(
  config: IBeaconConfig,
  args: IBeaconArgs & IGlobalArgs,
  stateId = "finalized",
  server: string,
  logger: ILogger
): Promise<TreeBacked<allForks.BeaconState>> {
  logger.info("Fetching weak subjectivity state from ChainSafe at " + server + "/" + stateId);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const response = await got(server + "/" + stateId, {headers: {Accept: "application/octet-stream"}});
  const stateBytes = response.rawBody;
  const state = getStateTypeFromBytes(config, stateBytes).createTreeBackedFromBytes(stateBytes);
  if (!state) {
    throw new Error("Weak subjectivity state not found for network " + args.network);
  }
  return state;
}
