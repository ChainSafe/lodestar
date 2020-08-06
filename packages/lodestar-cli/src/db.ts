import {fromHexString} from "@chainsafe/ssz";
import {BeaconDb, LevelDbController} from "@chainsafe/lodestar/lib/db";
import {WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";

import {getBeaconPaths} from "./cmds/beacon/paths";
import {mergeConfigOptions} from "./config/beacon";
import {getBeaconConfig} from "./util";

const rootDir = ".altona";
const bucket = "badBlock";
const action = "delete";
const value = "0xe37b83f1e25ce3ebc2e10fa308413160eb36e4de6d295079104222d67229136c";

(async function() {
  let options: any = {
    rootDir, action, value, preset: "mainnet",
  };

  const beaconPaths = getBeaconPaths(options);
  console.log(beaconPaths)
  options = {...options, ...beaconPaths};
  options = mergeConfigOptions(options as any);
  options.db.name = beaconPaths.dbDir;

  const config = getBeaconConfig(options.preset, options.params);
  const logger =new WinstonLogger({level: LogLevel.verbose});
  const db = new BeaconDb({
    config,
    controller: new LevelDbController(options.db, {logger}),
  });
  await db.start();
  await db[bucket][action](fromHexString(value));
  await db.stop();
})();
