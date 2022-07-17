import {networkInterfaces} from "node:os";
import PeerId from "peer-id";
import {Multiaddr} from "multiaddr";
import {ENR} from "@chainsafe/discv5";

/* eslint-disable @typescript-eslint/no-explicit-any */

// peers

/**
 * Return a fresh PeerId instance
 */
export async function createPeerId(): Promise<PeerId> {
  return await PeerId.create({bits: 256, keyType: "secp256k1"});
}

/**
 * Check if multiaddr belongs to the local network interfaces.
 */
export function isLocalMultiAddr(multiaddr: Multiaddr | undefined): boolean {
  if (!multiaddr) return false;

  const protoNames = multiaddr.protoNames();
  if (protoNames.length !== 2 && protoNames[1] !== "udp") {
    throw new Error("Invalid udp multiaddr");
  }

  const interfaces = networkInterfaces();
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

export function clearMultiaddrUDP(enr: ENR): void {
  // enr.multiaddrUDP = undefined in new version
  enr.delete("ip");
  enr.delete("udp");
  enr.delete("ip6");
  enr.delete("udp6");
}

export function prettyPrintPeerId(peerId: PeerId): string {
  const id = peerId.toB58String();
  return `${id.substr(0, 2)}...${id.substr(id.length - 6, id.length)}`;
}
