import {lstatSync} from "fs";

export function isDirectory(path: string): boolean {
  return lstatSync(path).isDirectory();
}
