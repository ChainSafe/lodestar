import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {once} from "node:events";
import {createReadStream, createWriteStream} from "node:fs";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const FIFO_OPEN_TIMEOUT_MS = 5000;
const OUTPUT_DRAIN_TIMEOUT_MS = 1000;

function commandError(code, detail = "") {
  const error = new Error(detail === "" ? code : `${code}: ${detail}`);
  error.code = code;
  return error;
}

function terminate(child) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

async function makeFifos(stdoutPath, stderrPath) {
  const child = spawn("mkfifo", [stdoutPath, stderrPath], {stdio: "ignore"});
  const timer = setTimeout(() => child.kill("SIGKILL"), FIFO_OPEN_TIMEOUT_MS);
  try {
    const [exitCode, signal] = await once(child, "close");
    if (exitCode !== 0) throw commandError("FifoCreateFailed", JSON.stringify({exitCode, signal}));
  } finally {
    clearTimeout(timer);
  }
}

async function openFifo(path) {
  const reader = createReadStream(path, {highWaterMark: 64 * 1024});
  const writer = createWriteStream(path);
  const timer = setTimeout(() => {
    reader.destroy(new Error("FifoOpenTimeout"));
    writer.destroy(new Error("FifoOpenTimeout"));
  }, FIFO_OPEN_TIMEOUT_MS);
  try {
    await Promise.all([once(reader, "open"), once(writer, "open")]);
    return {reader, writer};
  } catch (error) {
    reader.destroy();
    writer.destroy();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function capture(reader, name, state, child) {
  return new Promise((resolve, reject) => {
    reader.on("data", (chunk) => {
      state.bytes += chunk.length;
      if (state.bytes > state.maxOutputBytes) {
        const remaining = state.maxOutputBytes - state.storedBytes;
        if (remaining > 0) {
          state[name].push(chunk.subarray(0, remaining));
          state.storedBytes += remaining;
        }
        state.error ??= commandError("CommandOutputBound", `combined output exceeds ${state.maxOutputBytes} bytes`);
        terminate(child);
        return;
      }
      state[name].push(chunk);
      state.storedBytes += chunk.length;
    });
    reader.once("end", resolve);
    reader.once("error", reject);
  });
}

async function boundedDrain(promises, readers) {
  let timer;
  try {
    await Promise.race([
      Promise.all(promises),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(commandError("CommandOutputDrainTimeout")), OUTPUT_DRAIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    for (const reader of readers) reader.destroy();
  }
}

export async function runBoundedCommand(
  program,
  args,
  cwd,
  {allowFailure = false, env = process.env, maxOutputBytes, timeoutMs}
) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("InvalidCommand");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new Error("InvalidOutputBound");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("InvalidCommandTimeout");
  const outputDir = await mkdtemp(join(tmpdir(), `lodestar-package-command-${randomBytes(4).toString("hex")}-`));
  const stdoutPath = join(outputDir, "stdout");
  const stderrPath = join(outputDir, "stderr");
  let stdoutFifo;
  let stderrFifo;
  let child;
  try {
    await makeFifos(stdoutPath, stderrPath);
    stdoutFifo = await openFifo(stdoutPath);
    stderrFifo = await openFifo(stderrPath);
    const startedAt = new Date().toISOString();
    child = spawn(program, args, {
      cwd,
      detached: true,
      env,
      stdio: ["ignore", stdoutFifo.writer.fd, stderrFifo.writer.fd],
    });
    const state = {bytes: 0, error: undefined, maxOutputBytes, stderr: [], stdout: [], storedBytes: 0};
    const captures = [
      capture(stdoutFifo.reader, "stdout", state, child).catch((error) => {
        error.code ??= "CommandOutputReadFailed";
        state.error ??= error;
        terminate(child);
      }),
      capture(stderrFifo.reader, "stderr", state, child).catch((error) => {
        error.code ??= "CommandOutputReadFailed";
        state.error ??= error;
        terminate(child);
      }),
    ];
    stdoutFifo.writer.destroy();
    stderrFifo.writer.destroy();
    const timer = setTimeout(() => {
      state.error ??= commandError("CommandTimeout", `exceeded ${timeoutMs}ms`);
      terminate(child);
    }, timeoutMs);
    const result = await new Promise((resolveResult) => {
      child.once("error", (error) => resolveResult({exitCode: null, signal: null, spawnError: error}));
      child.once("close", (exitCode, signal) => resolveResult({exitCode, signal}));
    });
    let drainError;
    try {
      await boundedDrain(captures, [stdoutFifo.reader, stderrFifo.reader]);
    } catch (error) {
      drainError = error;
    } finally {
      clearTimeout(timer);
    }
    const record = {
      argv: [program, ...args],
      cwd,
      exitCode: result.exitCode,
      finishedAt: new Date().toISOString(),
      signal: result.signal,
      startedAt,
      stderr: Buffer.concat(state.stderr).toString("utf8"),
      stdout: Buffer.concat(state.stdout).toString("utf8"),
    };
    if (state.error || drainError) {
      const error = state.error ?? drainError;
      error.commandRecord = record;
      throw error;
    }
    if (result.spawnError) {
      result.spawnError.commandRecord = record;
      throw result.spawnError;
    }
    if (!allowFailure && result.exitCode !== 0) {
      const error = commandError("CommandFailed", `exit code ${record.exitCode}`);
      error.commandRecord = record;
      throw error;
    }
    return record;
  } finally {
    if (child !== undefined) terminate(child);
    stdoutFifo?.reader.destroy();
    stdoutFifo?.writer.destroy();
    stderrFifo?.reader.destroy();
    stderrFifo?.writer.destroy();
    await rm(outputDir, {force: true, recursive: true});
  }
}
