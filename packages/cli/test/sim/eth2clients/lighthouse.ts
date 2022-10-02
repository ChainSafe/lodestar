import path from "node:path";
import fs from "node:fs";
import {shell} from "../../utils/shell.js";
import {BeaconProcessOpts, SpwanOpts, TestnetOpts, ValidatorProcessOpts} from "./interface.js";

const LIGHTHOUSE_DOCKERHUB_TAG = "sigp/lighthouse:v3.1.2";
const testnetDirpathContainer = "/testnet-dir";

/* eslint-disable @typescript-eslint/naming-convention */

export async function prepareLighthouse(): Promise<void> {
  await shell(["docker", "pull", LIGHTHOUSE_DOCKERHUB_TAG]);
}

export function prepareBeaconNodeLighthouseArgs(opts: BeaconProcessOpts): SpwanOpts {
  // Prepare testnet-dir
  const testnetDirpath = writeTestnetDir(opts);

  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      `--name=${opts.processName}`,
      // Map ports binding only to localhost
      `--publish=127.0.0.1:${opts.restPort}:${opts.restPort}/tcp`,
      `--publish=127.0.0.1:${opts.p2pPort}:${opts.p2pPort}/tcp`,
      `--publish=127.0.0.1:${opts.p2pPort}:${opts.p2pPort}/udp`,
      // Only bind mount the testnet dir. Blockchain data is ephemeral
      `--volume=${testnetDirpath}:${testnetDirpathContainer}`,
      LIGHTHOUSE_DOCKERHUB_TAG,

      "lighthouse",
      "--debug-level=debug",
      "--datadir=/data",
      `--testnet-dir=${testnetDirpathContainer}`,
      "beacon_node",
      "--disable-enr-auto-update",
      `--enr-tcp-port=${opts.p2pPort}`,
      `--enr-udp-port=${opts.p2pPort}`,
      `--port=${opts.p2pPort}`,
      `--discovery-port=${opts.p2pPort}`,
      "--listen-address=0.0.0.0",
      "--eth1=false",
      // --boot-nodes="{{ bootnode_enrs | join(',') }}",
      "--http",
      "--http-address=0.0.0.0",
      `--http-port=${opts.restPort}`,
      "--http-allow-sync-stalled",
      "--disable-packet-filter",
      // "--execution-endpoints={{execution_endpoint}}",
      // "--eth1-endpoints={{eth1endpoint}}",
      // "--terminal-total-difficulty-override={{terminal_total_difficulty}}",
      // "--suggested-fee-recipient={{fee_recipient}}",
      // "--jwt-secrets=/jwtsecret",
    ],
    env: {
      // Enables debug logs for all libp2p stack
      // Suppress winston debug logs since it double logs what already goes to the file
      DEBUG: "*,-winston:*",
    },
  };
}

export function prepareValidatorLighthouseArgs(opts: ValidatorProcessOpts): SpwanOpts {
  if (opts.signer.useExternalSigner) {
    throw Error("Using web3signer with lighthouse not supported");
  }

  const validatorsDir = path.join(opts.dataDir, "keystores");
  const secretsDir = path.join(opts.dataDir, "secrets");
  fs.mkdirSync(validatorsDir, {recursive: true});
  fs.mkdirSync(secretsDir, {recursive: true});

  for (const [i, keystore] of opts.signer.keystores.entries()) {
    const pubkey = opts.signer.publicKeys[i];
    const keystoreDir = path.join(validatorsDir, pubkey);
    fs.mkdirSync(keystoreDir, {recursive: true});
    fs.writeFileSync(path.join(keystoreDir, "voting-keystore.json"), keystore);
    fs.writeFileSync(path.join(secretsDir, pubkey), opts.signer.password);
  }

  const validatorsDirContainer = "/keystores";
  const secretsDirContainer = "/secrets";

  // Prepare testnet-dir
  const testnetDirpath = writeTestnetDir(opts);

  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      `--name=${opts.processName}`,
      // Only bind mount the keystores dir. Slashing protection data is ephemeral
      `--volume=${testnetDirpath}:${testnetDirpathContainer}`,
      `--volume=${validatorsDir}:${validatorsDirContainer}`,
      `--volume=${secretsDir}:${secretsDirContainer}`,
      LIGHTHOUSE_DOCKERHUB_TAG,

      "lighthouse",
      "--debug-level=debug",
      `--datadir=${opts.dataDir}`,
      `--testnet-dir=${testnetDirpath}`,
      "vc",
      `--validators-dir=${validatorsDirContainer}`,
      `--secrets-dir=${secretsDir}`,
      "--init-slashing-protection",
      `--server=${opts.beaconUrl}`,
      "--http",
      "--http-address=0.0.0.0",
      `--http-port=${opts.keymanagerPort}`,
    ],
    env: {
      // Enables debug logs for all libp2p stack
      // Suppress winston debug logs since it double logs what already goes to the file
      DEBUG: "*,-winston:*",
    },
  };
}

function writeTestnetDir(opts: TestnetOpts): string {
  const testnetDirpath = path.join(opts.dataDir, "testnet-dir");
  fs.mkdirSync(testnetDirpath, {recursive: true});
  fs.copyFileSync(opts.genesisStateFilepath, path.join(testnetDirpath, "genesis.ssz"));
  fs.copyFileSync(opts.configFilepath, path.join(testnetDirpath, "config.yaml"));
  fs.writeFileSync(path.join(testnetDirpath, "deploy_block.txt"), "0");
  return testnetDirpath;
}
