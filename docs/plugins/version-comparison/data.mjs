import {readFile} from "node:fs/promises";
import path from "node:path";
import {commandPaths, parseCliReference, sortVersions} from "../../src/utils/cliComparison.mjs";

async function readOptional(filename) {
  try {
    return await readFile(filename, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadComparisonData(siteDir) {
  const publishedVersions = JSON.parse((await readOptional(path.join(siteDir, "versions.json"))) ?? "[]");
  const defaultVersion =
    publishedVersions.find((version) => !version.includes("-")) ?? publishedVersions[0] ?? "current";
  const versions = sortVersions(publishedVersions);
  const snapshots = await Promise.all(
    ["current", ...versions].map(async (id) => {
      const directory = path.join(siteDir, id === "current" ? "pages" : `versioned_docs/version-${id}`);
      const json = await readOptional(path.join(directory, "cli-options.json"));
      if (json !== null) {
        const manifest = JSON.parse(json);
        if (manifest.schemaVersion !== 1 || !manifest.commands)
          throw new Error(`Unsupported CLI manifest: ${directory}`);
        for (const command of Object.keys(commandPaths)) {
          const options = manifest.commands[command];
          if (
            options !== undefined &&
            (!Array.isArray(options) || options.some((option) => typeof option.name !== "string"))
          ) {
            throw new Error(`Invalid ${command} CLI manifest: ${directory}`);
          }
          if (options !== undefined) manifest.commands[command] = options.filter((option) => !option.hidden);
        }
        return {id, source: "definitions", commands: manifest.commands};
      }
      const commands = Object.fromEntries(
        await Promise.all(
          Object.entries(commandPaths).map(async ([command, reference]) => {
            const markdown = await readOptional(path.join(directory, `${reference}.md`));
            return [command, markdown === null ? null : parseCliReference(markdown, command)];
          })
        )
      );
      return {id, source: "reference", commands};
    })
  );
  return {snapshots, defaultVersion};
}
