/* eslint-disable @typescript-eslint/naming-convention */
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import got from "got";
import {ZERO_HASH} from "@lodestar/state-transition";
import {Eth1ProviderWithAdmin} from "../Eth1ProviderWithAdmin.js";
import {ELClient, ELClientGenerator, JobOptions, RunnerType} from "../interfaces.js";
import {getNethermindChainSpec} from "../utils/el_genesis.js";

export const generateNethermindNode: ELClientGenerator<ELClient.Nethermind> = (opts, runner) => {
  const {id, mode, dataDir, ethPort, port, enginePort, ttd} = opts;
  const {logFilePath, jwtSecretHex, cliqueSealingPeriod, address, mining, clientOptions} = opts;

  if (!process.env.NETHERMIND_DOCKER_IMAGE) {
    throw Error(`EL ENV must be provided, NETHERMIND_DOCKER_IMAGE: ${process.env.NETHERMIND_DOCKER_IMAGE}`);
  }

  // Docker will be executed on entrypoint automatically
  const binaryPath = "";
  const containerDataDir = "/data";
  const ethRpcUrl = `http://127.0.0.1:${ethPort}`;
  const engineRpcUrl = `http://${address}:${enginePort}`;

  const chainSpecPath = join(dataDir, "chain.json");
  const chainSpecContainerPath = join(containerDataDir, "chain.json");
  const jwtSecretPath = join(dataDir, "jwtsecret");
  const jwtSecretContainerPath = join(containerDataDir, "jwtsecret");

  const startJobOptions: JobOptions<RunnerType.Docker> = {
    id,
    type: RunnerType.Docker,
    options: {
      image: process.env.NETHERMIND_DOCKER_IMAGE as string,
      dataVolumePath: dataDir,
      exposePorts: [enginePort, ethPort, port],
      dockerNetworkIp: address,
    },
    bootstrap: async () => {
      await mkdir(dataDir, {recursive: true});
      await writeFile(
        chainSpecPath,
        JSON.stringify(getNethermindChainSpec(mode, {ttd, cliqueSealingPeriod, clientOptions: []}))
      );
      await writeFile(jwtSecretPath, jwtSecretHex);
    },
    cli: {
      command: binaryPath,
      args: [
        "--JsonRpc.JwtSecretFile",
        jwtSecretContainerPath,
        "--JsonRpc.Enabled",
        "true",
        "--JsonRpc.Host",
        "0.0.0.0",
        "--JsonRpc.Port",
        String(ethPort as number),
        "--JsonRpc.EngineHost",
        "0.0.0.0",
        "--JsonRpc.EnginePort",
        String(enginePort as number),
        "--JsonRpc.EngineEnabledModules",
        "Admin,Eth,Subscribe,Trace,TxPool,Web3,Personal,Proof,Net,Parity,Health,Rpc,Debug",
        "--JsonRpc.EnabledModules",
        "Admin,Net,Eth,Subscribe,Web3",
        "--Init.BaseDbPath",
        join(containerDataDir, "db"),
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
        String(port as number),
        // OFF|TRACE|DEBUG|INFO|WARN|ERROR
        "--log",
        "INFO",
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
        await got.post(ethRpcUrl, {json: {jsonrpc: "2.0", method: "net_version", params: [], id: 67}});
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
    {providerUrls: [`http://127.0.0.1:${ethPort}`, `http://127.0.0.1:${enginePort}`], jwtSecretHex}
  );

  return {
    client: ELClient.Nethermind,
    id,
    engineRpcUrl,
    ethRpcUrl,
    ttd,
    jwtSecretHex,
    provider,
    job,
  };
};
