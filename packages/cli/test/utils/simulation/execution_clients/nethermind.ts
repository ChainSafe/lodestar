/* eslint-disable @typescript-eslint/naming-convention */
import {writeFile} from "node:fs/promises";
import path from "node:path";
import got from "got";
import {ZERO_HASH} from "@lodestar/state-transition";
import {Eth1ProviderWithAdmin} from "../Eth1ProviderWithAdmin.js";
import {ExecutionClient, ExecutionNodeGenerator, JobOptions, RunnerType} from "../interfaces.js";
import {getNethermindChainSpec} from "../utils/execution_genesis.js";
import {getNodeMountedPaths} from "../utils/paths.js";
import {SHARED_JWT_SECRET} from "../constants.js";
import {getNodePorts} from "../utils/ports.js";

export const generateNethermindNode: ExecutionNodeGenerator<ExecutionClient.Nethermind> = (opts, runner) => {
  if (!process.env.NETHERMIND_DOCKER_IMAGE) {
    throw Error(`EL ENV must be provided, NETHERMIND_DOCKER_IMAGE: ${process.env.NETHERMIND_DOCKER_IMAGE}`);
  }

  const {id, mode, ttd, address, mining, clientOptions, nodeIndex, cliqueSealingPeriod, shanghaiTime, genesisTime} =
    opts;
  const ports = getNodePorts(nodeIndex);

  const {rootDir, rootDirMounted, logFilePath, jwtsecretFilePathMounted} = getNodeMountedPaths(
    opts.paths,
    "/data",
    true
  );

  // Docker will be executed on entrypoint automatically
  const binaryPath = "";
  const engineRpcPublicUrl = `http://127.0.0.1:${ports.execution.enginePort}`;
  const engineRpcPrivateUrl = `http://${address}:${ports.execution.enginePort}`;
  const ethRpcPublicUrl = `http://127.0.0.1:${ports.execution.httpPort}`;
  const ethRpcPrivateUrl = `http://${address}:${ports.execution.httpPort}`;

  const chainSpecPath = path.join(rootDir, "chain.json");
  const chainSpecContainerPath = path.join(rootDirMounted, "chain.json");

  const startJobOptions: JobOptions<RunnerType.Docker> = {
    id,
    type: RunnerType.Docker,
    options: {
      image: process.env.NETHERMIND_DOCKER_IMAGE as string,
      mounts: [[rootDir, rootDirMounted]],
      exposePorts: [ports.execution.enginePort, ports.execution.httpPort, ports.execution.p2pPort],
      dockerNetworkIp: address,
    },
    bootstrap: async () => {
      await writeFile(
        chainSpecPath,
        JSON.stringify(
          getNethermindChainSpec(mode, {ttd, cliqueSealingPeriod, shanghaiTime, genesisTime, clientOptions: []})
        )
      );
    },
    cli: {
      command: binaryPath,
      args: [
        "--JsonRpc.JwtSecretFile",
        jwtsecretFilePathMounted,
        "--JsonRpc.Enabled",
        "true",
        "--JsonRpc.Host",
        "0.0.0.0",
        "--JsonRpc.Port",
        String(ports.execution.httpPort as number),
        "--JsonRpc.EngineHost",
        "0.0.0.0",
        "--JsonRpc.EnginePort",
        String(ports.execution.enginePort as number),
        "--JsonRpc.EngineEnabledModules",
        "Admin,Eth,Subscribe,Trace,TxPool,Web3,Personal,Proof,Net,Parity,Health,Rpc,Debug",
        "--JsonRpc.EnabledModules",
        "Admin,Net,Eth,Subscribe,Web3",
        "--Init.BaseDbPath",
        path.join(rootDirMounted, "db"),
        "--Init.DiscoveryEnabled",
        "false",
        "--Init.PeerManagerEnabled",
        "true",
        "--Init.ChainSpecPath",
        chainSpecContainerPath,
        "--Sync.NetworkingEnabled",
        "true",
        "--Network.ExternalIp",
        address,
        "--Network.LocalIp",
        "0.0.0.0",
        "--Network.P2PPort",
        String(ports.execution.p2pPort as number),
        // OFF|TRACE|DEBUG|INFO|WARN|ERROR
        "--log",
        "DEBUG",
        "--config",
        "none",
        ...(mining ? ["--Init.IsMining", "true", "--Mining.Enabled", "true"] : []),
        ...clientOptions,
      ],
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

  const job = runner.create([startJobOptions]);

  const provider = new Eth1ProviderWithAdmin(
    {DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH},
    // To allow admin_* RPC methods had to add "ethRpcUrl"
    {providerUrls: [ethRpcPublicUrl, engineRpcPublicUrl], jwtSecretHex: SHARED_JWT_SECRET}
  );

  return {
    client: ExecutionClient.Nethermind,
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
