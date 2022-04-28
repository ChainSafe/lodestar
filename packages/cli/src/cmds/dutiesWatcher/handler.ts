import {getClient} from "@chainsafe/lodestar-api";
import {DutiesWatcher} from "@chainsafe/lodestar-validator";
import {getBeaconConfigFromArgs} from "../../config/beaconParams";
import {IGlobalArgs} from "../../options";
import {getCliLogger, initBLS, onGracefulShutdown, parseRange} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {IDutiesWatcherArgs} from "./options";

export async function dutiesWatcherHandler(args: IDutiesWatcherArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  const config = getBeaconConfigFromArgs(args);
  const beaconPaths = getBeaconPaths(args);
  const logger = getCliLogger(args, beaconPaths, config);
  const {beaconApiUrl} = args;
  const api = getClient({baseUrl: beaconApiUrl}, {config});
  const {data: genesisData} = await api.beacon.getGenesis();
  const validatorIndexes = parseRange(args.validatorIndexes);
  if (validatorIndexes.length < 0 || validatorIndexes.length >= 64) {
    throw Error(`Invalid number of validators ${validatorIndexes.length}, must be from 1 to 64`);
  }

  const onGracefulShutdownCbs: (() => Promise<void> | void)[] = [];
  onGracefulShutdown(async () => {
    for (const cb of onGracefulShutdownCbs) await cb();
  }, logger.info.bind(logger));
  const dutiesWatcher = new DutiesWatcher({api, logger, config}, genesisData, validatorIndexes);
  onGracefulShutdownCbs.push(async () => await dutiesWatcher.stop());
  await dutiesWatcher.start();
  logger.info("Hello, I'm DutiesWatcher, I'm gonna watch duties for validator", validatorIndexes);
}
