import {writeFile} from "node:fs/promises";
import {SHARED_JWT_SECRET, CLIQUE_SEALING_PERIOD} from "../constants.js";
import {
  AtLeast,
  ExecutionClient,
  ExecutionGeneratorOptions,
  ExecutionGenesisOptions,
  ExecutionNode,
  ExecutionStartMode,
} from "../interfaces.js";
import {getEstimatedShanghaiTime} from "../utils/index.js";
import {getGethGenesisBlock} from "../utils/execution_genesis.js";
import {ensureDirectories} from "../utils/paths.js";
import {generateGethNode} from "./geth.js";
import {generateMockNode} from "./mock.js";
import {generateNethermindNode} from "./nethermind.js";

export async function createExecutionNode<E extends ExecutionClient>(
  client: E,
  options: AtLeast<ExecutionGeneratorOptions<E>, "genesisTime" | "paths" | "nodeIndex" | "forkConfig" | "runner">
): Promise<ExecutionNode> {
  const {forkConfig, runner} = options;
  const elId = `${options.id}-${client}`;

  const genesisOptions: ExecutionGenesisOptions<E> = {
    ...options,
    ttd: options.ttd ?? forkConfig.TERMINAL_TOTAL_DIFFICULTY,
    cliqueSealingPeriod: options.cliqueSealingPeriod ?? CLIQUE_SEALING_PERIOD,
    shanghaiTime:
      options.shanghaiTime ??
      getEstimatedShanghaiTime({
        genesisDelaySeconds: forkConfig.GENESIS_DELAY,
        capellaForkEpoch: forkConfig.CAPELLA_FORK_EPOCH,
        eth1GenesisTime: options.genesisTime,
        secondsPerSlot: forkConfig.SECONDS_PER_SLOT,
        additionalSlots: 0,
      }),
    clientOptions: options.clientOptions ?? [],
  };

  const opts: ExecutionGeneratorOptions<E> = {
    ...options,
    ...genesisOptions,
    id: elId,
    mode:
      options.mode ??
      (forkConfig.BELLATRIX_FORK_EPOCH > 0 ? ExecutionStartMode.PreMerge : ExecutionStartMode.PostMerge),
    address: runner.getNextIp(),
    mining: options.mining ?? false,
  };

  await ensureDirectories(opts.paths);
  await writeFile(opts.paths.jwtsecretFilePath, SHARED_JWT_SECRET);
  await writeFile(opts.paths.genesisFilePath, JSON.stringify(getGethGenesisBlock(opts.mode, genesisOptions)));

  switch (client) {
    case ExecutionClient.Mock: {
      return generateMockNode(opts as ExecutionGeneratorOptions<ExecutionClient.Mock>, runner);
    }
    case ExecutionClient.Geth: {
      return generateGethNode(opts as ExecutionGeneratorOptions<ExecutionClient.Geth>, runner);
    }
    case ExecutionClient.Nethermind: {
      return generateNethermindNode(opts as ExecutionGeneratorOptions<ExecutionClient.Nethermind>, runner);
    }
    default:
      throw new Error(`Execution Client "${client}" not supported`);
  }
}
