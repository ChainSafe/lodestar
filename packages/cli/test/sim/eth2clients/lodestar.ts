import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {allNamespaces} from "@lodestar/api";
import {LogLevel} from "@lodestar/utils";
import {IGlobalArgs} from "../../../src/options/globalOptions.js";
import {IBeaconArgs} from "../../../src/cmds/beacon/options.js";
import {IValidatorCliArgs} from "../../../src/cmds/validator/options.js";
import {BeaconProcessOpts, SpwanOpts, ValidatorProcessOpts} from "./interface.js";

const {SIMTEST_ENABLE_LIBP2P_DEBUG} = process.env;

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LODESTAR_BINARY_PATH = path.join(__dirname, "../../../bin/lodestar.js");

/* eslint-disable @typescript-eslint/naming-convention */

export function prepareBeaconNodeLodestarArgs(opts: BeaconProcessOpts): SpwanOpts {
  // Typesafe CLI args, Typescript won't compile here if we change them
  const rcconfig: Partial<IGlobalArgs & IBeaconArgs> = {
    preset: opts.preset,
    dataDir: opts.dataDir,
    genesisStateFile: opts.genesisStateFilepath,
    paramsFile: opts.configFilepath,
    rest: true,
    "rest.address": "127.0.0.1",
    "rest.port": opts.restPort,
    "rest.namespace": allNamespaces,
    "sync.isSingleNode": opts.isSingleNode,
    "network.allowPublishToZeroPeers": opts.isSingleNode,
    eth1: false,
    discv5: !opts.isSingleNode,
    // TODO - TEMP: Use an actual EL latter
    "execution.engineMock": true,
    // Disable workers in subprocess, it can crash and it's not production usage
    "chain.blsVerifyAllMainThread": true,
    listenAddress: "127.0.0.1",
    port: opts.p2pPort,
    metrics: false,
    bootnodes: [],
    logFormatGenesisTime: opts.genesisTime,
    logFile: opts.logFilepath,
    logFileDailyRotate: 0,
    logFileLevel: LogLevel.debug,
    logLevel: LogLevel.debug,
  };

  const rcconfigFilepath = path.join(opts.dataDir, "rcconfig.json");
  fs.mkdirSync(opts.dataDir, {recursive: true});
  fs.writeFileSync(rcconfigFilepath, JSON.stringify(rcconfig, null, 2));

  return {
    command: LODESTAR_BINARY_PATH,
    args: ["beacon", "--rcConfig", rcconfigFilepath],
    env: {
      // Enables debug logs for all libp2p stack
      // Suppress winston debug logs since it double logs what already goes to the file
      DEBUG: SIMTEST_ENABLE_LIBP2P_DEBUG ? "*,-winston:*" : "",
    },
  };
}

export function prepareValidatorLodestarArgs(opts: ValidatorProcessOpts): SpwanOpts {
  const rcconfig: Partial<IGlobalArgs & IValidatorCliArgs> = {
    preset: opts.preset,
    dataDir: opts.dataDir,
    paramsFile: opts.configFilepath,
    server: opts.beaconUrl,
    keymanager: true,
    "keymanager.authEnabled": false,
    "keymanager.address": "127.0.0.1",
    "keymanager.port": opts.keymanagerPort,
    logFormatGenesisTime: opts.genesisTime,
    logFile: opts.logFilepath,
    logFileDailyRotate: 0,
    logFileLevel: LogLevel.debug,
    logLevel: LogLevel.debug,
  };

  if (opts.signer.useExternalSigner) {
    rcconfig["externalSigner.url"] = opts.signer.keymanagerUrl;
    rcconfig["externalSigner.fetch"] = true;
  } else {
    const keystoresDirpath = path.join(opts.dataDir, "keystores");
    const passwordFilepath = path.join(opts.dataDir, "password.txt");

    fs.mkdirSync(keystoresDirpath, {recursive: true});
    fs.writeFileSync(passwordFilepath, opts.signer.password);
    for (const [i, keystore] of opts.signer.keystores.entries()) {
      fs.writeFileSync(path.join(keystoresDirpath, `keystore_${i}.json`), keystore);
    }

    rcconfig["importKeystores"] = [keystoresDirpath];
    rcconfig["importKeystoresPassword"] = passwordFilepath;
  }

  const rcconfigFilepath = path.join(opts.dataDir, "rcconfig.json");
  fs.mkdirSync(opts.dataDir, {recursive: true});
  fs.writeFileSync(rcconfigFilepath, JSON.stringify(rcconfig, null, 2));

  return {
    command: LODESTAR_BINARY_PATH,
    args: ["validator", "--rcConfig", rcconfigFilepath],
  };
}
