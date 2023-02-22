import os from "node:os";
import path from "node:path";
import system from "systeminformation";
import {Logger} from "@lodestar/utils";

type MiscOs = "lin" | "win" | "mac" | "unk";

// static data only needs to be collected once
let staticDataCollected = false;
// disk I/O is not measurable in some environments
let diskIOMeasurable = true;

let cpuCores = 0;
let cpuThreads = 0;
let cpuNodeSystemSecondsTotal = 0;
let cpuNodeUserSecondsTotal = 0;
let cpuNodeIdleSecondsTotal = 0;
let memoryNodeBytesTotal = 0;
let memoryNodeBytesFree = 0;
let memoryNodeBytesCached = 0;
let memoryNodeBytesBuffers = 0;
let diskNodeBytesTotal = 0;
let diskNodeBytesFree = 0;
let diskNodeReadsTotal = 0;
let diskNodeWritesTotal = 0;
let networkNodeBytesTotalReceive = 0;
let networkNodeBytesTotalTransmit = 0;
let miscNodeBootTsSeconds = 0;
let miscOs: MiscOs = "unk";

/**
 * Collect system data and update cached values
 */
export async function collectSystemData(logger: Logger): Promise<void> {
  const debug = (dataType: string, e: Error): void => logger.debug(`Failed to collect ${dataType} data`, {}, e);

  await Promise.all([
    collectStaticData().catch((e) => debug("static system", e)),
    collectCpuData().catch((e) => debug("CPU", e)),
    collectMemoryData().catch((e) => debug("memory", e)),
    collectDiskData().catch((e) => debug("disk", e)),
    collectNetworkData().catch((e) => debug("network", e)),
  ]);

  miscNodeBootTsSeconds = getSystemBootTime();
}

async function collectStaticData(): Promise<void> {
  if (staticDataCollected) return;

  const cpu = await system.cpu();
  // Note: inside container this might be inaccurate as
  // physicalCores in some cases is the count of logical CPU cores
  cpuCores = cpu.physicalCores;
  cpuThreads = cpu.cores;

  miscOs = getNormalizedOsVersion();

  staticDataCollected = true;
}

async function collectCpuData(): Promise<void> {
  const cpuTimes: Record<string, number> = {};

  os.cpus().forEach((cpu) => {
    // sum up CPU times per mode and convert to seconds
    for (const [mode, time] of Object.entries(cpu.times)) {
      if (cpuTimes[mode] == null) cpuTimes[mode] = 0;
      cpuTimes[mode] += Math.floor(time / 1000);
    }
  });

  // Note: currently beaconcha.in expects system CPU seconds to be everything
  cpuNodeSystemSecondsTotal = Object.values(cpuTimes).reduce((total, time) => total + time, 0);
  cpuNodeUserSecondsTotal = cpuTimes.user;
  cpuNodeIdleSecondsTotal = cpuTimes.idle;
}

async function collectMemoryData(): Promise<void> {
  const memory = await system.mem();
  memoryNodeBytesTotal = memory.total;
  memoryNodeBytesFree = memory.free;
  memoryNodeBytesCached = memory.cached;
  memoryNodeBytesBuffers = memory.buffers;
}

async function collectDiskData(): Promise<void> {
  const fileSystems = await system.fsSize();
  // get file system root, on windows this is the name of the hard disk partition
  const rootFs = process.platform === "win32" ? process.cwd().split(path.sep)[0] : "/";
  // only consider root file system, if it does not exist use first entry in the list
  const fileSystem = fileSystems.find((fs) => fs.mount === rootFs) ?? fileSystems[0];
  diskNodeBytesTotal = fileSystem.size;
  diskNodeBytesFree = fileSystem.available;

  if (diskIOMeasurable) {
    const disk = await system.disksIO();
    if (disk != null && disk.rIO !== 0) {
      // Note: rIO and wIO might not be available inside container
      // see https://github.com/sebhildebrandt/systeminformation/issues/777
      diskNodeReadsTotal = disk.rIO;
      diskNodeWritesTotal = disk.wIO;
    } else {
      diskIOMeasurable = false;
    }
  }
}

async function collectNetworkData(): Promise<void> {
  // defaults to first external network interface
  const [network] = await system.networkStats();
  // Note: rx_bytes and tx_bytes will be inaccurate if process
  // runs inside container as it only captures local network traffic
  networkNodeBytesTotalReceive = network.rx_bytes;
  networkNodeBytesTotalTransmit = network.tx_bytes;
}

function getNormalizedOsVersion(): MiscOs {
  switch (process.platform) {
    case "linux":
      return "lin";
    case "darwin":
      return "mac";
    case "win32":
      return "win";
    default:
      return "unk";
  }
}

function getSystemBootTime(): number {
  return Math.floor(Date.now() / 1000 - os.uptime());
}

/**
 * Number of CPU cores available
 */
export function getCpuCores(): number {
  return cpuCores;
}

/**
 * Number of CPU threads available
 */
export function getCpuThreads(): number {
  return cpuThreads;
}

/**
 * CPU seconds consumed by all processes
 */
export function getCpuNodeSystemSecondsTotal(): number {
  return cpuNodeSystemSecondsTotal;
}

/**
 * CPU seconds consumed by user processes
 */
export function getCpuNodeUserSecondsTotal(): number {
  return cpuNodeUserSecondsTotal;
}

/**
 * CPU seconds spent in I/O wait state
 */
export function getCpuNodeIOWaitSecondsTotal(): number {
  // Note: not measured by os.cpus()
  return 0;
}

/**
 * CPU seconds spent in idle state
 */
export function getCpuNodeIdleSecondsTotal(): number {
  return cpuNodeIdleSecondsTotal;
}

/**
 * Total amount of memory in bytes available
 */
export function getMemoryNodeBytesTotal(): number {
  return memoryNodeBytesTotal;
}

/**
 * Amount of free memory in bytes
 */
export function getMemoryNodeBytesFree(): number {
  return memoryNodeBytesFree;
}

/**
 * Amount of memory in bytes used by cache
 */
export function getMemoryNodeBytesCached(): number {
  return memoryNodeBytesCached;
}

/**
 * Amount of memory in bytes used by buffers
 */
export function getMemoryNodeBytesBuffers(): number {
  return memoryNodeBytesBuffers;
}

/**
 * Total amount of available disk space in bytes
 */
export function getDiskNodeBytesTotal(): number {
  return diskNodeBytesTotal;
}

/**
 * Amount of free disk space in bytes
 */
export function getDiskNodeBytesFree(): number {
  return diskNodeBytesFree;
}

/**
 * Total time spent in seconds on disk I/O operations
 */
export function getDiskNodeIOSeconds(): number {
  // Note: currently unused by beaconcha.in
  return 0;
}

/**
 * Total number of disk read I/O operations
 */
export function getDiskNodeReadsTotal(): number {
  return diskNodeReadsTotal;
}

/**
 * Total number of disk write I/O operations
 */
export function getDiskNodeWritesTotal(): number {
  return diskNodeWritesTotal;
}

/**
 * Total amount of bytes received over the network
 */
export function getNetworkNodeBytesTotalReceive(): number {
  return networkNodeBytesTotalReceive;
}

/**
 * Total amount of bytes transmitted over the network
 */
export function getNetworkNodeBytesTotalTransmit(): number {
  return networkNodeBytesTotalTransmit;
}

/**
 * Unix timestamp in seconds of boot time
 */
export function getMiscNodeBootTsSeconds(): number {
  return miscNodeBootTsSeconds;
}

/**
 * Operating system, can be one of: lin, win, mac, unk for unknown
 */
export function getMiscOs(): MiscOs {
  return miscOs;
}
