import {execFileSync} from "node:child_process";
import {createWriteStream} from "node:fs";
import {copyFile, mkdir, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {fileURLToPath} from "node:url";
import axios from "axios";

const revision = "c0c411ae9215e0f72a00d52e32e267b30ef48606";
const archiveRoot = `ere-${revision}`;
const zkvms = ["openvm", "sp1", "zisk"];
const files = ["program_vk.bin", "proof.bin", "public_values.bin"];
const outputDir = fileURLToPath(new URL("../packages/beacon-node/test/fixtures/executionProofs/", import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), "lodestar-execution-proofs-"));

try {
  const archivePath = path.join(tempDir, "ere.tar.gz");
  const url = `https://codeload.github.com/eth-act/ere/tar.gz/${revision}`;
  console.log(`Downloading execution proof fixtures from ${url}`);
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 60_000,
    signal: AbortSignal.timeout(60_000),
  });
  await pipeline(response.data, createWriteStream(archivePath));

  const members = zkvms.flatMap((zkvm) =>
    files.map((file) => `${archiveRoot}/crates/verifier/${zkvm}/tests/fixtures/${file}`)
  );
  members.push(`${archiveRoot}/LICENSE-MIT`);
  execFileSync("tar", ["-xzf", archivePath, "-C", tempDir, ...members], {stdio: "inherit"});

  for (const zkvm of zkvms) {
    const sourceDir = path.join(tempDir, archiveRoot, "crates/verifier", zkvm, "tests/fixtures");
    const destinationDir = path.join(outputDir, zkvm);
    await mkdir(destinationDir, {recursive: true});
    for (const file of files) {
      await copyFile(path.join(sourceDir, file), path.join(destinationDir, file));
    }
  }
  await copyFile(path.join(tempDir, archiveRoot, "LICENSE-MIT"), path.join(outputDir, "LICENSE-MIT"));
  console.log(`Execution proof fixtures ready in ${outputDir}`);
} finally {
  await rm(tempDir, {recursive: true, force: true});
}
