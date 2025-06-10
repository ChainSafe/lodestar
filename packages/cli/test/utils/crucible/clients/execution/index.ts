import {
  ExecutionClient,
  ExecutionGeneratorOptions,
  ExecutionNode,
  ExecutionNodeDefinitionOptions,
  ExecutionStartMode,
  GeneratorOptions,
} from "../../interfaces.js";
import {ensureDirectories, getNodePaths} from "../../utils/paths.js";
import {generateGethNode} from "./geth.js";
import {generateMockNode} from "./mock.js";
import {generateNethermindNode} from "./nethermind.js";

export async function createExecutionNode<E extends ExecutionClient>(
  client: E,
  options: ExecutionNodeDefinitionOptions<E> & GeneratorOptions
): Promise<ExecutionNode> {
  const {forkConfig, runner} = options;
  const elId = `${options.id}-${client}`;

  const opts: ExecutionGeneratorOptions<E> = {
    ...options,
    id: options.id,
    mode:
      options.mode ??
      (forkConfig.BELLATRIX_FORK_EPOCH > 0 ? ExecutionStartMode.PreMerge : ExecutionStartMode.PostMerge),
    address: runner.getNextIp(),
    mining: options.mining ?? false,
    clientOptions: options.clientOptions ?? [],
    paths: getNodePaths({
      root: options.rootDir,
      id: elId,
      client,
      logsDir: options.logsDir,
    }),
  };

  await ensureDirectories(opts.paths);

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
