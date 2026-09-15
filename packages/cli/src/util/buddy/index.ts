import path from "node:path";
import {routes} from "@lodestar/api";
import type {BeaconNode} from "@lodestar/beacon-node";
import {ClockEvent} from "@lodestar/beacon-node/util";
import type {Logger} from "@lodestar/logger";
import {Telemetry, buildState, spriteKindFor} from "./buddy.js";
import {TtyRenderer, formatFrame, writeSidecar} from "./render.js";
import {renderSprite} from "./sprites.js";
import {BuddyMode} from "./types.js";

export type StartBuddyOpts = {
  node: BeaconNode;
  dataDir: string;
  mode: BuddyMode;
  logger: Logger;
};

export type BuddyHandle = {
  stop(): void;
};

export function startBeaconBuddy({node, dataDir, mode, logger}: StartBuddyOpts): BuddyHandle {
  if (mode === "off") return {stop: () => {}};

  // sidecar is rewritten every slot; `watch -n1 cat <dataDir>/buddy.txt` to follow
  const sidecarPath = path.join(dataDir, "buddy.txt");
  let lastReorgSlot: number | null = null;
  let prevFork = "";

  const ttyWanted = mode === "tty" || mode === "both";
  let fileWanted = mode === "file" || mode === "both";
  let renderer: TtyRenderer | null = null;
  if (ttyWanted) {
    if (TtyRenderer.isSupported()) {
      renderer = new TtyRenderer();
    } else {
      // No TTY available: fall back to sidecar file so the buddy still works.
      fileWanted = true;
      logger.warn("beacon buddy: stdout is not a TTY (or too small); falling back to sidecar file only");
    }
  }

  // Easter-egg listeners must never escape an error into the beacon node's
  // event emitters: wrap every body so the consensus path is unaffected.
  const onReorg = (data: routes.events.EventData[routes.events.EventType.chainReorg]): void => {
    try {
      lastReorgSlot = data.slot;
    } catch (e) {
      logger.debug("beacon buddy: onReorg failed", {}, e as Error);
    }
  };

  const onSlot = (slot: number): void => {
    try {
      const peers = safeCall(() => node.network.getConnectedPeerCount(), 0);
      const sync = safeCall(() => node.sync.getSyncStatus(), null);
      const fork = safeCall<string>(() => node.chain.config.getForkName(slot), "unknown");
      if (prevFork === "") prevFork = fork;

      const telemetry: Telemetry = {
        slot,
        peers,
        isSyncing: sync ? sync.isSyncing : false,
        syncDistance: sync ? Number(sync.syncDistance) : 0,
        fork,
        prevFork,
        lastReorgSlot,
      };

      const state = buildState(telemetry);
      const sprite = renderSprite(spriteKindFor(state));
      const frame = formatFrame(state, sprite);

      if (fileWanted) {
        try {
          writeSidecar(sidecarPath, frame);
        } catch (e) {
          logger.debug("beacon buddy: sidecar write failed", {}, e as Error);
        }
      }
      try {
        renderer?.draw(frame);
      } catch (e) {
        logger.debug("beacon buddy: tty draw failed", {}, e as Error);
      }

      prevFork = fork;
    } catch (e) {
      logger.debug("beacon buddy: onSlot failed", {}, e as Error);
    }
  };

  node.chain.clock.on(ClockEvent.slot, onSlot);
  node.chain.emitter.on(routes.events.EventType.chainReorg, onReorg);

  return {
    stop: () => {
      try {
        node.chain.clock.off(ClockEvent.slot, onSlot);
        node.chain.emitter.off(routes.events.EventType.chainReorg, onReorg);
      } catch {
        // ignore
      }
      renderer?.stop();
    },
  };
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
