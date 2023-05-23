import {writeFile} from "node:fs/promises";
import {ChainForkConfig} from "@lodestar/config";
import {SHARED_JWT_SECRET, CLIQUE_SEALING_PERIOD} from "../constants.js";
import {
  AtLeast,
  ELClient,
  ELGeneratorClientOptions,
  ELGeneratorGenesisOptions,
  ELNode,
  ELStartMode,
  IRunner,
} from "../interfaces.js";
import {getEstimatedShanghaiTime} from "../utils/index.js";
import {getGethGenesisBlock} from "../utils/el_genesis.js";
import {createELNodePaths} from "../utils/paths.js";
import {generateGethNode} from "./geth.js";
import {generateMockNode} from "./mock.js";
import {generateNethermindNode} from "./nethermind.js";

export async function createELNode<E extends ELClient>(
  client: E,
  options: AtLeast<ELGeneratorClientOptions<E>, "genesisTime" | "paths" | "nodeIndex"> & {
    forkConfig: ChainForkConfig;
    runner: IRunner;
  }
): Promise<ELNode> {
  const {forkConfig, runner} = options;
  const elId = `${options.id}-el-${client}`;

  const genesisOptions: ELGeneratorGenesisOptions<E> = {
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

  const opts: ELGeneratorClientOptions<E> = {
    ...options,
    ...genesisOptions,
    id: elId,
    mode: options.mode ?? (forkConfig.BELLATRIX_FORK_EPOCH > 0 ? ELStartMode.PreMerge : ELStartMode.PostMerge),
    address: runner.getNextIp(),
    mining: options.mining ?? false,
  };

  await createELNodePaths(opts.paths);
  await writeFile(opts.paths.jwtsecretFilePath, SHARED_JWT_SECRET);
  await writeFile(opts.paths.genesisFilePath, JSON.stringify(getGethGenesisBlock(opts.mode, genesisOptions)));

  switch (client) {
    case ELClient.Mock: {
      return generateMockNode(opts as ELGeneratorClientOptions<ELClient.Mock>, runner);
    }
    case ELClient.Geth: {
      return generateGethNode(opts as ELGeneratorClientOptions<ELClient.Geth>, runner);
    }
    case ELClient.Nethermind: {
      return generateNethermindNode(opts as ELGeneratorClientOptions<ELClient.Nethermind>, runner);
    }
    default:
      throw new Error(`EL Client "${client}" not supported`);
  }
}
