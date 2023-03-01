import fs from "node:fs";
import path from "node:path";
import {nodeUtils} from "@lodestar/beacon-node";
import {chainConfigToJson, ChainForkConfig} from "@lodestar/config";
import {dumpYaml} from "@lodestar/utils";
import {interopSecretKey} from "@lodestar/state-transition";
import {Keystore} from "@chainsafe/bls-keystore";
import {PersistedKeysBackend} from "../validator/keymanager/persistedKeys.js";

/* eslint-disable no-console */

export async function writeTestnetFiles(
  config: ChainForkConfig,
  targetDir: string,
  genesisValidators: number
): Promise<void> {
  const genesisTime = Math.floor(Date.now() / 1000);
  const eth1BlockHash = Buffer.alloc(32, 0);

  const {state} = nodeUtils.initDevState(config, genesisValidators, {genesisTime, eth1BlockHash});

  // Write testnet data
  fs.mkdirSync(targetDir, {recursive: true});
  fs.writeFileSync(path.join(targetDir, "genesis.ssz"), state.serialize());
  fs.writeFileSync(path.join(targetDir, "config.yaml"), dumpYaml(chainConfigToJson(config)));
  fs.writeFileSync(path.join(targetDir, "deploy_block.txt"), "0");

  const persistedKeystoresBackend = new PersistedKeysBackend({
    keystoresDir: path.join(targetDir, "keystores"),
    secretsDir: path.join(targetDir, "secrets"),
    remoteKeysDir: path.join(targetDir, "remote_keys"),
    proposerDir: path.join(targetDir, "proposer"),
  });

  const password = "test_password";

  // Write keystores
  for (let i = 0; i < genesisValidators; i++) {
    console.log(`Generating keystore ${i}`);

    const sk = interopSecretKey(i);

    const keystore = await Keystore.create(password, sk.toBytes(), sk.toPublicKey().toBytes(), "");

    persistedKeystoresBackend.writeKeystore({
      keystoreStr: keystore.stringify(),
      password,
      // Not used immediately
      lockBeforeWrite: false,
      // Return duplicate status if already found
      persistIfDuplicate: false,
    });
  }
}
