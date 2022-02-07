/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @module network
 */

import PeerId from "peer-id";
import {Multiaddr} from "multiaddr";
import {networkInterfaces} from "node:os";
import {ENR} from "@chainsafe/discv5";
import MetadataBook from "libp2p/src/peer-store/metadata-book";
import {clientFromAgentVersion, ClientKind} from "./peers/client";

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
  const isIPv4: boolean = tuples[0][0] === 4;
  const family = isIPv4 ? "IPv4" : "IPv6";
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
      if (networkInterface.family === family && networkInterface.address === ipStr) {
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

export function getClientFromPeerStore(peerId: PeerId, metadataBook: MetadataBook): ClientKind {
  const agentVersion = getAgentVersionFromPeerStore(peerId, metadataBook);
  return clientFromAgentVersion(agentVersion);
}

export function getAgentVersionFromPeerStore(peerId: PeerId, metadataBook: MetadataBook): string {
  return new TextDecoder().decode(metadataBook.getValue(peerId, "AgentVersion")) || "N/A";
}
