import fs from "node:fs";
import path from "node:path";
import {PeerId} from "@libp2p/interface-peer-id";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {createKeypairFromPeerId, SignableENR} from "@chainsafe/discv5";
import {Logger} from "@lodestar/utils";
import {exportToJSON, readPeerId} from "../../config/index.js";
import {writeFile600Perm} from "../../util/file.js";
import {defaultP2pPort} from "../../options/beaconNodeOptions/network.js";
import {BeaconArgs} from "./options.js";

export function overwriteEnrWithCliArgs(enr: SignableENR, args: BeaconArgs): void {
  // TODO: Not sure if we should propagate port/defaultP2pPort options to the ENR
  enr.tcp = args["enr.tcp"] ?? args.port ?? defaultP2pPort;
  const udpPort = args["enr.udp"] ?? args.discoveryPort ?? args.port ?? defaultP2pPort;
  if (udpPort != null) enr.udp = udpPort;
  if (args["enr.ip"] != null) enr.ip = args["enr.ip"];
  if (args["enr.ip6"] != null) enr.ip6 = args["enr.ip6"];
  if (args["enr.tcp6"] != null) enr.tcp6 = args["enr.tcp6"];
  if (args["enr.udp6"] != null) enr.udp6 = args["enr.udp6"];
}

/**
 * Create new PeerId and ENR by default, unless persistNetworkIdentity is provided
 */
export async function initPeerIdAndEnr(
  args: BeaconArgs,
  beaconDir: string,
  logger: Logger
): Promise<{peerId: PeerId; enr: SignableENR}> {
  const {persistNetworkIdentity} = args;

  const newPeerIdAndENR = async (): Promise<{peerId: PeerId; enr: SignableENR}> => {
    const peerId = await createSecp256k1PeerId();
    const enr = SignableENR.createV4(createKeypairFromPeerId(peerId));
    return {peerId, enr};
  };

  const readPersistedPeerIdAndENR = async (
    peerIdFile: string,
    enrFile: string
  ): Promise<{peerId: PeerId; enr: SignableENR}> => {
    let peerId: PeerId;
    let enr: SignableENR;

    // attempt to read stored peer id
    try {
      peerId = await readPeerId(peerIdFile);
    } catch (e) {
      logger.warn("Unable to read peerIdFile, creating a new peer id");
      return newPeerIdAndENR();
    }
    // attempt to read stored enr
    try {
      enr = SignableENR.decodeTxt(fs.readFileSync(enrFile, "utf-8"), createKeypairFromPeerId(peerId));
    } catch (e) {
      logger.warn("Unable to decode stored local ENR, creating a new ENR");
      enr = SignableENR.createV4(createKeypairFromPeerId(peerId));
      return {peerId, enr};
    }
    // check stored peer id against stored enr
    if (!peerId.equals(await enr.peerId())) {
      logger.warn("Stored local ENR doesn't match peerIdFile, creating a new ENR");
      enr = SignableENR.createV4(createKeypairFromPeerId(peerId));
      return {peerId, enr};
    }
    return {peerId, enr};
  };

  if (persistNetworkIdentity) {
    const enrFile = path.join(beaconDir, "enr");
    const peerIdFile = path.join(beaconDir, "peer-id.json");
    const {peerId, enr} = await readPersistedPeerIdAndENR(peerIdFile, enrFile);
    overwriteEnrWithCliArgs(enr, args);
    // Re-persist peer-id and enr
    writeFile600Perm(peerIdFile, exportToJSON(peerId));
    writeFile600Perm(enrFile, enr.encodeTxt());
    return {peerId, enr};
  } else {
    const {peerId, enr} = await newPeerIdAndENR();
    overwriteEnrWithCliArgs(enr, args);
    return {peerId, enr};
  }
}
