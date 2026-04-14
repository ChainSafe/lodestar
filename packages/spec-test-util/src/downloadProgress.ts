import readline from "node:readline";

const TTY_RENDER_INTERVAL_MS = 100;
const NON_TTY_PROGRESS_MILESTONES = [10, 25, 50, 75, 100];

type ProgressEntry = {
  transferredBytes: number;
  totalBytes: number | null;
};

export type DownloadProgressReporterOptions = {
  log: (msg: string) => void;
  enabled: boolean;
};

type DownloadProgressReporter = {
  start(label: string, totalBytes: number | null): void;
  update(label: string, transferredBytes: number): void;
  retry(label: string, attempt: number, message: string): void;
  downloaded(label: string, transferredBytes: number): void;
  extracted(label: string, outputDir: string): void;
  close(): void;
};

export function createDownloadProgressReporter({
  log,
  enabled,
}: DownloadProgressReporterOptions): DownloadProgressReporter {
  if (enabled && process.stdout.isTTY) {
    return new TtyDownloadProgressReporter(log);
  }

  return new LogDownloadProgressReporter(log);
}

class TtyDownloadProgressReporter implements DownloadProgressReporter {
  private readonly progressByLabel = new Map<string, ProgressEntry>();
  private readonly orderedLabels: string[] = [];
  private renderTimer: NodeJS.Timeout | null = null;
  private renderedLines = 0;

  constructor(private readonly log: (msg: string) => void) {}

  start(label: string, totalBytes: number | null): void {
    if (!this.progressByLabel.has(label)) {
      this.orderedLabels.push(label);
    }

    this.progressByLabel.set(label, {transferredBytes: 0, totalBytes});
    this.scheduleRender();
  }

  update(label: string, transferredBytes: number): void {
    const progress = this.progressByLabel.get(label);
    if (!progress) {
      return;
    }

    progress.transferredBytes = transferredBytes;
    this.scheduleRender();
  }

  retry(label: string, attempt: number, message: string): void {
    this.logMessage(`Download attempt ${attempt} for ${label} failed: ${message}`);
  }

  downloaded(label: string, transferredBytes: number): void {
    this.progressByLabel.delete(label);
    this.removeLabel(label);
    this.logMessage(`Downloaded ${label} - ${transferredBytes} bytes`);
  }

  extracted(label: string, outputDir: string): void {
    this.logMessage(`Extracted ${label} to ${outputDir}`);
  }

  close(): void {
    if (this.renderTimer !== null) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }

    this.clearRenderedBlock();
  }

  private scheduleRender(): void {
    if (this.renderTimer !== null) {
      return;
    }

    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, TTY_RENDER_INTERVAL_MS);
  }

  private render(): void {
    this.clearRenderedBlock();

    if (this.orderedLabels.length === 0) {
      return;
    }

    const lines = this.orderedLabels.map((label) => formatProgressLine(label, this.progressByLabel.get(label)));
    process.stdout.write(`${lines.join("\n")}\n`);
    this.renderedLines = lines.length;
  }

  private clearRenderedBlock(): void {
    if (this.renderedLines === 0) {
      return;
    }

    readline.moveCursor(process.stdout, 0, -this.renderedLines);
    readline.cursorTo(process.stdout, 0);
    readline.clearScreenDown(process.stdout);
    this.renderedLines = 0;
  }

  private logMessage(message: string): void {
    this.clearRenderedBlock();
    this.log(message);
    this.render();
  }

  private removeLabel(label: string): void {
    const index = this.orderedLabels.indexOf(label);
    if (index >= 0) {
      this.orderedLabels.splice(index, 1);
    }
  }
}

class LogDownloadProgressReporter implements DownloadProgressReporter {
  private readonly progressByLabel = new Map<string, ProgressEntry>();
  private readonly loggedMilestonesByLabel = new Map<string, Set<number>>();

  constructor(private readonly log: (msg: string) => void) {}

  start(label: string, totalBytes: number | null): void {
    this.progressByLabel.set(label, {transferredBytes: 0, totalBytes});
    this.loggedMilestonesByLabel.set(label, new Set());
    this.log(`Downloading ${label} - ${totalBytes ?? "unknown"} bytes`);
  }

  update(label: string, transferredBytes: number): void {
    const progress = this.progressByLabel.get(label);
    if (!progress || progress.totalBytes === null) {
      return;
    }

    progress.transferredBytes = transferredBytes;
    const percentage = Math.floor((progress.transferredBytes / progress.totalBytes) * 100);
    const loggedMilestones = this.loggedMilestonesByLabel.get(label);
    if (!loggedMilestones) {
      return;
    }

    for (const milestone of NON_TTY_PROGRESS_MILESTONES) {
      if (percentage >= milestone && !loggedMilestones.has(milestone)) {
        loggedMilestones.add(milestone);
        this.log(`${label} ${milestone}% (${progress.transferredBytes}/${progress.totalBytes} bytes)`);
      }
    }
  }

  retry(label: string, attempt: number, message: string): void {
    this.log(`Download attempt ${attempt} for ${label} failed: ${message}`);
  }

  downloaded(label: string, transferredBytes: number): void {
    this.progressByLabel.delete(label);
    this.loggedMilestonesByLabel.delete(label);
    this.log(`Downloaded ${label} - ${transferredBytes} bytes`);
  }

  extracted(label: string, outputDir: string): void {
    this.log(`Extracted ${label} to ${outputDir}`);
  }

  close(): void {}
}

function formatProgressLine(label: string, progress: ProgressEntry | undefined): string {
  if (!progress) {
    return label;
  }

  const totalBytes = progress.totalBytes;
  const transferred = formatBytes(progress.transferredBytes);

  if (totalBytes === null || totalBytes <= 0) {
    return `${label} ${transferred}`;
  }

  const percentage = Math.floor((progress.transferredBytes / totalBytes) * 100);
  const progressBarWidth = 24;
  const completedWidth = Math.round((Math.min(percentage, 100) / 100) * progressBarWidth);
  const progressBar = `${"#".repeat(completedWidth)}${"-".repeat(progressBarWidth - completedWidth)}`;

  return `${label} [${progressBar}] ${percentage.toString().padStart(3)}% ${transferred}/${formatBytes(totalBytes)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
