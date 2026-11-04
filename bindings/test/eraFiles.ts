import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Parses build.zig.zon and extracts era file configuration from
 * `options_modules.download_era_options`.
 * Returns the full paths to available era files.
 */
export function getEraFilePaths(projectRoot?: string): string[] {
  const root = projectRoot ?? path.resolve(import.meta.dirname, "../..");
  const zonPath = path.join(root, "build.zig.zon");

  const content = fs.readFileSync(zonPath, "utf-8");

  // Extract era_out_dir. Allow arbitrary other fields (e.g. `.type = .string`)
  // to appear before `.default` within the option's struct.
  const outDirMatch = content.match(/\.era_out_dir\s*=\s*\.\{[^{}]*?\.default\s*=\s*"([^"]+)"/);
  const eraOutDir = outDirMatch?.[1] ?? "fixtures/era";

  // Extract era_files list. Same leniency: other fields may come first.
  const eraFilesMatch = content.match(/\.era_files\s*=\s*\.\{[^{}]*?\.default\s*=\s*\.\{([^}]+)\}/);
  if (!eraFilesMatch) {
    throw new Error("Could not find era_files in build.zig.zon");
  }

  const fileListContent = eraFilesMatch[1];
  const fileNames = [...fileListContent.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  if (fileNames.length === 0) {
    throw new Error("No era files found in build.zig.zon");
  }

  return fileNames.map((fileName) => path.join(root, eraOutDir, fileName));
}

/**
 * Returns the first available era file path.
 */
export function getFirstEraFilePath(projectRoot?: string): string {
  const paths = getEraFilePaths(projectRoot);
  return paths[0];
}

/**
 * Returns era file paths that match a pattern (e.g., "mainnet-01628").
 */
export function findEraFilePaths(pattern: string | RegExp, projectRoot?: string): string[] {
  const paths = getEraFilePaths(projectRoot);
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  return paths.filter((p) => regex.test(path.basename(p)));
}
