import os from "os";
import path from "path";
import {TestnetName} from "../testnets";

/**
 * Follows XDG Base Directory Specification
 * https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html#basics
 */
export function getDefaultRootDir(testnet?: TestnetName): string {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const lodestarHome = path.join(dataHome, "lodestar");
  return path.join(lodestarHome, testnet || "mainnet");
}
