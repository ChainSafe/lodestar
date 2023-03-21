/* eslint-disable @typescript-eslint/naming-convention */
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {Keystore} from "@chainsafe/bls-keystore";
import {SHARED_VALIDATOR_PASSWORD} from "../constants.js";
import {CLClientKeys, CLPaths} from "../interfaces.js";

type KeystoreDefinition = {
  enabled: boolean;
  type: "local_keystore" | "remote_signer";
  voting_public_key: string;
  voting_keystore_path: string;
  voting_keystore_password_path: string;
};

export const createKeystores = async (
  {validatorsDefinitionFilePath, keystoresDir, keystoresSecretsDir}: CLPaths,
  keys: CLClientKeys
): Promise<void> => {
  const definition: KeystoreDefinition[] = [];

  if (keys.type === "local") {
    for (const key of keys.secretKeys) {
      const keystore = await Keystore.create(SHARED_VALIDATOR_PASSWORD, key.toBytes(), key.toPublicKey().toBytes(), "");

      await writeFile(
        path.join(keystoresDir, `${key.toPublicKey().toHex()}.json`),
        JSON.stringify(keystore.toObject(), null, 2)
      );

      await writeFile(path.join(keystoresSecretsDir, `${key.toPublicKey().toHex()}.txt`), SHARED_VALIDATOR_PASSWORD);

      definition.push({
        enabled: true,
        type: "local_keystore",
        voting_public_key: key.toPublicKey().toHex(),
        voting_keystore_path: path.join(keystoresDir, `${key.toPublicKey().toHex()}.json`),
        voting_keystore_password_path: path.join(keystoresSecretsDir, `${key.toPublicKey().toHex()}.txt`),
      });
    }
  }

  await writeFile(
    validatorsDefinitionFilePath,
    yaml.dump(definition, {
      styles: {
        "!!null": "canonical", // dump null as ~
      },
      sortKeys: true, // sort object keys
    })
  );
};

export const updateKeystoresPath = async (
  definitionFilePath: string,
  newValidatorDir: string,
  newDefinitionFilePath: string
): Promise<void> => {
  const definition = [];
  const oldValidatorDir = path.dirname(definitionFilePath);

  const definitionYaml = yaml.load(await readFile(definitionFilePath, "utf8")) as KeystoreDefinition[];

  for (const def of definitionYaml) {
    definition.push({
      ...def,
      voting_keystore_path: def.voting_keystore_path.replace(oldValidatorDir, newValidatorDir),
      voting_keystore_password_path: def.voting_keystore_password_path.replace(oldValidatorDir, newValidatorDir),
    });
  }

  await writeFile(
    newDefinitionFilePath,
    yaml.dump(definition, {
      styles: {
        "!!null": "canonical", // dump null as ~
      },
      sortKeys: true, // sort object keys
    })
  );
};
