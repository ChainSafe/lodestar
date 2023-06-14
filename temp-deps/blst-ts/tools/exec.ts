import {execFile, ExecOptions, exec as EXEC, ChildProcess, PromiseWithChild, ExecFileOptions} from "child_process";

const timeout = 3 * 60 * 1000; // ms
const maxBuffer = 10e6; // bytes

export async function exec(cmd: string, args: string[], options?: ExecFileOptions): Promise<string> {
  return new Promise((resolve, reject): void => {
    const proc = execFile(
      cmd,
      args,
      {
        timeout,
        maxBuffer,
        encoding: "utf8",
        ...options,
      },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve(stdout.trim() || stderr || "");
      }
    );
    if (proc.stdout) proc.stdout.pipe(process.stdout);
    if (proc.stderr) proc.stderr.pipe(process.stderr);
  });
}

export function cmdStringExec(
  command: string,
  logToConsole = true,
  options: ExecOptions = {}
): PromiseWithChild<string> {
  let child!: ChildProcess;
  const promise = new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    function bufferOutput(data: string): void {
      chunks.push(Buffer.from(data));
    }
    function stdoutHandler(data: string): void {
      // eslint-disable-next-line no-console
      // console.log(data);
      process.stdout.write(data);
    }
    function stderrHandler(data: string): void {
      // eslint-disable-next-line no-console
      // console.error(data);
      process.stderr.write(data);
    }

    child = EXEC(
      command,
      {
        timeout,
        maxBuffer,
        ...options,
      },
      (err) => {
        child.stdout?.removeListener("data", logToConsole ? stdoutHandler : bufferOutput);
        child.stderr?.removeListener("data", logToConsole ? stderrHandler : bufferOutput);
        const output = Buffer.concat(chunks).toString("utf8");
        if (err) {
          return logToConsole ? reject(err) : reject(output);
        }
        return logToConsole ? resolve("") : resolve(output);
      }
    );

    if (child.stdin) {
      process.stdin.pipe(child.stdin);
    }
    child.stdout?.on("data", logToConsole ? stdoutHandler : bufferOutput);
    child.stderr?.on("data", logToConsole ? stderrHandler : bufferOutput);
  }) as PromiseWithChild<string>;

  promise.child = child;
  return promise;
}
