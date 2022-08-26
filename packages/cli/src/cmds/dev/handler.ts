import fs from "node:fs";
import {promisify} from "node:util";
import rimraf from "rimraf";
import {toHex, fromHex} from "@lodestar/utils";
import {nodeUtils} from "@lodestar/beacon-node";
import {IGlobalArgs} from "../../options/index.js";
import {mkdir, onGracefulShutdown} from "../../util/index.js";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {getValidatorPaths} from "../validator/paths.js";
import {beaconHandler} from "../beacon/handler.js";
import {validatorHandler} from "../validator/handler.js";
import {IDevArgs} from "./options.js";

/**
 * Run a beacon node with validator
 */
export async function devHandler(args: IDevArgs & IGlobalArgs): Promise<void> {
  const {config} = getBeaconConfigFromArgs(args);

  // TODO: Is this necessary?
  const network = "dev";
  if (args.network && args.network !== network) {
    throw Error(`Must not run dev command with network '${args.network}', only 'dev' network`);
  }

  // Note: defaults to network "dev", to all paths are custom and don't conflict with networks.
  // Flag --reset cleans up the custom dirs on dev stop
  const beaconDbDir = getBeaconPaths(args, network).dbDir;
  const validatorsDbDir = getValidatorPaths(args, network).validatorsDbDir;

  // Remove slashing protection db. Otherwise the validators won't be able to propose nor attest
  // until the clock reach a higher slot than the previous run of the dev command
  if (args.genesisTime === undefined) {
    await promisify(rimraf)(beaconDbDir);
    await promisify(rimraf)(validatorsDbDir);
  }

  mkdir(beaconDbDir);
  mkdir(validatorsDbDir);

  if (args.reset) {
    onGracefulShutdown(async () => {
      await promisify(rimraf)(beaconDbDir);
      await promisify(rimraf)(validatorsDbDir);
    });
  }

  // To be able to recycle beacon handler pass the genesis state via file
  if (args.genesisStateFile) {
    // Already set, skip
  } else {
    // Generate and write state to disk
    const validatorCount = args.genesisValidators ?? 8;
    const genesisTime = args.genesisTime ?? Math.floor(Date.now() / 1000) + 5;
    const eth1BlockHash = fromHex(args.genesisEth1Hash ?? toHex(Buffer.alloc(32, 0x0b)));

    const {state} = nodeUtils.initDevState(config, validatorCount, {genesisTime, eth1BlockHash});

    args.genesisStateFile = "genesis.ssz";
    fs.writeFileSync(args.genesisStateFile, state.serialize());

    // Set logger format to Eph with provided genesisTime
    if (args.logFormatGenesisTime === undefined) args.logFormatGenesisTime = genesisTime;
  }

  // Note: recycle entire beacon handler
  await beaconHandler(args);

  if (args.startValidators) {
    // TODO: Map dev option to validator's option
    args.interopIndexes = args.startValidators;

    // Note: recycle entire validator handler:
    // - keystore handling
    // - metrics
    // - keymanager server
    await validatorHandler(args);
  }
}
