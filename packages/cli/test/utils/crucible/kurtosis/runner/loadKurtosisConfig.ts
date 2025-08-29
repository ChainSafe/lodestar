/**
 * Loader for YAML input into a KurtosisNetworkConfig
 * Used with *.test.ts files and during the testing phase
 */

// Loader for YAML input into a KurtosisNetworkConfig
// Used with *.test.ts files and during the testing phase

import fs from "node:fs/promises";
import path from "node:path";
import {parse} from "yaml";
import type {KurtosisNetworkConfig} from "../runner/kurtosisTypes.js";

export async function loadKurtosisConfig(fileName: string, baseDir?: string): Promise<KurtosisNetworkConfig> {
  let fullPath: string;

  if (baseDir) {
    // If baseDir is provided, treat fileName as relative to baseDir
    fullPath = path.join(baseDir, fileName);
  } else {
    // If no baseDir, treat fileName as absolute path
    fullPath = fileName;
  }

  const raw = await fs.readFile(fullPath, "utf8");
  return parse(raw) as KurtosisNetworkConfig;
}

//move the baseDir inside taking inspo from this code snippet?
/*
export class KurtosisConfigLoader {
  private static readonly CONFIG_DIR = "./test/sim/configs";
  
  static loadConfig(configName: string): KurtosisNetworkConfig {
    const configPath = resolve(this.CONFIG_DIR, `${configName}.yml`);
    const yamlContent = readFileSync(configPath, 'utf8');
    return yamlLoad(yamlContent) as KurtosisNetworkConfig;
    }
  }
}
*/
