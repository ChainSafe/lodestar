import {fromHexString} from "@chainsafe/ssz";
import {BeaconDb, LevelDbController} from "@chainsafe/lodestar/lib/db";
import {WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";

import {getBeaconPaths} from "./cmds/beacon/paths";
import {mergeConfigOptions} from "./cmds/beacon/config";
import {getBeaconConfig} from "./util";

const rootDir = ".altona";
const bucket = "badBlock";
const action = "delete";
const value = "0x3edb8564a3f5b9ea67f80477b631b72a0d602dcf6b95ab6a8c0666c273b1f876";

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
