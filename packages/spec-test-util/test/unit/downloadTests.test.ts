import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {fetch} from "@lodestar/utils";
import {createDownloadProgressReporter} from "../../src/downloadProgress.js";
import {downloadGenericSpecTests} from "../../src/downloadTests.js";

vi.mock("@lodestar/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lodestar/utils")>();
  return {
    ...actual,
    fetch: vi.fn(),
  };
});

type TestConsoleWrite = typeof process.stdout.write;

const fetchMock = vi.mocked(fetch);
const createdDirs: string[] = [];
const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

describe("downloadGenericSpecTests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    fetchMock.mockReset();
    restoreStdoutIsTTY();

    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        fs.rmSync(dir, {recursive: true, force: true});
      }
    }
  });

  it("downloads only missing archives when resuming the same version", async () => {
    const outputDir = createTempDir();
    const version = "v1.7.0-alpha.3";
    const stateDir = path.join(outputDir, ".download-state");
    fs.mkdirSync(stateDir, {recursive: true});
    fs.writeFileSync(path.join(outputDir, "version.txt"), version);
    fs.closeSync(fs.openSync(path.join(stateDir, "general.done"), "w"));
    fs.mkdirSync(path.join(outputDir, "tests", "general"), {recursive: true});
    fs.writeFileSync(path.join(outputDir, "tests", "general", "existing.txt"), "general");

    const archiveFixtures = {
      "mainnet.tar.gz": createArchiveFixture("mainnet", {"tests/mainnet/file.txt": "mainnet"}),
      "minimal.tar.gz": createArchiveFixture("minimal", {"tests/minimal/file.txt": "minimal"}),
    };
    setFetchMock(archiveFixtures);

    const logs: string[] = [];
    await downloadGenericSpecTests(
      {
        specVersion: version,
        outputDir,
        specTestsRepoUrl: "https://example.test/specs",
        testsToDownload: ["general", "mainnet", "minimal"],
      },
      (message) => logs.push(message)
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(path.join(outputDir, "tests", "general", "existing.txt"), "utf8")).toBe("general");
    expect(fs.readFileSync(path.join(outputDir, "tests", "mainnet", "file.txt"), "utf8")).toBe("mainnet");
    expect(fs.readFileSync(path.join(outputDir, "tests", "minimal", "file.txt"), "utf8")).toBe("minimal");
    expect(fs.existsSync(path.join(stateDir, "general.done"))).toBe(true);
    expect(fs.existsSync(path.join(stateDir, "mainnet.done"))).toBe(true);
    expect(fs.existsSync(path.join(stateDir, "minimal.done"))).toBe(true);
    expect(logs).toContain(`Resuming version ${version}`);
  });

  it("migrates a legacy complete download that only has version.txt", async () => {
    const outputDir = createTempDir();
    const version = "v1.7.0-alpha.3";
    fs.mkdirSync(path.join(outputDir, "tests", "general"), {recursive: true});
    fs.writeFileSync(path.join(outputDir, "tests", "general", "existing.txt"), "general");
    fs.writeFileSync(path.join(outputDir, "version.txt"), version);

    const logs: string[] = [];
    await downloadGenericSpecTests(
      {
        specVersion: version,
        outputDir,
        specTestsRepoUrl: "https://example.test/specs",
        testsToDownload: ["general"],
      },
      (message) => logs.push(message)
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(outputDir, ".download-state", "general.done"))).toBe(true);
    expect(logs).toContain(`version ${version} already downloaded`);
  });

  it("cleans an existing directory when the version changes", async () => {
    const outputDir = createTempDir();
    fs.writeFileSync(path.join(outputDir, "version.txt"), "v1.6.0");
    fs.writeFileSync(path.join(outputDir, "stale.txt"), "stale");

    setFetchMock({
      "general.tar.gz": createArchiveFixture("general", {"tests/general/file.txt": "fresh"}),
    });

    await downloadGenericSpecTests(
      {
        specVersion: "v1.7.0-alpha.3",
        outputDir,
        specTestsRepoUrl: "https://example.test/specs",
        testsToDownload: ["general"],
      },
      () => {}
    );

    expect(fs.existsSync(path.join(outputDir, "stale.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(outputDir, "version.txt"), "utf8")).toBe("v1.7.0-alpha.3");
    expect(fs.readFileSync(path.join(outputDir, "tests", "general", "file.txt"), "utf8")).toBe("fresh");
  });

  it("cleans an unknown partial directory when version.txt is missing", async () => {
    const outputDir = createTempDir();
    fs.writeFileSync(path.join(outputDir, "stale.txt"), "stale");

    setFetchMock({
      "general.tar.gz": createArchiveFixture("general", {"tests/general/file.txt": "fresh"}),
    });

    await downloadGenericSpecTests(
      {
        specVersion: "v1.7.0-alpha.3",
        outputDir,
        specTestsRepoUrl: "https://example.test/specs",
        testsToDownload: ["general"],
      },
      () => {}
    );

    expect(fs.existsSync(path.join(outputDir, "stale.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(outputDir, "tests", "general", "file.txt"), "utf8")).toBe("fresh");
  });

  it("keeps completed archives when another archive fails", async () => {
    const outputDir = createTempDir();
    const invalidArchive = path.join(createTempDir(), "invalid.tar.gz");
    fs.writeFileSync(invalidArchive, "not a tarball");

    setFetchMock({
      "general.tar.gz": createArchiveFixture("general", {"tests/general/file.txt": "general"}),
      "mainnet.tar.gz": invalidArchive,
    });

    await expect(
      downloadGenericSpecTests(
        {
          specVersion: "v1.7.0-alpha.3",
          outputDir,
          specTestsRepoUrl: "https://example.test/specs",
          testsToDownload: ["general", "mainnet"],
        },
        () => {}
      )
    ).rejects.toThrow();

    expect(fs.readFileSync(path.join(outputDir, "tests", "general", "file.txt"), "utf8")).toBe("general");
    expect(fs.existsSync(path.join(outputDir, ".download-state", "general.done"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, ".download-state", "mainnet.done"))).toBe(false);
  });

  it("retries a failed extraction and cleans up the temporary tarball", async () => {
    const outputDir = createTempDir();
    const invalidArchive = path.join(createTempDir(), "invalid.tar.gz");
    fs.writeFileSync(invalidArchive, "not a tarball");

    let attempts = 0;
    fetchMock.mockImplementation(async (url) => {
      const archiveName = getArchiveName(url);
      attempts++;
      if (archiveName !== "general.tar.gz") {
        throw new Error(`Unexpected archive ${archiveName}`);
      }

      return createArchiveResponse(
        attempts === 1 ? invalidArchive : createArchiveFixture("general", {"tests/general/file.txt": "general"})
      );
    });

    await downloadGenericSpecTests(
      {
        specVersion: "v1.7.0-alpha.3",
        outputDir,
        specTestsRepoUrl: "https://example.test/specs",
        testsToDownload: ["general"],
      },
      () => {}
    );

    expect(attempts).toBe(2);
    expect(fs.readFileSync(path.join(outputDir, "tests", "general", "file.txt"), "utf8")).toBe("general");
    expect(fs.existsSync(path.join(outputDir, "general.tar.gz.part"))).toBe(false);
  });

  it("does not write a done marker when extraction never succeeds", async () => {
    const outputDir = createTempDir();
    const invalidArchive = path.join(createTempDir(), "invalid.tar.gz");
    fs.writeFileSync(invalidArchive, "not a tarball");

    setFetchMock({
      "general.tar.gz": invalidArchive,
    });

    await expect(
      downloadGenericSpecTests(
        {
          specVersion: "v1.7.0-alpha.3",
          outputDir,
          specTestsRepoUrl: "https://example.test/specs",
          testsToDownload: ["general"],
        },
        () => {}
      )
    ).rejects.toThrow();

    expect(fs.existsSync(path.join(outputDir, ".download-state", "general.done"))).toBe(false);
  });

  it("logs plain progress milestones outside of TTY mode", async () => {
    setStdoutIsTTY(false);
    const outputDir = createTempDir();
    const logs: string[] = [];

    setFetchMock({
      "general.tar.gz": createArchiveFixture("general", {"tests/general/file.txt": "general"}, 16),
    });

    await downloadGenericSpecTests(
      {
        specVersion: "v1.7.0-alpha.3",
        outputDir,
        specTestsRepoUrl: "https://example.test/specs",
        testsToDownload: ["general"],
      },
      (message) => logs.push(message)
    );

    expect(logs.some((message) => message.startsWith("Downloading general.tar.gz -"))).toBe(true);
    expect(logs.some((message) => message.includes("general.tar.gz 100%"))).toBe(true);
    expect(logs.some((message) => message.startsWith("Downloaded general.tar.gz - "))).toBe(true);
    expect(logs).toContain(`Extracted general.tar.gz to ${outputDir}`);
    expect(logs.every((message) => !message.includes("\r"))).toBe(true);
  });
});

describe("createDownloadProgressReporter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    restoreStdoutIsTTY();
  });

  it("updates tty progress in place instead of logging a new line per update", () => {
    vi.useFakeTimers();
    setStdoutIsTTY(true);

    const log = vi.fn();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as TestConsoleWrite);
    const reporter = createDownloadProgressReporter({log, enabled: true});

    reporter.start("mainnet.tar.gz", 100);
    vi.advanceTimersByTime(100);
    reporter.update("mainnet.tar.gz", 50);
    vi.advanceTimersByTime(100);
    reporter.close();

    expect(log).not.toHaveBeenCalled();
    expect(writeSpy.mock.calls.some(([value]) => String(value).includes("mainnet.tar.gz ["))).toBe(true);
    expect(writeSpy.mock.calls.some(([value]) => String(value).includes("\u001b["))).toBe(true);
  });
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-spec-test-util-"));
  createdDirs.push(dir);
  return dir;
}

function createArchiveFixture(archiveName: string, files: Record<string, string>, chunkSize = 32): string {
  const fixtureDir = createTempDir();
  const sourceDir = path.join(fixtureDir, `source-${archiveName}`);
  fs.mkdirSync(sourceDir, {recursive: true});

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(sourceDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), {recursive: true});
    fs.writeFileSync(absolutePath, content);
  }

  const archivePath = path.join(fixtureDir, `${archiveName}.tar.gz`);
  execFileSync("tar", ["-czf", archivePath, "-C", sourceDir, "."]);
  fs.writeFileSync(`${archivePath}.chunk-size`, String(chunkSize));
  return archivePath;
}

function setFetchMock(archivesByName: Record<string, string>): void {
  fetchMock.mockImplementation(async (url) => {
    const archiveName = getArchiveName(url);
    const archivePath = archivesByName[archiveName];
    if (!archivePath) {
      throw new Error(`Unexpected archive ${archiveName}`);
    }

    return createArchiveResponse(archivePath);
  });
}

function createArchiveResponse(archivePath: string): Response {
  const bytes = fs.readFileSync(archivePath);
  const chunkSizeFile = `${archivePath}.chunk-size`;
  const chunkSize = fs.existsSync(chunkSizeFile) ? Number.parseInt(fs.readFileSync(chunkSizeFile, "utf8"), 10) : 32;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += chunkSize) {
        controller.enqueue(bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      "content-length": String(bytes.length),
    },
  });
}

function getArchiveName(url: string | URL | Request): string {
  const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  const pathname = new URL(href).pathname;
  return pathname.slice(pathname.lastIndexOf("/") + 1);
}

function setStdoutIsTTY(isTTY: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: isTTY,
  });
}

function restoreStdoutIsTTY(): void {
  if (stdoutIsTTYDescriptor) {
    Object.defineProperty(process.stdout, "isTTY", stdoutIsTTYDescriptor);
    return;
  }

  Reflect.deleteProperty(process.stdout as NodeJS.WriteStream & {isTTY?: boolean}, "isTTY");
}
