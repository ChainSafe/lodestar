import childProcess from "node:child_process";
import {TestContext, afterAll, beforeAll, vi} from "vitest";

/* eslint-disable no-console */

export function runDockerContainer(
  dockerhubImageTag: string,
  dockerRunArgs: string[],
  commandArgs: string[],
  opts?: {pipeToProcess: boolean}
): void {
  let proc: childProcess.ChildProcessWithoutNullStreams | null;
  let stdoutErr = "";

  afterAll(() => {
    if (proc) {
      console.log("Attempting to kill");
      proc.kill("SIGKILL");
      try {
        childProcess.execSync(`pkill -P ${proc.pid}`);
      } catch {
        //
      }
    }
  });

  beforeAll(() => {
    // Pull image
    // allow enough time to pull image
    vi.setConfig({hookTimeout: 300_000});
    childProcess.execSync(`docker pull ${dockerhubImageTag}`);
  });

  beforeDone(async (done) => {
    // docker run container
    proc = childProcess.spawn("docker", ["run", ...dockerRunArgs, dockerhubImageTag, ...commandArgs]);

    if (opts?.pipeToProcess) {
      proc.stdout.on("data", (chunk) => {
        const str = Buffer.from(chunk).toString("utf8");
        process.stdout.write(`${proc?.pid}: ${str}`); // str already contains a new line. console.log adds a new line
      });
      proc.stderr.on("data", (chunk) => {
        const str = Buffer.from(chunk).toString("utf8");
        process.stderr.write(`${proc?.pid}: ${str}`); // str already contains a new line. console.log adds a new line
      });
    } else {
      proc.stdout.on("data", (chunk) => {
        stdoutErr += Buffer.from(chunk).toString("utf8");
      });
      proc.stderr.on("data", (chunk) => {
        stdoutErr += Buffer.from(chunk).toString("utf8");
      });
    }

    proc.on("exit", (code) => {
      console.log("process exited", {code});
      if (!opts?.pipeToProcess) {
        console.log(stdoutErr);
      }
      done(Error(`process exited with code ${code}`));
    });
  });
}

export function beforeDone(cb: (this: TestContext, done: (err?: Error) => void) => Promise<void>): void {
  beforeAll(function (this: TestContext) {
    return new Promise<void>((resolve, reject) => {
      function done(err?: Error): void {
        if (err) reject(err);
        else resolve();
      }
      cb.call(this, done).then(resolve, reject);
    });
  });
}
