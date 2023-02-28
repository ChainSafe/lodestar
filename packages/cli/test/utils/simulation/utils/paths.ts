import path from "node:path";
import fs from "node:fs";
import {mkdir} from "node:fs/promises";
import {CLClient, CLPaths, ELClient, ELPaths, MountedPaths} from "../interfaces.js";

export const getCLNodePaths = ({
  root,
  id,
  client,
  logsDir,
}: {
  root: string;
  id: string;
  client: CLClient;
  logsDir: string;
}): CLPaths => {
  const clRootDir = path.join(root, id, `cl_${client}`);
  const dataDir = path.join(clRootDir, "data");
  const genesisFilePath = path.join(clRootDir, "genesis.ssz");
  const jwtsecretFilePath = path.join(clRootDir, "jwtsecret.txt");
  const validatorsDir = path.join(clRootDir, "validators");
  const keystoresDir = path.join(clRootDir, "validators", "keystores");
  const keystoresSecretsDir = path.join(clRootDir, "validators", "secretts");
  const keystoresSecretFilePath = path.join(clRootDir, "validators", "password.txt");
  const validatorsDefinitionFilePath = path.join(clRootDir, "validators", "validator_definitions.yml");
  const logFilePath = path.join(logsDir, `${id}-cl-${client}.log`);

  return {
    rootDir: clRootDir,
    dataDir,
    genesisFilePath,
    jwtsecretFilePath,
    validatorsDir,
    keystoresDir,
    keystoresSecretsDir,
    validatorsDefinitionFilePath,
    keystoresSecretFilePath,
    logFilePath,
  };
};

export const getCLNodePathsForDocker = (paths: CLPaths, mountPath: string): CLPaths => {
  const {
    rootDir,
    dataDir,
    genesisFilePath,
    jwtsecretFilePath,
    validatorsDefinitionFilePath,
    validatorsDir,
    keystoresDir,
    keystoresSecretFilePath,
    keystoresSecretsDir,
    logFilePath,
  } = paths;

  return {
    rootDir: mountPath,
    dataDir: dataDir.replace(rootDir, mountPath),
    genesisFilePath: genesisFilePath.replace(rootDir, mountPath),
    jwtsecretFilePath: jwtsecretFilePath.replace(rootDir, mountPath),
    validatorsDir: validatorsDir.replace(rootDir, mountPath),
    keystoresDir: keystoresDir.replace(rootDir, mountPath),
    keystoresSecretsDir: keystoresSecretsDir.replace(rootDir, mountPath),
    validatorsDefinitionFilePath: validatorsDefinitionFilePath.replace(rootDir, mountPath),
    keystoresSecretFilePath: keystoresSecretFilePath.replace(rootDir, mountPath),
    logFilePath,
  };
};

export const createCLNodePaths = async (paths: CLPaths): Promise<CLPaths> => {
  const {dataDir, keystoresDir, keystoresSecretsDir} = paths;

  if (!fs.existsSync(dataDir)) await mkdir(dataDir, {recursive: true});
  if (!fs.existsSync(keystoresDir)) await mkdir(keystoresDir, {recursive: true});
  if (!fs.existsSync(keystoresSecretsDir)) await mkdir(keystoresSecretsDir, {recursive: true});

  return paths;
};

export const getELNodePaths = ({
  root,
  id,
  client,
  logsDir,
}: {
  root: string;
  id: string;
  client: ELClient;
  logsDir: string;
}): ELPaths => {
  const elRootDir = path.join(root, id, `el_${client}`);
  const dataDir = path.join(elRootDir, "data");
  const logFilePath = path.join(logsDir, `${id}-el=${client}.log`);

  return {
    rootDir: elRootDir,
    dataDir,
    genesisFilePath: path.join(elRootDir, "genesis.json"),
    jwtsecretFilePath: path.join(elRootDir, "jwtsecret.txt"),
    logFilePath,
  };
};

export const getNodeMountedPaths = <T extends ELPaths | CLPaths>(
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
    .reduce((o, [key, value]) => ({...o, [key]: value as string}), {}) as MountedPaths<T>;
};

export const createELNodePaths = async (paths: ELPaths): Promise<ELPaths> => {
  const {dataDir} = paths;

  if (!fs.existsSync(dataDir)) await mkdir(dataDir, {recursive: true});

  return paths;
};
