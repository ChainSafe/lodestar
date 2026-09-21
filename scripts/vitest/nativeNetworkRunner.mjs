import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {VitestTestRunner} from "vitest/runners";
import {getFn} from "vitest/suite";

const execute = promisify(execFile);

export default class NetworkRunner extends VitestTestRunner {
  async runTask(test) {
    if (!test.file.filepath.endsWith("/network/native.test.ts") || process.env.LODESTAR_NATIVE_CASE) {
      await getFn(test)();
      return;
    }
    const names = [test.name];
    for (let suite = test.suite; suite && suite !== test.file; suite = suite.suite) names.unshift(suite.name);
    const pattern = `^${names.join(" ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
    const directory = await mkdtemp(join(tmpdir(), "native-network-case-"));
    const report = join(directory, "result.json");
    try {
      await execute(
        process.execPath,
        [
          "--expose-gc",
          "node_modules/vitest/vitest.mjs",
          "run",
          test.file.filepath,
          "--reporter=default",
          "--reporter=json",
          `--outputFile.json=${report}`,
          "--testNamePattern",
          pattern,
          "--project",
          this.config.name,
          "--maxWorkers=1",
          "--no-file-parallelism",
        ],
        {
          cwd: this.config.root,
          env: {...process.env, LODESTAR_NATIVE_CASE: test.id},
          timeout: Math.max(test.timeout ?? 5000, 15000) + 30000,
          maxBuffer: 2 * 1024 * 1024,
        }
      );
      const result = JSON.parse(await readFile(report, "utf8"));
      if (result.numPassedTests !== 1 || result.numFailedTests !== 0)
        throw new Error(`Expected one passing isolated test: ${test.name}`);
    } catch (error) {
      throw new Error(`${error.message}\n${error.stdout?.slice(-12000) ?? ""}\n${error.stderr?.slice(-12000) ?? ""}`);
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  }
}
