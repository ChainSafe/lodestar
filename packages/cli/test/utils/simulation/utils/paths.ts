import {join} from "node:path";
import {existsSync} from "node:fs";
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
  const clRootDir = join(root, id, `cl_${client}`);
  const dataDir = join(clRootDir, "data");
  const genesisFilePath = join(clRootDir, "genesis.ssz");
  const jwtsecretFilePath = join(clRootDir, "jwtsecret.txt");
  const validatrosDir = join(clRootDir, "validators");
  const keystoresDir = join(clRootDir, "validators", "keystores");
  const keystoresSecretsDir = join(clRootDir, "validators", "secretts");
  const keystoresSecretFilePath = join(clRootDir, "validators", "password.txt");
  const validatorsDefinitionFilePath = join(clRootDir, "validators", "validator_definitions.yml");
  const logFilePath = join(logsDir, `${id}-cl-${client}.log`);

  return {
    rootDir: clRootDir,
    dataDir,
    genesisFilePath,
    jwtsecretFilePath,
    validatorsDir: validatrosDir,
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
    validatorsDir: validatrosDir,
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
    validatorsDir: validatrosDir.replace(rootDir, mountPath),
    keystoresDir: keystoresDir.replace(rootDir, mountPath),
    keystoresSecretsDir: keystoresSecretsDir.replace(rootDir, mountPath),
    validatorsDefinitionFilePath: validatorsDefinitionFilePath.replace(rootDir, mountPath),
    keystoresSecretFilePath: keystoresSecretFilePath.replace(rootDir, mountPath),
    logFilePath,
  };
};

export const createCLNodePaths = async (paths: CLPaths): Promise<CLPaths> => {
  const {dataDir, keystoresDir, keystoresSecretsDir} = paths;

  if (!existsSync(dataDir)) await mkdir(dataDir, {recursive: true});
  if (!existsSync(keystoresDir)) await mkdir(keystoresDir, {recursive: true});
  if (!existsSync(keystoresSecretsDir)) await mkdir(keystoresSecretsDir, {recursive: true});

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
  const elRootDir = join(root, id, `el_${client}`);
  const dataDir = join(elRootDir, "data");
  const logFilePath = join(logsDir, `${id}-el=${client}.log`);

  return {
    rootDir: elRootDir,
    dataDir,
    genesisFilePath: join(elRootDir, "genesis.json"),
    jwtsecretFilePath: join(elRootDir, "jwtsecret.txt"),
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

  if (!existsSync(dataDir)) await mkdir(dataDir, {recursive: true});

  return paths;
};
