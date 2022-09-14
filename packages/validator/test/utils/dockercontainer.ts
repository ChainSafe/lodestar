import child_process from "node:child_process";

/* eslint-disable no-console */

export function runDockerContainer(
  dockerhubImageTag: string,
  dockerRunArgs: string[],
  commandArgs: string[],
  opts?: {pipeToProcess: boolean}
): void {
  let proc: child_process.ChildProcessWithoutNullStreams | null;
  let stdoutErr = "";

  after(() => {
    if (proc) {
      console.log("Attempting to kill");
      proc.kill("SIGKILL");
      try {
        child_process.execSync(`pkill -P ${proc.pid}`);
      } catch (e) {
        //
      }
    }
  });

  before("pull image", function () {
    // allow enough time to pull image
    this.timeout("300s");
    child_process.execSync(`docker pull ${dockerhubImageTag}`);
  });

  beforeDone("docker run container", async function (done) {
    proc = child_process.spawn("docker", ["run", ...dockerRunArgs, dockerhubImageTag, ...commandArgs]);

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

export function beforeDone(
  title: string,
  cb: (this: Mocha.Context, done: (err?: Error) => void) => Promise<void>
): void {
  before(title, function () {
    return new Promise<void>((resolve, reject) => {
      function done(err?: Error): void {
        if (err) reject(err);
        else resolve();
      }
      cb.bind(this)(done).then(resolve, reject);
    });
  });
}
