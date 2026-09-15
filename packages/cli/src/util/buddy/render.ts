import {writeFile600Perm} from "../file.js";
import {SPRITE_HEIGHT} from "./sprites.js";
import {BuddyState} from "./types.js";

const MIN_ROWS = 10;
const FRAME_LINES = SPRITE_HEIGHT + 2;

export function formatHeader(state: BuddyState): string {
  return `[slot ${state.slot} | epoch ${state.epoch} | ${state.fork} | peers ${state.peers} | mood: ${state.mood}]`;
}

export function formatFooter(state: BuddyState): string {
  const sync = state.synced ? "synced [ok]" : `syncing (${state.syncDistance} behind)`;
  return sync;
}

export function formatFrame(state: BuddyState, sprite: string[]): string {
  return [formatHeader(state), ...sprite, formatFooter(state)].join("\n") + "\n";
}

export function writeSidecar(filepath: string, frame: string): void {
  writeFile600Perm(filepath, frame);
}

/**
 * Pins a fixed-height frame to the bottom of the terminal by setting a DECSTBM
 * scroll region for everything above. Concurrent logger writes scroll inside
 * the top region; the pinned frame is redrawn on demand.
 */
export class TtyRenderer {
  private readonly stream: NodeJS.WriteStream;
  private readonly height: number;
  private started = false;
  private lastFrame: string | null = null;
  private resizeListener: (() => void) | null = null;

  constructor(stream: NodeJS.WriteStream = process.stdout, height: number = FRAME_LINES) {
    this.stream = stream;
    this.height = height;
  }

  static isSupported(stream: NodeJS.WriteStream = process.stdout): boolean {
    return Boolean(stream.isTTY) && (stream.rows ?? 0) >= MIN_ROWS;
  }

  private rows(): number {
    return this.stream.rows ?? 24;
  }

  private setScrollRegion(): void {
    const rows = this.rows();
    const top = 1;
    const bottom = Math.max(top, rows - this.height);
    // DECOM off: row addressing stays absolute, not relative to scroll region.
    this.stream.write("\x1b[?6l");
    // DECSTBM: set scroll region [top;bottom]. Logger output stays above.
    this.stream.write(`\x1b[${top};${bottom}r`);
    // Park cursor at bottom of scroll region so subsequent log lines flow there.
    this.stream.write(`\x1b[${bottom};1H`);
  }

  private drawPinned(frame: string): void {
    const rows = this.rows();
    const pinnedTop = Math.max(1, rows - this.height + 1);
    // Save cursor (DECSC), move to pinned area, clear, write, restore (DECRC).
    this.stream.write("\x1b7");
    this.stream.write(`\x1b[${pinnedTop};1H`);
    this.stream.write("\x1b[0J");
    this.stream.write(frame);
    this.stream.write("\x1b8");
  }

  /** Returns true if the terminal is currently too small to host the pinned frame. */
  private tooSmall(): boolean {
    return this.rows() < MIN_ROWS;
  }

  draw(frame: string): void {
    this.lastFrame = frame;
    if (this.tooSmall()) {
      // Terminal shrank below minimum after start: tear down pinned mode so the
      // user gets their full screen back. File mode keeps the buddy alive.
      if (this.started) this.stop();
      return;
    }
    if (!this.started) {
      // Reserve room: scroll up by height so existing content shifts above.
      this.stream.write("\n".repeat(this.height));
      this.setScrollRegion();
      this.resizeListener = () => {
        if (this.tooSmall()) {
          if (this.started) this.stop();
          return;
        }
        this.setScrollRegion();
        if (this.lastFrame) this.drawPinned(this.lastFrame);
      };
      this.stream.on("resize", this.resizeListener);
      this.started = true;
    }
    this.drawPinned(frame);
  }

  stop(): void {
    if (!this.started) return;
    if (this.resizeListener) {
      this.stream.off("resize", this.resizeListener);
      this.resizeListener = null;
    }
    // Reset scroll region to full screen, move cursor to bottom, newline so
    // the shell prompt lands cleanly below any final logs.
    this.stream.write("\x1b[r");
    this.stream.write(`\x1b[${this.rows()};1H\n`);
    this.started = false;
    this.lastFrame = null;
  }
}
