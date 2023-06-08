import fs from "node:fs";
import path from "node:path";
import {execSync} from "node:child_process";
import tar from "tar";
import fetch from "node-fetch";
import {SPEC_TEST_LOCATION, SPEC_TEST_VERSION, SPEC_TEST_REPO_URL, SPEC_TEST_TO_DOWNLOAD} from "./specTestVersioning";

/* eslint-disable no-console */

const specVersion = SPEC_TEST_VERSION;
const outputDir = SPEC_TEST_LOCATION;
const specTestsRepoUrl = SPEC_TEST_REPO_URL;

const versionFile = path.join(outputDir, "version.txt");
const existingVersion = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, "utf8").trim() : "none";

if (existingVersion === specVersion) {
  console.log(`version ${specVersion} already downloaded`);
  process.exit(0);
} else {
  console.log(`Downloading new version: ${specVersion} existingVersion: ${existingVersion}`);
}

if (fs.existsSync(outputDir)) {
  console.log(`Cleaning existing version ${existingVersion} at ${outputDir}`);
  shell(`rm -rf ${outputDir}`);
}

fs.mkdirSync(outputDir, {recursive: true});

const urls = SPEC_TEST_TO_DOWNLOAD.map((test) => `${specTestsRepoUrl}/releases/download/${specVersion}/${test}.tar.gz`);

downloadAndExtract(urls, outputDir)
  .then(() => {
    console.log("Downloads and extractions complete.");
    fs.writeFileSync(versionFile, specVersion);
  })
  .catch((error) => {
    console.error(`Error downloading test files: ${error}`);
    process.exit(1);
  });

function shell(cmd: string): string {
  try {
    return execSync(cmd, {encoding: "utf8"}).trim();
  } catch (error) {
    console.error(`Error executing shell command: ${cmd}`);
    throw error;
  }
}

async function downloadAndExtract(urls: string[], outputDir: string): Promise<void> {
  for (const url of urls) {
    const fileName = url.split("/").pop();
    const filePath = path.resolve(outputDir, String(fileName));
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${url}`);
    }

    await fs.promises.writeFile(filePath, response.body);

    await tar.x({
      file: filePath,
      cwd: outputDir,
    });
  }
}
