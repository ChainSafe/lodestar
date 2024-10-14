import {writeFile} from "node:fs/promises";
import path from "node:path";
import got from "got";
import {Web3} from "web3";
import {
  EL_GENESIS_ACCOUNT,
  EL_GENESIS_PASSWORD,
  EL_GENESIS_SECRET_KEY,
  SHARED_JWT_SECRET,
  SIM_ENV_NETWORK_ID,
} from "../../constants.js";
import {registerWeb3JsPlugins} from "../../web3js/plugins/index.js";
import {ExecutionClient, ExecutionNodeGenerator, ExecutionStartMode, JobOptions, RunnerType} from "../../interfaces.js";
import {getNodeMountedPaths} from "../../utils/paths.js";
import {getNodePorts} from "../../utils/ports.js";

export const generateGethNode: ExecutionNodeGenerator<ExecutionClient.Geth> = (opts, runner) => {
  if (!process.env.GETH_BINARY_DIR && !process.env.GETH_DOCKER_IMAGE) {
    throw new Error("GETH_BINARY_DIR or GETH_DOCKER_IMAGE must be provided");
  }

  const {id, mode, ttd, address, mining, clientOptions, nodeIndex} = opts;
  const ports = getNodePorts(nodeIndex);

  const isDocker = !!process.env.GETH_DOCKER_IMAGE;
  const binaryPath = isDocker ? "" : `${process.env.GETH_BINARY_DIR}/geth`;
  const {rootDir, rootDirMounted, genesisFilePathMounted, logFilePath, jwtsecretFilePathMounted} = getNodeMountedPaths(
    opts.paths,
    "/data",
    isDocker
  );
  const engineRpcPublicUrl = `http://127.0.0.1:${ports.execution.enginePort}`;
  const engineRpcPrivateUrl = `http://${address}:${ports.execution.enginePort}`;
  const ethRpcPublicUrl = `http://127.0.0.1:${ports.execution.httpPort}`;
  const ethRpcPrivateUrl = `http://${address}:${ports.execution.httpPort}`;

  const skPath = path.join(rootDir, "sk.json");
  const skPathMounted = path.join(rootDirMounted, "sk.json");
  const passwordPath = path.join(rootDir, "password.txt");
  const passwordPathMounted = path.join(rootDirMounted, "password.txt");

  const initJobOptions: JobOptions = {
    id: `${id}-init`,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.GETH_DOCKER_IMAGE as string,
          mounts: [[rootDir, rootDirMounted]],
        }
      : undefined,
    cli: {
      command: binaryPath,
      args: [
        "--datadir",
        rootDirMounted,
        "--networkid",
        String(SIM_ENV_NETWORK_ID as number),
        "init",
        genesisFilePathMounted,
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
  };

  const importJobOptions: JobOptions = {
    id: `${id}-import`,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.GETH_DOCKER_IMAGE as string,
          mounts: [[rootDir, rootDirMounted]],
        }
      : undefined,
    bootstrap: async () => {
      await writeFile(skPath, EL_GENESIS_SECRET_KEY);
      await writeFile(passwordPath, EL_GENESIS_PASSWORD);
    },
    cli: {
      command: binaryPath,
      args: [
        "--datadir",
        rootDirMounted,
        "--networkid",
        String(SIM_ENV_NETWORK_ID as number),
        "account",
        "import",
        "--password",
        passwordPathMounted,
        skPathMounted,
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
  };

  const startJobOptions: JobOptions = {
    id,
    type: isDocker ? RunnerType.Docker : RunnerType.ChildProcess,
    options: isDocker
      ? {
          image: process.env.GETH_DOCKER_IMAGE as string,
          mounts: [[rootDir, rootDirMounted]],
          exposePorts: [ports.execution.enginePort, ports.execution.httpPort, ports.execution.p2pPort],
          dockerNetworkIp: address,
        }
      : undefined,
    cli: {
      command: binaryPath,
      args: [
        "--http",
        "--http.api",
        "engine,net,eth,miner,admin",
        "--http.port",
        String(ports.execution.httpPort as number),
        "--http.addr",
        "0.0.0.0",
        "--authrpc.port",
        String(ports.execution.enginePort as number),
        "--authrpc.addr",
        "0.0.0.0",
        "--port",
        String(ports.execution.p2pPort as number),
        "--nat",
        `extip:${address}`,
        "--authrpc.jwtsecret",
        jwtsecretFilePathMounted,
        "--nodiscover",
        "--datadir",
        rootDirMounted,
        "--allow-insecure-unlock",
        "--unlock",
        EL_GENESIS_ACCOUNT,
        "--password",
        passwordPathMounted,
        "--syncmode",
        "full",
        "--networkid",
        String(SIM_ENV_NETWORK_ID as number),
        // Logging verbosity: 0=silent, 1=error, 2=warn, 3=info, 4=debug, 5=detail
        "--verbosity",
        "5",
        ...(mining ? ["--mine", "--miner.etherbase", EL_GENESIS_ACCOUNT] : []),
        ...(mode === ExecutionStartMode.PreMerge ? ["--nodiscover"] : []),
        ...clientOptions,
      ],
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
    health: async () => {
      await got.post(ethRpcPublicUrl, {json: {jsonrpc: "2.0", method: "net_version", params: [], id: 67}});
    },
  };

  const job = runner.create([{...initJobOptions, children: [{...importJobOptions, children: [startJobOptions]}]}]);

  const provider = new Web3(ethRpcPublicUrl);
  registerWeb3JsPlugins(provider);

  return {
    client: ExecutionClient.Geth,
    id,
    engineRpcPublicUrl,
    engineRpcPrivateUrl,
    ethRpcPublicUrl,
    ethRpcPrivateUrl,
    ttd,
    jwtSecretHex: SHARED_JWT_SECRET,
    provider,
    job,
  };
};
