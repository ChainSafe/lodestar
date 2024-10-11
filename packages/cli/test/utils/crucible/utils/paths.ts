import path from "node:path";
import fs from "node:fs";
import {mkdir} from "node:fs/promises";
import {
  BeaconClient,
  BeaconPaths,
  ExecutionClient,
  ExecutionPaths,
  MountedPaths,
  ValidatorClient,
  ValidatorPaths,
} from "../interfaces.js";

export function getNodePaths<
  C extends BeaconClient | ValidatorClient | ExecutionClient,
  R = C extends BeaconClient ? BeaconPaths : C extends ValidatorClient ? ValidatorPaths : ExecutionPaths,
  // Mount path will be used when running the node in docker
>(opts: {root: string; id: string; logsDir: string; client: C; mountPath?: string}): R {
  const {root, id, client, logsDir, mountPath} = opts;

  if (Object.values(ExecutionClient).includes(client as ExecutionClient)) {
    const executionRootDir = path.join(mountPath ?? root, id, client);
    return {
      rootDir: executionRootDir,
      dataDir: path.join(executionRootDir, "data"),
      genesisFilePath: path.join(executionRootDir, "genesis.json"),
      jwtsecretFilePath: path.join(executionRootDir, "jwtsecret.txt"),
      logFilePath: path.join(logsDir, `${id}-${client}.log`),
    } as R;
  }

  if (Object.values(BeaconClient).includes(client as BeaconClient)) {
    const beaconRootDir = path.join(mountPath ?? root, id, client);
    return {
      rootDir: beaconRootDir,
      dataDir: path.join(beaconRootDir, "data"),
      genesisFilePath: path.join(beaconRootDir, "genesis.ssz"),
      jwtsecretFilePath: path.join(beaconRootDir, "jwtsecret.txt"),
      logFilePath: path.join(logsDir, `${id}-${client}.log`),
    } as R;
  }

  if (Object.values(ValidatorClient).includes(client as ValidatorClient)) {
    const validatorRootDir = path.join(mountPath ?? root, id, client);
    return {
      rootDir: validatorRootDir,
      dataDir: path.join(validatorRootDir, "data"),
      jwtsecretFilePath: path.join(validatorRootDir, "jwtsecret.txt"),
      keystoresDir: path.join(validatorRootDir, "validators", "keystores"),
      keystoresSecretsDir: path.join(validatorRootDir, "validators", "secretts"),
      keystoresSecretFilePath: path.join(validatorRootDir, "validators", "password.txt"),
      validatorsDefinitionFilePath: path.join(validatorRootDir, "validators", "validator_definitions.yml"),
      validatorsDir: path.join(validatorRootDir, "validators"),
      logFilePath: path.join(logsDir, `${id}-${client}.log`),
    } as R;
  }

  throw new Error(`Unknown client type: ${client}`);
}

export const ensureDirectories = async <T extends object>(paths: T): Promise<T> => {
  for (const dirName of Object.values(paths)) {
    if (fs.existsSync(dirName)) continue;

    if (path.extname(dirName) === "") {
      await mkdir(dirName, {recursive: true});
    } else {
      const parentDir = path.dirname(dirName);
      await mkdir(parentDir, {recursive: true});
    }
  }

  return paths;
};

export const getNodeMountedPaths = <T extends ExecutionPaths | BeaconPaths | ValidatorPaths>(
  paths: T,
  mountPath: string,
  mount: boolean
): MountedPaths<T> => {
  return Object.entries(paths)
    .map(([key, value]) => [
      [key, value],
      [`${key}Mounted`, mount ? (value as string).replace(paths.rootDir, mountPath) : value],
    ])
    .flat()
    .reduce(
      (o, [key, value]) => {
        o[key] = value as string;
        return o;
      },
      {} as Record<string, string>
    ) as MountedPaths<T>;
};
