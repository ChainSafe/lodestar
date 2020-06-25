import fs, {mkdirSync} from "fs";
import process from "process";
import {Arguments} from "yargs";
import deepmerge from "deepmerge";
import {initBLS} from "@chainsafe/bls";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {params as mainnetParams} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {createEnr, createPeerId} from "../../network";
import rimraf from "rimraf";
import {join} from "path";
import {IDevOptions} from "./options";
import {getInteropValidator} from "../validator/utils/interop/validator";
import {Validator} from "@chainsafe/lodestar-validator/lib";
import {initDevChain, storeSSZState} from "@chainsafe/lodestar/lib/node/utils/state";
import {getValidatorApiClient} from "./utils/validator";

/**
 * Run a beacon node
 */
export async function run(options: Arguments<IDevOptions>): Promise<void> {
  await initBLS();

  options = deepmerge(defaultOptions, options) as Arguments<IDevOptions>;
  const peerId = await createPeerId();
  options.network.discv5.enr = await createEnr(peerId);
  const config = createIBeaconConfig({
    ...(options.chain.name === "mainnet" ? mainnetParams : minimalParams),
  });

  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const logger = new WinstonLogger();

  const chainDir = join(options.rootDir, "dev", "beacon");
  const validatorsDir = join(options.rootDir, "dev", "validators");
  mkdirSync(chainDir, {recursive: true});
  mkdirSync(validatorsDir, {recursive: true});

  options.db.name = join(chainDir, "db-" + peerId.toB58String());

  const node = new BeaconNode(options, {
    config,
    libp2p,
    logger,
  });

  if(options.dev.genesisValidators) {
    const state = await initDevChain(node, options.dev.genesisValidators);
    storeSSZState(node.config, state, join(options.rootDir, "dev", "genesis.ssz"));
  }else if (options.chain.genesisStateFile) {
    await node.chain.initializeBeaconChain(
      config.types.BeaconState.tree.deserialize(
        await fs.promises.readFile(
          join(options.rootDir, options.chain.genesisStateFile)
        )
      )
    );
  }

  await node.start();

  let validators: Validator[];
  if(options.dev.startValidators) {
    const range = options.dev.startValidators.split(":").map(s => parseInt(s));
    const api = getValidatorApiClient(options.validator.beaconUrl, logger, node);
    validators = Array.from(
      {length:range[1] + range[0]},(v,i)=>i+range[0]
    ).map((index) => {
      return getInteropValidator(
        node.config,
        validatorsDir,
        {
          api,
          logger,
        },
        index
      );
    });
    validators.forEach((v) => v.start());
  }

  async function cleanup(): Promise<void> {
    logger.info("Stopping validators");
    await Promise.all(validators.map((v) => v.stop()));
    logger.info("Stopping BN");
    await node.stop();
    if(options.dev.reset) {
      logger.info("Cleaning directories");
      //delete db directory
      rimraf.sync(chainDir);
      rimraf.sync(validatorsDir);
    }
    logger.info("Cleanup completed");
  }

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
