/* eslint-disable @typescript-eslint/naming-convention */
import {writeFile} from "node:fs/promises";
import path from "node:path";
import got from "got";
import {ZERO_HASH} from "@lodestar/state-transition";
import {activePreset} from "@lodestar/params";
import {
  EL_GENESIS_ACCOUNT,
  EL_GENESIS_PASSWORD,
  EL_GENESIS_SECRET_KEY,
  SHARED_JWT_SECRET,
  SIM_ENV_NETWORK_ID,
} from "../constants.js";
import {Eth1ProviderWithAdmin} from "../Eth1ProviderWithAdmin.js";
import {ExecutionClient, ExecutionNodeGenerator, ExecutionStartMode, JobOptions, RunnerType} from "../interfaces.js";
import {getNodeMountedPaths} from "../utils/paths.js";
import {getNodePorts} from "../utils/ports.js";

export const generateBuilderNode: ExecutionNodeGenerator<ExecutionClient.Builder> = (opts, runner) => {
  if (!process.env.BUILDER_DOCKER_IMAGE) {
    throw new Error("BUILDER_DOCKER_IMAGE must be provided");
  }

  const {id, mode, ttd, address, mining, clientOptions, nodeIndex} = opts;
  const ports = getNodePorts(nodeIndex);

  const {rootDir, rootDirMounted, genesisFilePathMounted, logFilePath, jwtsecretFilePathMounted} = getNodeMountedPaths(
    opts.paths,
    "/data",
    true
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
    type: RunnerType.Docker,
    options: {
      image: process.env.BUILDER_DOCKER_IMAGE as string,
      mounts: [[rootDir, rootDirMounted]],
    },
    cli: {
      command: "",
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
    type: RunnerType.Docker,
    options: {
      image: process.env.BUILDER_DOCKER_IMAGE as string,
      mounts: [[rootDir, rootDirMounted]],
    },
    bootstrap: async () => {
      await writeFile(skPath, EL_GENESIS_SECRET_KEY);
      await writeFile(passwordPath, EL_GENESIS_PASSWORD);
    },
    cli: {
      command: "",
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

  const startJobArgs: string[] = [
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
    ...(mode == ExecutionStartMode.PreMerge ? ["--nodiscover"] : []),
  ];

  startJobArgs.push(
    "--builder",
    "--builder.local_relay",
    "--builder.slots_in_epoch",
    activePreset.SLOTS_PER_EPOCH.toString()
  );

  if (clientOptions?.builder?.beaconEndpoints) {
    startJobArgs.push("--builder.beacon_endpoints", clientOptions.builder.beaconEndpoints.join(","));
  }

  if (clientOptions?.builder?.cancellations) {
    startJobArgs.push("--builder.cancellations");
  }

  if (clientOptions?.builder?.listenAddress) {
    startJobArgs.push("--builder.listen_addr", clientOptions.builder.listenAddress);
  }

  if (clientOptions?.builder?.algo) {
    startJobArgs.push("--builder.algotype", clientOptions.builder.algo);
  }

  const startJobOptions: JobOptions = {
    id,
    type: RunnerType.Docker,
    options: {
      image: process.env.BUILDER_DOCKER_IMAGE as string,
      mounts: [[rootDir, rootDirMounted]],
      exposePorts: [ports.execution.enginePort, ports.execution.httpPort, ports.execution.p2pPort],
      dockerNetworkIp: address,
    },
    cli: {
      command: "",
      args: startJobArgs,
      env: {},
    },
    logs: {
      stdoutFilePath: logFilePath,
    },
    health: async () => {
      try {
        await got.post(ethRpcPublicUrl, {json: {jsonrpc: "2.0", method: "net_version", params: [], id: 67}});
        return {ok: true};
      } catch (err) {
        return {ok: false, reason: (err as Error).message, checkId: "JSON RPC query net_version"};
      }
    },
  };

  const job = runner.create([{...initJobOptions, children: [{...importJobOptions, children: [startJobOptions]}]}]);

  const provider = new Eth1ProviderWithAdmin(
    {DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH},
    // To allow admin_* RPC methods had to add "ethRpcUrl"
    {providerUrls: [ethRpcPublicUrl, engineRpcPublicUrl], jwtSecretHex: SHARED_JWT_SECRET}
  );

  return {
    client: ExecutionClient.Builder,
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
