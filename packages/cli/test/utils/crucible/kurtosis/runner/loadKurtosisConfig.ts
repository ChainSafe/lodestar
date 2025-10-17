/**
 * Loader for YAML input into a KurtosisNetworkConfig
 * Tries multiple sensible locations so tests don't need to care about cwd.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {parse} from "yaml";
import type {KurtosisNetworkConfig} from "../runner/kurtosisTypes.js";

export async function loadKurtosisConfig(
  fileName: string,
  baseDir?: string
): Promise<KurtosisNetworkConfig> {
  // If the file name is an absolute path, use it as-is.
  if (path.isAbsolute(fileName)) {
    const raw = await fs.readFile(fileName, "utf8");
    return parse(raw) as KurtosisNetworkConfig;
  }

  // Resolve module dir (where this loader lives)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // If a base directory is provided, use it to construct a candidate path
  const candidates: string[] = baseDir ? [path.join(baseDir, fileName)] : [];

  
  candidates.push(path.resolve(process.cwd(), fileName));

  // 4) Try the default Kurtosis test configs folder relative to this module:
  //    utils/crucible/kurtosis/test/*.yml
  const defaultTestDir = path.resolve(__dirname, "..", "test");
  candidates.push(path.join(defaultTestDir, fileName));

  // 5) Fallback to relative to this module’s dir
  candidates.push(path.resolve(__dirname, fileName));

  // Read the first existing candidate; collect missing ones for a nice error
  const tried: string[] = [];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf8");
      return parse(raw) as KurtosisNetworkConfig;
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        tried.push(p);
        continue;
      }
      // Surface non-ENOENT errors immediately (e.g. perms, YAML syntax)
      throw e;
    }
  }

  // Initiate an error response that enumerates each attempted route.
  throw new Error(
    `Kurtosis config not found for "${fileName}". Tried:\n` +
    tried.map((p) => `  - ${p}`).join("\n")
  );
}
