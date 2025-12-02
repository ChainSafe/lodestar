import childProcess from "node:child_process";
import {vi} from "vitest";

/* eslint-disable no-console */

export function runDockerContainer(
  dockerhubImageTag: string,
  dockerRunArgs: string[],
  commandArgs: string[],
  opts?: {pipeToProcess: boolean}
): () => void {
  let stdoutErr = "";

  // Pull image
  // allow enough time to pull image
  vi.setConfig({hookTimeout: 300_000});
  console.log(`Pulling docker image ${dockerhubImageTag}...`);
  childProcess.execSync(`docker pull ${dockerhubImageTag}`);

  // docker run container
  console.log(`Running docker container ${dockerhubImageTag}...`);
  const proc = childProcess.spawn("docker", ["run", ...dockerRunArgs, dockerhubImageTag, ...commandArgs]);

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
  });

  return () => {
    if (proc) {
      console.log("Attempting to kill");
      proc.kill("SIGKILL");
      try {
        childProcess.execSync(`pkill -P ${proc.pid}`);
      } catch {
        //
      }
    }
  };
}
