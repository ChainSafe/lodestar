import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {sleep} from "@lodestar/utils";
import {LoggerWorker, getLoggerWorker} from "./workerLoggerHandler.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("worker logs", () => {
  vi.setConfig({testTimeout: 60_000});

  const logFilepath = path.join(__dirname, "../../../test-logs/test_worker_logs.log");
  let loggerWorker: LoggerWorker;

  beforeEach(async () => {
    // Touch log file
    fs.mkdirSync(path.dirname(logFilepath), {recursive: true});
    fs.writeFileSync(logFilepath, "");
    // Create worker before each test since the write stream is created once
    loggerWorker = await getLoggerWorker({logFilepath});
  });

  afterEach(async () => {
    // Guard against before() erroring
    if (loggerWorker != null) await loggerWorker.close();
    // Remove log file
    fs.rmSync(logFilepath, {force: true});
  });

  it("mainthread writes to file", async () => {
    const logTextMainThread = "test-log-mainthread";
    fs.createWriteStream(logFilepath, {flags: "a"}).write(logTextMainThread);

    const data = await waitForFileSize(logFilepath, logTextMainThread.length);
    expect(data).toContain(logTextMainThread);
  });

  it("worker writes to file", async () => {
    const logTextWorker = "test-log-worker";
    loggerWorker.log(logTextWorker);

    const data = await waitForFileSize(logFilepath, logTextWorker.length);
    expect(data).toContain(logTextWorker);
  });

  it("concurrent write from two write streams in different threads", async () => {
    const logTextWorker = "test-log-worker";
    const logTextMainThread = "test-log-mainthread";

    const file = fs.createWriteStream(logFilepath, {flags: "a"});

    loggerWorker.log(logTextWorker);
    file.write(logTextMainThread + "\n");

    const data = await waitForFileSize(logFilepath, logTextWorker.length + logTextMainThread.length);
    expect(data).toContain(logTextWorker);
    expect(data).toContain(logTextMainThread);
  });
});

async function waitForFileSize(filepath: string, minSize: number): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const data = fs.readFileSync(filepath, "utf8");
    if (data.length >= minSize) {
      return data;
    }
    await sleep(100);
  }

  const data = fs.readFileSync(filepath, "utf8");
  throw Error(`Timeout waiting for ${filepath} to have size ${minSize}, current size ${data.length}\n${data}`);
}
