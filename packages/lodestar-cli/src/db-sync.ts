import {fromHexString} from "@chainsafe/ssz";
import {initBLS} from "@chainsafe/bls";
import {BeaconDb, LevelDbController} from "@chainsafe/lodestar/lib/db";
import {WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils";

import {getBeaconPaths} from "./cmds/beacon/paths";
import {mergeConfigOptions} from "./cmds/beacon/config";
import {getBeaconConfig} from "./util";
import { BeaconChain } from "@chainsafe/lodestar/lib/chain";
import { BeaconMetrics } from "@chainsafe/lodestar/lib/metrics";
import { EthersEth1Notifier } from "@chainsafe/lodestar/lib/eth1";

const rootDir = ".altona";

(async function() {
  await initBLS();
  let options: any = {
    rootDir, preset: "mainnet",
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
  const eth1 = new EthersEth1Notifier(options.eth1, {config, db, logger});
  const metrics = new BeaconMetrics(options.metrics, {logger});
  const chain = new BeaconChain(options.chain, {
    config,
    db,
    metrics,
    eth1,
    logger,
  });
  await db.start();
  const genesisState = await db.stateArchive.firstValue();
  chain.initializeBeaconChain(genesisState);
  await chain.start();
  for await (const block of db.blockArchive.valuesStream()) {
    await chain.receiveBlock(block, true, true);
  }
  await chain.stop();
  await db.stop();
})();
