import {getVersionData} from "./version.js";

const lodestarPackageName = "Lodestar";

/**
 * Computes a default graffiti fetching dynamically the package info.
 * @returns a string containing package name and version.
 */
export function getDefaultGraffiti(): string {
  try {
    const {version} = getVersionData();
    return `${lodestarPackageName}-${version}`;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Error guessing lodestar version", e as Error);
    return lodestarPackageName;
  }
}
