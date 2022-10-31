import child_process from "node:child_process";
import {shell, ShellOpts} from "./shell.js";

const {RUN_FROM_SRC} = process.env;

const nodeJsBinaryPath = process.execPath;
const tsNodeBinaryPath = esmRelativePathJoin("../../../../node_modules/.bin/ts-node");
const cliSrcScriptPath = esmRelativePathJoin("../../src/index.ts");
const cliLibScriptPath = esmRelativePathJoin("../../lib/index.js");

/* eslint-disable no-console */

export type DescribeArgs = {
  spawnCli(opts: SpawnCliOpts, args: string[]): child_process.ChildProcessWithoutNullStreams;
};

type SpawnCliOpts = {
  ensureProcRunning?: boolean;
  logPrefix?: string;
  pipeStdToParent?: boolean;
  printOnlyOnError?: boolean;
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function describeCliTest(testName: string, callback: (this: Mocha.Suite, args: DescribeArgs) => void) {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    const errs: Error[] = [];
    for (const cb of afterEachCallbacks) {
      try {
        await cb();
      } catch (e) {
        errs.push(e as Error);
      }
    }
    afterEachCallbacks.length = 0; // Reset array
    if (errs.length > 0) throw errs[0];
  });

  const args: DescribeArgs = {
    spawnCli(opts: SpawnCliOpts, args: string[]) {
      const proc = spawnCli(opts, args);
      console.log(`Created process ${proc.pid}`);

      afterEachCallbacks.push(async function () {
        // Capture state before killing
        const killed = proc.killed;

        // Attempt to kill process both with linux tools and built-in .kill()
        // Note: `kill <pid>` does not suffice in a local Ubuntu environment.
        console.log("Killing process", proc.pid);
        proc.kill("SIGKILL");
        await shell(`pkill -P ${proc.pid}`).catch((e) => {
          // Do not log unless on debug mode, process is probably killed already
          if (process.env.DEBUG) console.error(e);
        });

        if (killed && opts?.ensureProcRunning) {
          throw Error(`Process ${proc.pid} already killed`);
        }
      });

      return proc;
    },
  };

  describe(testName, function () {
    // Extend timeout to allow compiling from src
    // TODO: Just build from src once in before
    this.timeout(RUN_FROM_SRC ? "60s" : "10s");

    callback.bind(this)(args);
  });
}

export function spawnCli(opts: SpawnCliOpts, lodestarArgs: string[]): child_process.ChildProcessWithoutNullStreams {
  let stdstr = "";
  const logPrefix = opts?.logPrefix ?? "";

  const command = RUN_FROM_SRC
    ? // ts-node --esm cli.ts
      tsNodeBinaryPath
    : // node cli.js
      nodeJsBinaryPath;
  const prefixArgs = RUN_FROM_SRC
    ? // ts-node --esm cli.ts
      ["--esm", cliSrcScriptPath, ...lodestarArgs]
    : // node cli.js
      [cliLibScriptPath, ...lodestarArgs];

  const proc = child_process.spawn(command, prefixArgs);

  if (opts?.pipeStdToParent) {
    proc.stdout.on("data", (chunk) => {
      const str = Buffer.from(chunk).toString("utf8");
      process.stdout.write(`${logPrefix} ${proc.pid}: ${str}`); // str already contains a new line. console.log adds a new line
    });
    proc.stderr.on("data", (chunk) => {
      const str = Buffer.from(chunk).toString("utf8");
      process.stderr.write(`${logPrefix} ${proc.pid}: ${str}`); // str already contains a new line. console.log adds a new line
    });
  } else {
    proc.stdout.on("data", (chunk) => {
      stdstr += Buffer.from(chunk).toString("utf8");
    });
    proc.stderr.on("data", (chunk) => {
      stdstr += Buffer.from(chunk).toString("utf8");
    });
  }

  proc.on("exit", (code) => {
    console.log("process exited", {code});
    if (!opts?.pipeStdToParent) {
      if (!opts?.printOnlyOnError || (code !== null && code > 0)) {
        console.log(stdstr);
      }
    }
  });

  return proc;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function bufferStderr(proc: child_process.ChildProcessWithoutNullStreams) {
  let data = "";
  proc.stderr.on("data", (chunk) => {
    data += Buffer.from(chunk).toString("utf8");
  });
  return {
    read: () => data,
  };
}

export function execCli(lodestarArgs: string[], opts?: ShellOpts): Promise<string> {
  const prefixArgs = RUN_FROM_SRC
    ? // ts-node --esm cli.ts
      [tsNodeBinaryPath, "--esm", cliSrcScriptPath]
    : // node cli.js
      [nodeJsBinaryPath, cliLibScriptPath];
  return shell([...prefixArgs, ...lodestarArgs], {pipeToProcess: true, ...opts});
}

// From https://blog.logrocket.com/alternatives-dirname-node-js-es-modules
function esmRelativePathJoin(relativePath: string): string {
  return new URL(relativePath, import.meta.url).toString().replace(/^file:\/\//, "");
}
