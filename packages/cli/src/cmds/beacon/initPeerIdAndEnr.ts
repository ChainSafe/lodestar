import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {PeerId} from "@libp2p/interface";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {Multiaddr} from "@multiformats/multiaddr";
import {createPrivateKeyFromPeerId, SignableENR} from "@chainsafe/enr";
import {Logger} from "@lodestar/utils";
import {exportToJSON, readPeerId} from "../../config/index.js";
import {writeFile600Perm} from "../../util/file.js";
import {parseListenArgs} from "../../options/beaconNodeOptions/network.js";
import {BeaconArgs} from "./options.js";

/**
 * Check if multiaddr belongs to the local network interfaces.
 */
export function isLocalMultiAddr(multiaddr: Multiaddr | undefined): boolean {
  if (!multiaddr) return false;

  const protoNames = multiaddr.protoNames();
  if (protoNames.length !== 2 && protoNames[1] !== "udp") {
    throw new Error("Invalid udp multiaddr");
  }

  const interfaces = os.networkInterfaces();
  const tuples = multiaddr.tuples();
  const family = tuples[0][0];
  const isIPv4: boolean = family === 4;
  const ip = tuples[0][1];

  if (!ip) {
    return false;
  }

  const ipStr = isIPv4
    ? Array.from(ip).join(".")
    : Array.from(Uint16Array.from(ip))
        .map((n) => n.toString(16))
        .join(":");

  for (const networkInterfaces of Object.values(interfaces)) {
    for (const networkInterface of networkInterfaces || []) {
      // since node version 18, the netowrkinterface family returns 4 | 6 instead of ipv4 | ipv6,
      // even though the documentation says otherwise.
      // This might be a bug that would be corrected in future version, in the meantime
      // the check using endsWith ensures things work in node version 18 and earlier
      if (String(networkInterface.family).endsWith(String(family)) && networkInterface.address === ipStr) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Only update the enr if the value has changed
 */
function maybeUpdateEnr<T extends "ip" | "tcp" | "udp" | "ip6" | "tcp6" | "udp6">(
  enr: SignableENR,
  key: T,
  value: SignableENR[T] | undefined
): void {
  if (enr[key] !== value) {
    enr[key] = value;
  }
}

export function overwriteEnrWithCliArgs(
  enr: SignableENR,
  args: BeaconArgs,
  logger: Logger,
  opts?: {newEnr?: boolean; bootnode?: boolean}
): void {
  const preSeq = enr.seq;
  const {port, discoveryPort, port6, discoveryPort6} = parseListenArgs(args);
  maybeUpdateEnr(enr, "ip", args["enr.ip"] ?? enr.ip);
  maybeUpdateEnr(enr, "ip6", args["enr.ip6"] ?? enr.ip6);
  maybeUpdateEnr(enr, "udp", args["enr.udp"] ?? discoveryPort ?? enr.udp);
  maybeUpdateEnr(enr, "udp6", args["enr.udp6"] ?? discoveryPort6 ?? enr.udp6);
  if (!opts?.bootnode) {
    maybeUpdateEnr(enr, "tcp", args["enr.tcp"] ?? port ?? enr.tcp);
    maybeUpdateEnr(enr, "tcp6", args["enr.tcp6"] ?? port6 ?? enr.tcp6);
  }

  function testMultiaddrForLocal(mu: Multiaddr, ip4: boolean): void {
    const isLocal = isLocalMultiAddr(mu);
    if (args.nat) {
      if (isLocal) {
        logger.warn("--nat flag is set with no purpose");
      }
    } else {
      if (!isLocal) {
        logger.warn(
          `Configured ENR ${ip4 ? "IPv4" : "IPv6"} address is not local, clearing ENR ${ip4 ? "ip" : "ip6"} and ${
            ip4 ? "udp" : "udp6"
          }. Set the --nat flag to prevent this`
        );
        if (ip4) {
          enr.delete("ip");
          enr.delete("udp");
        } else {
          enr.delete("ip6");
          enr.delete("udp6");
        }
      }
    }
  }
  const udpMultiaddr4 = enr.getLocationMultiaddr("udp4");
  if (udpMultiaddr4) {
    testMultiaddrForLocal(udpMultiaddr4, true);
  }
  const udpMultiaddr6 = enr.getLocationMultiaddr("udp6");
  if (udpMultiaddr6) {
    testMultiaddrForLocal(udpMultiaddr6, false);
  }

  if (enr.seq !== preSeq) {
    // If the enr is newly created, its sequence number can be set to 1
    // It's especially clean for fully configured bootnodes whose enrs never change
    // Otherwise, we can increment the sequence number as little as possible
    if (opts?.newEnr) {
      enr.seq = BigInt(1);
    } else {
      enr.seq = preSeq + BigInt(1);
    }
    // invalidate cached signature
    enr["_signature"] = undefined;
  }
}

/**
 * Create new PeerId and ENR by default, unless persistNetworkIdentity is provided
 */
export async function initPeerIdAndEnr(
  args: BeaconArgs,
  beaconDir: string,
  logger: Logger,
  bootnode?: boolean
): Promise<{peerId: PeerId; enr: SignableENR}> {
  const {persistNetworkIdentity} = args;

  const newPeerIdAndENR = async (): Promise<{peerId: PeerId; enr: SignableENR}> => {
    const peerId = await createSecp256k1PeerId();
    const enr = SignableENR.createV4(createPrivateKeyFromPeerId(peerId).privateKey);
    return {peerId, enr};
  };

  const readPersistedPeerIdAndENR = async (
    peerIdFile: string,
    enrFile: string
  ): Promise<{peerId: PeerId; enr: SignableENR; newEnr: boolean}> => {
    let peerId: PeerId;
    let enr: SignableENR;

    // attempt to read stored peer id
    try {
      peerId = await readPeerId(peerIdFile);
    } catch (_e) {
      logger.warn("Unable to read peerIdFile, creating a new peer id");
      return {...(await newPeerIdAndENR()), newEnr: true};
    }
    // attempt to read stored enr
    try {
      enr = SignableENR.decodeTxt(fs.readFileSync(enrFile, "utf-8"), createPrivateKeyFromPeerId(peerId).privateKey);
    } catch (_e) {
      logger.warn("Unable to decode stored local ENR, creating a new ENR");
      enr = SignableENR.createV4(createPrivateKeyFromPeerId(peerId).privateKey);
      return {peerId, enr, newEnr: true};
    }
    // check stored peer id against stored enr
    if (!peerId.equals(await enr.peerId())) {
      logger.warn("Stored local ENR doesn't match peerIdFile, creating a new ENR");
      enr = SignableENR.createV4(createPrivateKeyFromPeerId(peerId).privateKey);
      return {peerId, enr, newEnr: true};
    }
    return {peerId, enr, newEnr: false};
  };

  if (persistNetworkIdentity) {
    const enrFile = path.join(beaconDir, "enr");
    const peerIdFile = path.join(beaconDir, "peer-id.json");
    const {peerId, enr, newEnr} = await readPersistedPeerIdAndENR(peerIdFile, enrFile);
    overwriteEnrWithCliArgs(enr, args, logger, {newEnr, bootnode});
    // Re-persist peer-id and enr
    writeFile600Perm(peerIdFile, exportToJSON(peerId));
    writeFile600Perm(enrFile, enr.encodeTxt());
    return {peerId, enr};
  } else {
    const {peerId, enr} = await newPeerIdAndENR();
    overwriteEnrWithCliArgs(enr, args, logger, {newEnr: true, bootnode});
    return {peerId, enr};
  }
}
