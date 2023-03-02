import os from "node:os";
import path from "node:path";
import system from "systeminformation";
import {Logger} from "@lodestar/utils";

type MiscOs = "lin" | "win" | "mac" | "unk";

/**
 * Singleton class to collect and provide system information
 */
class System {
  // static data only needs to be collected once
  private staticDataCollected = false;
  // disk I/O is not measurable in some environments
  private diskIOMeasurable = true;

  cpuCores = 0;
  cpuThreads = 0;
  cpuNodeSystemSecondsTotal = 0;
  cpuNodeUserSecondsTotal = 0;
  // Note: CPU I/O wait is not measured by os.cpus()
  cpuNodeIOWaitSecondsTotal = 0;
  cpuNodeIdleSecondsTotal = 0;
  memoryNodeBytesTotal = 0;
  memoryNodeBytesFree = 0;
  memoryNodeBytesCached = 0;
  memoryNodeBytesBuffers = 0;
  diskNodeBytesTotal = 0;
  diskNodeBytesFree = 0;
  // Note: disk I/O seconds is currently unused by beaconcha.in
  diskNodeIOSeconds = 0;
  diskNodeReadsTotal = 0;
  diskNodeWritesTotal = 0;
  networkNodeBytesTotalReceive = 0;
  networkNodeBytesTotalTransmit = 0;
  miscNodeBootTsSeconds = 0;
  miscOs: MiscOs = "unk";

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

    this.miscNodeBootTsSeconds = this.getSystemBootTime();
  }

  private async collectStaticData(): Promise<void> {
    if (this.staticDataCollected) return;

    const cpu = await system.cpu();
    // Note: inside container this might be inaccurate as
    // physicalCores in some cases is the count of logical CPU cores
    this.cpuCores = cpu.physicalCores;
    this.cpuThreads = cpu.cores;

    this.miscOs = this.getNormalizedOsVersion();

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
    this.cpuNodeSystemSecondsTotal = Object.values(cpuTimes).reduce((total, time) => total + time, 0);
    this.cpuNodeUserSecondsTotal = cpuTimes.user;
    this.cpuNodeIdleSecondsTotal = cpuTimes.idle;
  }

  private async collectMemoryData(): Promise<void> {
    const memory = await system.mem();
    this.memoryNodeBytesTotal = memory.total;
    this.memoryNodeBytesFree = memory.free;
    this.memoryNodeBytesCached = memory.cached;
    this.memoryNodeBytesBuffers = memory.buffers;
  }

  private async collectDiskData(): Promise<void> {
    const fileSystems = await system.fsSize();
    // get file system root, on windows this is the name of the hard disk partition
    const rootFs = process.platform === "win32" ? process.cwd().split(path.sep)[0] : "/";
    // only consider root file system, if it does not exist use first entry in the list
    const fileSystem = fileSystems.find((fs) => fs.mount === rootFs) ?? fileSystems[0];
    this.diskNodeBytesTotal = fileSystem.size;
    this.diskNodeBytesFree = fileSystem.available;

    if (this.diskIOMeasurable) {
      const disk = await system.disksIO();
      if (disk != null && disk.rIO !== 0) {
        // Note: rIO and wIO might not be available inside container
        // see https://github.com/sebhildebrandt/systeminformation/issues/777
        this.diskNodeReadsTotal = disk.rIO;
        this.diskNodeWritesTotal = disk.wIO;
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
    this.networkNodeBytesTotalReceive = network.rx_bytes;
    this.networkNodeBytesTotalTransmit = network.tx_bytes;
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
}

export default new System();
