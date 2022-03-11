import os from "node:os";
import path from "node:path";
import {NetworkName} from "../networks";

/**
 * Follows XDG Base Directory Specification
 * https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html#basics
 */
export function getDefaultRootDir(network?: NetworkName): string {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "lodestar", network || "mainnet");
}
