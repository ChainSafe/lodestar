import os from "node:os";
import path from "node:path";
import system from "systeminformation";
import {Logger} from "@lodestar/utils";

type MiscOs = "lin" | "win" | "mac" | "unk";

/**
 * Singleton class to collect and provide system information
 */
class System {
  private static instance?: System;
  // static data only needs to be collected once
  private staticDataCollected = false;
  // disk I/O is not measurable in some environments
  private diskIOMeasurable = true;

  private _cpuCores = 0;
  private _cpuThreads = 0;
  private _cpuNodeSystemSecondsTotal = 0;
  private _cpuNodeUserSecondsTotal = 0;
  private _cpuNodeIdleSecondsTotal = 0;
  private _memoryNodeBytesTotal = 0;
  private _memoryNodeBytesFree = 0;
  private _memoryNodeBytesCached = 0;
  private _memoryNodeBytesBuffers = 0;
  private _diskNodeBytesTotal = 0;
  private _diskNodeBytesFree = 0;
  private _diskNodeReadsTotal = 0;
  private _diskNodeWritesTotal = 0;
  private _networkNodeBytesTotalReceive = 0;
  private _networkNodeBytesTotalTransmit = 0;
  private _miscNodeBootTsSeconds = 0;
  private _miscOs: MiscOs = "unk";

  constructor() {
    if (System.instance) return System.instance;
    System.instance = this;
  }

  /**
   * Collect system data and update cached values
   */
  async collectData(logger: Logger): Promise<void> {
    const debug = (dataType: string, e: Error): void => logger.debug(`Failed to collect ${dataType} data`, {}, e);

    await Promise.all([
      this.collectStaticData().catch((e) => debug("static system", e)),
      this.collectCpuData().catch((e) => debug("CPU", e)),
      this.collectMemoryData().catch((e) => debug("memory", e)),
      this.collectDiskData().catch((e) => debug("disk", e)),
      this.collectNetworkData().catch((e) => debug("network", e)),
    ]);

    this._miscNodeBootTsSeconds = this.getSystemBootTime();
  }

  private async collectStaticData(): Promise<void> {
    if (this.staticDataCollected) return;

    const cpu = await system.cpu();
    // Note: inside container this might be inaccurate as
    // physicalCores in some cases is the count of logical CPU cores
    this._cpuCores = cpu.physicalCores;
    this._cpuThreads = cpu.cores;

    this._miscOs = this.getNormalizedOsVersion();

    this.staticDataCollected = true;
  }

  private async collectCpuData(): Promise<void> {
    const cpuTimes: Record<string, number> = {};

    for (const cpu of os.cpus()) {
      // sum up CPU times per mode and convert to seconds
      for (const [mode, time] of Object.entries(cpu.times)) {
        if (cpuTimes[mode] == null) cpuTimes[mode] = 0;
        cpuTimes[mode] += Math.floor(time / 1000);
      }
    }

    // Note: currently beaconcha.in expects system CPU seconds to be everything
    this._cpuNodeSystemSecondsTotal = Object.values(cpuTimes).reduce((total, time) => total + time, 0);
    this._cpuNodeUserSecondsTotal = cpuTimes.user;
    this._cpuNodeIdleSecondsTotal = cpuTimes.idle;
  }

  private async collectMemoryData(): Promise<void> {
    const memory = await system.mem();
    this._memoryNodeBytesTotal = memory.total;
    this._memoryNodeBytesFree = memory.free;
    this._memoryNodeBytesCached = memory.cached;
    this._memoryNodeBytesBuffers = memory.buffers;
  }

  private async collectDiskData(): Promise<void> {
    const fileSystems = await system.fsSize();
    // get file system root, on windows this is the name of the hard disk partition
    const rootFs = process.platform === "win32" ? process.cwd().split(path.sep)[0] : "/";
    // only consider root file system, if it does not exist use first entry in the list
    const fileSystem = fileSystems.find((fs) => fs.mount === rootFs) ?? fileSystems[0];
    this._diskNodeBytesTotal = fileSystem.size;
    this._diskNodeBytesFree = fileSystem.available;

    if (this.diskIOMeasurable) {
      const disk = await system.disksIO();
      if (disk != null && disk.rIO !== 0) {
        // Note: rIO and wIO might not be available inside container
        // see https://github.com/sebhildebrandt/systeminformation/issues/777
        this._diskNodeReadsTotal = disk.rIO;
        this._diskNodeWritesTotal = disk.wIO;
      } else {
        this.diskIOMeasurable = false;
      }
    }
  }

  private async collectNetworkData(): Promise<void> {
    // defaults to first external network interface
    const [network] = await system.networkStats();
    // Note: rx_bytes and tx_bytes will be inaccurate if process
    // runs inside container as it only captures local network traffic
    this._networkNodeBytesTotalReceive = network.rx_bytes;
    this._networkNodeBytesTotalTransmit = network.tx_bytes;
  }

  private getNormalizedOsVersion(): MiscOs {
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

  private getSystemBootTime(): number {
    return Math.floor(Date.now() / 1000 - os.uptime());
  }

  get cpuCores(): number {
    return this._cpuCores;
  }

  get cpuThreads(): number {
    return this._cpuThreads;
  }

  get cpuNodeSystemSecondsTotal(): number {
    return this._cpuNodeSystemSecondsTotal;
  }

  get cpuNodeUserSecondsTotal(): number {
    return this._cpuNodeUserSecondsTotal;
  }

  get cpuNodeIOWaitSecondsTotal(): number {
    // Note: not measured by os.cpus()
    return 0;
  }

  get cpuNodeIdleSecondsTotal(): number {
    return this._cpuNodeIdleSecondsTotal;
  }

  get memoryNodeBytesTotal(): number {
    return this._memoryNodeBytesTotal;
  }

  get memoryNodeBytesFree(): number {
    return this._memoryNodeBytesFree;
  }

  get memoryNodeBytesCached(): number {
    return this._memoryNodeBytesCached;
  }

  get memoryNodeBytesBuffers(): number {
    return this._memoryNodeBytesBuffers;
  }

  get diskNodeBytesTotal(): number {
    return this._diskNodeBytesTotal;
  }

  get diskNodeBytesFree(): number {
    return this._diskNodeBytesFree;
  }

  get diskNodeIOSeconds(): number {
    // Note: currently unused by beaconcha.in
    return 0;
  }

  get diskNodeReadsTotal(): number {
    return this._diskNodeReadsTotal;
  }

  get diskNodeWritesTotal(): number {
    return this._diskNodeWritesTotal;
  }

  get networkNodeBytesTotalReceive(): number {
    return this._networkNodeBytesTotalReceive;
  }

  get networkNodeBytesTotalTransmit(): number {
    return this._networkNodeBytesTotalTransmit;
  }

  get miscNodeBootTsSeconds(): number {
    return this._miscNodeBootTsSeconds;
  }

  get miscOs(): MiscOs {
    return this._miscOs;
  }
}

export default new System();
