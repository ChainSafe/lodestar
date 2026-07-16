import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Readable} from "node:stream";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {downloadComptests} from "../../src/downloadComptests.js";

/* eslint-disable @typescript-eslint/naming-convention */

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@lodestar/utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("@lodestar/utils")>();
  return {...original, fetch: fetchMock};
});

describe("downloadComptests", () => {
  let workDir: string;
  let outputDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "comptests-test-"));
    outputDir = path.join(workDir, "spec-tests");
    fs.mkdirSync(outputDir, {recursive: true});
    fetchMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(workDir, {recursive: true, force: true});
  });

  /** Build a comptests.tar.gz containing `tests/minimal/<fork>/fork_choice_compliance/<case>` */
  function makeTarball(forks: Record<string, string[]>): Uint8Array {
    const stageDir = path.join(workDir, `stage-${Math.random().toString(36).slice(2)}`);
    for (const [fork, cases] of Object.entries(forks)) {
      for (const testCase of cases) {
        const caseDir = path.join(stageDir, "tests/minimal", fork, "fork_choice_compliance/block_tree_test", testCase);
        fs.mkdirSync(caseDir, {recursive: true});
        fs.writeFileSync(path.join(caseDir, "steps.yaml"), `- {tick: 0} # ${fork}/${testCase}`);
      }
    }
    // Junk dirs present in the real asset
    fs.mkdirSync(path.join(stageDir, "tests/core/pyspec"), {recursive: true});
    const tarPath = path.join(workDir, `fixture-${Math.random().toString(36).slice(2)}.tar.gz`);
    execFileSync("tar", ["-czf", tarPath, "-C", stageDir, "tests"]);
    return fs.readFileSync(tarPath);
  }

  function mockFetchTarball(bytes: Uint8Array): void {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: {get: () => String(bytes.length)},
      body: Readable.toWeb(Readable.from([bytes])),
    });
  }

  function writeStandardFixture(): string {
    const standardFile = path.join(outputDir, "tests/minimal/altair/fork_choice/on_block/case_0/steps.yaml");
    fs.mkdirSync(path.dirname(standardFile), {recursive: true});
    fs.writeFileSync(standardFile, "- {tick: 0}");
    fs.writeFileSync(path.join(outputDir, "version.txt"), "v1.7.0-alpha.12");
    return standardFile;
  }

  const opts = (specVersion: string) => ({specVersion, outputDir});

  it("installs comptests without touching standard fixtures", async () => {
    const standardFile = writeStandardFixture();
    mockFetchTarball(makeTarball({altair: ["case_a"], deneb: ["case_b"]}));

    await downloadComptests(opts("v1.7.0-alpha.12"));

    expect(fs.existsSync(standardFile)).toBe(true);
    expect(fs.readFileSync(path.join(outputDir, "version.txt"), "utf8")).toBe("v1.7.0-alpha.12");
    for (const fork of ["altair", "deneb"]) {
      expect(fs.existsSync(path.join(outputDir, "tests/minimal", fork, "fork_choice_compliance"))).toBe(true);
    }
    expect(fs.readFileSync(path.join(outputDir, "comptests-version.txt"), "utf8")).toBe("v1.7.0-alpha.12");
    // Junk dirs from the tarball are not merged
    expect(fs.existsSync(path.join(outputDir, "tests/core"))).toBe(false);
  });

  it("refresh on version change replaces comptest paths, preserves standard, removes stale forks", async () => {
    const standardFile = writeStandardFixture();
    mockFetchTarball(makeTarball({altair: ["old_case"], bellatrix: ["stale_case"]}));
    await downloadComptests(opts("v1.7.0-alpha.11"));

    mockFetchTarball(makeTarball({altair: ["new_case"]}));
    await downloadComptests(opts("v1.7.0-alpha.12"));

    expect(fs.existsSync(standardFile)).toBe(true);
    const altairCompliance = path.join(outputDir, "tests/minimal/altair/fork_choice_compliance/block_tree_test");
    expect(fs.readdirSync(altairCompliance)).toEqual(["new_case"]);
    // bellatrix dropped upstream => no stale cases left behind
    expect(fs.existsSync(path.join(outputDir, "tests/minimal/bellatrix/fork_choice_compliance"))).toBe(false);
    expect(fs.readFileSync(path.join(outputDir, "comptests-version.txt"), "utf8")).toBe("v1.7.0-alpha.12");
  });

  it("cache hit does not fetch", async () => {
    mockFetchTarball(makeTarball({altair: ["case_a"]}));
    await downloadComptests(opts("v1.7.0-alpha.12"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await downloadComptests(opts("v1.7.0-alpha.12"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("failed extraction leaves existing fixtures and marker untouched", async () => {
    const standardFile = writeStandardFixture();
    mockFetchTarball(makeTarball({altair: ["good_case"]}));
    await downloadComptests(opts("v1.7.0-alpha.11"));

    // Corrupt tarball on refresh
    fetchMock.mockResolvedValue({
      ok: true,
      headers: {get: () => "12"},
      body: Readable.toWeb(Readable.from([new Uint8Array([0x1f, 0x8b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])])),
    });
    await expect(downloadComptests(opts("v1.7.0-alpha.12"))).rejects.toThrow();

    expect(fs.existsSync(standardFile)).toBe(true);
    expect(
      fs.existsSync(path.join(outputDir, "tests/minimal/altair/fork_choice_compliance/block_tree_test/good_case"))
    ).toBe(true);
    expect(fs.readFileSync(path.join(outputDir, "comptests-version.txt"), "utf8")).toBe("v1.7.0-alpha.11");
  });

  it("marker with a different version is treated as stale and redownloads", async () => {
    fs.writeFileSync(path.join(outputDir, "comptests-version.txt"), "v1.7.0-alpha.11\n");
    mockFetchTarball(makeTarball({altair: ["case_a"]}));

    await downloadComptests(opts("v1.7.0-alpha.12"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(outputDir, "comptests-version.txt"), "utf8")).toBe("v1.7.0-alpha.12");
  });
});
