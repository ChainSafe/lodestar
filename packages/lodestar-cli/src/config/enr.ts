import {ENR} from "@chainsafe/discv5";
import Multiaddr from "multiaddr";
import {IBeaconNodeOptions} from "../options";
import {IENRJson} from "../options/enrOptions";

export function overwriteEnrWithCliArgs(enr: ENR, enrArgs: IENRJson, beaconArgs: IBeaconNodeOptions): void {
  if (beaconArgs.network.localMultiaddrs.length) {
    try {
      const tcpOpts = Multiaddr(beaconArgs.network.localMultiaddrs[0]).toOptions();
      if (tcpOpts.transport === "tcp") {
        enr.tcp = tcpOpts.port;
      }
    } catch (e) {
      throw new Error(`Invalid tcp multiaddr: ${e.message}`);
    }
  }

  if (beaconArgs.network.discv5?.bindAddr) {
    try {
      const udpOpts = Multiaddr(beaconArgs.network.localMultiaddrs[0]).toOptions();
      if (udpOpts.transport === "udp") {
        enr.udp = udpOpts.port;
      }
    } catch (e) {
      throw new Error(`Invalid udp multiaddr: ${e.message}`);
    }
  }

  if (enrArgs.ip != null) enr.ip = enrArgs.ip;
  if (enrArgs.tcp != null) enr.tcp = enrArgs.tcp;
  if (enrArgs.udp != null) enr.udp = enrArgs.udp;
  if (enrArgs.ip6 != null) enr.ip6 = enrArgs.ip6;
  if (enrArgs.tcp6 != null) enr.tcp6 = enrArgs.tcp6;
  if (enrArgs.udp6 != null) enr.udp6 = enrArgs.udp6;
}
