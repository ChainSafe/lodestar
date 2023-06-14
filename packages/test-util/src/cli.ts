import childProcess from "node:child_process";
import yargs from "yargs";
import {wrapTimeout} from "./timeout.js";
import {nodeJsBinaryPath, repoRootPath, tsNodeBinaryPath} from "./path.js";
import {execChildProcess, spawnChildProcess} from "./childProcess.js";

type CommandRunOptions = {
  timeoutMs: number;
};

/**
 * Run the cli command inside the main process from the Yargs object
 */
export async function runCliCommand<T>(
  cli: yargs.Argv<T>,
  args: string[],
  opts: CommandRunOptions = {timeoutMs: 1000}
): Promise<string> {
  return wrapTimeout(
    // eslint-disable-next-line no-async-promise-executor
    new Promise(async (resolve, reject) => {
      await cli.parseAsync(args, {}, (err, _argv, output) => {
        if (err) return reject(err);

        resolve(output);
      });
    }),
    opts.timeoutMs
  );
}

type CommandSpawnOptions = {
  logPrefix?: string;
  pipeStdToParent?: boolean;
  pipeOnlyError?: boolean;
  runWith?: "node" | "ts-node";
};

/**
 * Exec a command in bash script mode. Useful for short-running commands
 *
 * @param command - The command should be relative to mono-repo root
 * @param args
 * @param opts
 * @returns
 */
export function execCliCommand(
  command: string,
  args: string[],
  opts: Pick<CommandSpawnOptions, "runWith" | "pipeStdToParent">
): Promise<string> {
  const commandPrefixed =
    opts?.runWith === "ts-node"
      ? // ts-node --esm cli.ts
        tsNodeBinaryPath
      : // node cli.js
        nodeJsBinaryPath;

  const argsPrefixed =
    opts?.runWith === "ts-node"
      ? // ts-node --esm cli.ts
        ["--esm", repoRootPath(command), ...args]
      : // node cli.js
        [repoRootPath(command), ...args];

  return execChildProcess([...commandPrefixed, ...argsPrefixed], {pipeStdToParent: opts.pipeStdToParent});
}

/**
 * Spawn a process and keep it running
 *
 * @param command - The command should be relative to mono-repo root
 * @param args
 * @param opts
 * @returns
 */
export async function spawnCliCommand(
  command: string,
  args: string[],
  opts: CommandSpawnOptions
): Promise<childProcess.ChildProcess> {
  const logPrefix = opts?.logPrefix ?? "";

  const commandPrefixed =
    opts?.runWith === "ts-node"
      ? // ts-node --esm cli.ts
        tsNodeBinaryPath
      : // node cli.js
        nodeJsBinaryPath;

  const argsPrefixed =
    opts?.runWith === "ts-node"
      ? // ts-node --esm cli.ts
        ["--esm", repoRootPath(command), ...args]
      : // node cli.js
        [repoRootPath(command), ...args];

  return spawnChildProcess(commandPrefixed, argsPrefixed, {
    logPrefix,
    pipeStdToParent: opts.pipeStdToParent,
    pipeOnlyError: opts.pipeOnlyError,
  });
}
