/* eslint-disable no-console */
import fs from "fs";
import {resolve} from "path";
import {watch, WatchOptions} from "chokidar";

type WatchListener = (
  eventName: "add" | "addDir" | "change" | "unlink" | "unlinkDir",
  path: string,
  stats?: fs.Stats
) => void;

interface WatchProps {
  path: string;
  opts?: WatchOptions;
  waitUntilRead?: boolean;
  consoleOnNoHandler?: boolean;
  onAdd?: WatchListener;
  onAddDir?: WatchListener;
  onChange?: WatchListener;
  onUnlink?: WatchListener;
  onUnlinkDir?: WatchListener;
}

export async function watchFolder({
  path,
  opts,
  consoleOnNoHandler = false,
  onAdd,
  onAddDir,
  onChange,
  onUnlink,
  onUnlinkDir,
}: WatchProps): Promise<void> {
  const defaultHandler = (event: string, filename: string): void => {
    if (consoleOnNoHandler) {
      console.log(`default handler for ${event} ${filename}`);
    }
  };

  const watcher = watch(path, opts);
  watcher.on("all", (event, filepath) => {
    switch (event) {
      case "add":
        console.log(`file added: ${filepath}`);
        return onAdd ? onAdd(event, filepath) : defaultHandler(event, filepath);
      case "addDir":
        console.log(`dir added: ${filepath}`);
        return onAddDir ? onAddDir(event, filepath) : defaultHandler(event, filepath);
      case "change":
        console.log(`file changed: ${filepath}`);
        return onChange ? onChange(event, filepath) : defaultHandler(event, filepath);
      case "unlink":
        console.log(`file deleted: ${filepath}`);
        return onUnlink ? onUnlink(event, filepath) : defaultHandler(event, filepath);
      case "unlinkDir":
        console.log(`dir deleted: ${filepath}`);
        return onUnlinkDir ? onUnlinkDir(event, filepath) : defaultHandler(event, filepath);
      default:
        console.log(`watched file triggered event: ${filepath}`);
        return defaultHandler(event, filepath);
    }
  });
}

export async function watchCopyFolder(source: string, target: string, opts?: WatchOptions): Promise<void> {
  function onChange(_: string, filepath: string): Promise<void> {
    const filename = filepath.replace(`${source}/`, "");
    return fs.promises.copyFile(filepath, resolve(target, filename));
  }

  function onAddDir(_: string, filepath: string): Promise<void> {
    const filename = filepath.replace(`${source}/`, "");
    return fs.promises.mkdir(resolve(target, filename));
  }

  function onUnlink(_: string, filepath: string): Promise<void> {
    const filename = filepath.replace(`${source}/`, "");
    return fs.promises.unlink(resolve(target, filename)).catch(() => {
      console.log(`Could not delete ${filename}`);
    });
  }

  function onUnlinkDir(_: string, filepath: string): Promise<void> {
    const filename = filepath.replace(`${source}/`, "");
    return fs.promises.rmdir(resolve(target, filename), {recursive: true}).catch(() => {
      console.log(`Could not delete ${filename}`);
    });
  }

  return watchFolder({
    path: source,
    opts,
    consoleOnNoHandler: true,
    onChange,
    onAdd: onChange,
    onAddDir: onAddDir,
    onUnlink,
    onUnlinkDir,
  });
}

export function debouncedCallback<T>(timeout: number, cb: () => T): () => T | void {
  let debounceTimeout: undefined | NodeJS.Timeout;
  return function debounced(): T | void {
    if (!debounceTimeout) {
      debounceTimeout = setTimeout(() => {
        if (debounceTimeout) {
          clearTimeout(debounceTimeout);
        }
        debounceTimeout = undefined;
      }, timeout);
      return cb();
    }
  };
}

function defaultOnWatchErr(err: unknown): void {
  console.error(err);
  process.exit(1);
}

export function watchWithCallback<T>({
  path,
  debounceTime = 300,
  cb,
  onWatchErr = defaultOnWatchErr,
}: {
  path: string;
  debounceTime?: number;
  cb: () => T;
  onWatchErr?: (err: Error) => void;
}): T {
  const _cb = debouncedCallback(debounceTime, cb);
  const result = _cb() as T;
  watchFolder({
    path: path,
    onAdd: () => _cb(),
    onChange: () => _cb(),
    onUnlink: () => _cb(),
    onUnlinkDir: () => _cb(),
    onAddDir: () => {
      /* no-op */
    },
  }).catch(onWatchErr);
  return result;
}
