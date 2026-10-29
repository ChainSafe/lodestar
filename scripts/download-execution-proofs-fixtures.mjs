import {execFileSync} from "node:child_process";
import {createWriteStream} from "node:fs";
import {copyFile, mkdir, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {fileURLToPath} from "node:url";
import axios from "axios";

// ere's own fixtures: test programs proven by each zkVM, at the ere revision the pinned lodestar-z verifier was built from
const ereRevision = "24118285f6e9b8115b3ad568775f7fe55ff78bf5";
const ereArchiveRoot = `ere-${ereRevision}`;
const ereZkvms = ["openvm", "sp1", "zisk"];
const ereFiles = ["program_vk.bin", "proof.bin", "public_values.bin"];

// Sepolia fixtures: stateless-validator proofs from zkboost's mock beacon node with the guest keys they verify against
const zkboostTag = "v0.19.1";
const ereGuestsTag = "v0.19.0";
const sepoliaGuests = [
  "ethrex-openvm-v2.1.0-preview",
  "ethrex-sp1-v6.9.0",
  "ethrex-zisk-v1.3.2-alpha",
  "reth-openvm-v2.1.0-preview",
  "reth-sp1-v6.9.0",
  "reth-zisk-v1.3.2-alpha",
  "nimbus-sp1-v6.9.0",
  "nimbus-zisk-v1.3.2-alpha",
  "nethermind-sp1-v6.9.0",
  "nethermind-zisk-v1.3.2-alpha",
  "zilkworm-sp1-v6.9.0",
];

const outputDir = fileURLToPath(new URL("../packages/beacon-node/test/fixtures/executionProofs/", import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), "lodestar-execution-proofs-"));

async function download(url, destination) {
  console.log(`Downloading ${url}`);
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 60_000,
    signal: AbortSignal.timeout(60_000),
  });
  await mkdir(path.dirname(destination), {recursive: true});
  await pipeline(response.data, createWriteStream(destination));
}

try {
  const archivePath = path.join(tempDir, "ere.tar.gz");
  await download(`https://codeload.github.com/eth-act/ere/tar.gz/${ereRevision}`, archivePath);

  const members = ereZkvms.flatMap((zkvm) =>
    ereFiles.map((file) => `${ereArchiveRoot}/crates/verifier/${zkvm}/tests/fixtures/${file}`)
  );
  members.push(`${ereArchiveRoot}/LICENSE-MIT`);
  execFileSync("tar", ["-xzf", archivePath, "-C", tempDir, ...members], {stdio: "inherit"});

  for (const zkvm of ereZkvms) {
    const sourceDir = path.join(tempDir, ereArchiveRoot, "crates/verifier", zkvm, "tests/fixtures");
    const destinationDir = path.join(outputDir, zkvm);
    await mkdir(destinationDir, {recursive: true});
    for (const file of ereFiles) {
      await copyFile(path.join(sourceDir, file), path.join(destinationDir, file));
    }
  }
  await copyFile(path.join(tempDir, ereArchiveRoot, "LICENSE-MIT"), path.join(outputDir, "LICENSE-MIT"));

  const sepoliaDir = path.join(outputDir, "sepolia");
  const zkboostFixtures = `https://raw.githubusercontent.com/eth-act/zkboost/${zkboostTag}/crates/mock-beacon-node/tests/fixture`;
  for (const guest of sepoliaGuests) {
    await download(`${zkboostFixtures}/stateless-validator-${guest}.proof`, path.join(sepoliaDir, `${guest}.proof`));
    await download(
      `https://github.com/eth-act/ere-guests/releases/download/${ereGuestsTag}/stateless-validator-${guest}.vk`,
      path.join(sepoliaDir, `${guest}.vk`)
    );
  }
  await download(`${zkboostFixtures}/public_values.bin`, path.join(sepoliaDir, "public_values.bin"));
  await download(
    `https://raw.githubusercontent.com/eth-act/ere-guests/${ereGuestsTag}/LICENSE-MIT`,
    path.join(sepoliaDir, "LICENSE-MIT")
  );
  console.log(`Execution proof fixtures ready in ${outputDir}`);
} finally {
  await rm(tempDir, {recursive: true, force: true});
}
