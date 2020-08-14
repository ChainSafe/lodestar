import {ENR} from "@chainsafe/discv5";
import Multiaddr from "multiaddr";

import {IBeaconNodeOptions} from "../options";
import {IENRArgs} from "../cmds/beacon/enrOptions";

export function updateENR(enr: ENR, args: IENRArgs & IBeaconNodeOptions): void {
  if (args.network.multiaddrs.length) {
    try {
      const tcpOpts = Multiaddr(args.network.multiaddrs[0]).toOptions();
      if (tcpOpts.transport === "tcp") {
        enr.tcp = tcpOpts.port;
      }
    } catch (e) {
      throw new Error(`Invalid tcp multiaddr: ${e.message}`);
    }
  }
  if (args.network.discv5?.bindAddr) {
    try {
      const udpOpts = Multiaddr(args.network.multiaddrs[0]).toOptions();
      if (udpOpts.transport === "udp") {
        enr.udp = udpOpts.port;
      }
    } catch (e) {
      throw new Error(`Invalid udp multiaddr: ${e.message}`);
    }
  }
  if (args.enr?.ip) {
    enr.ip = args.enr.ip;
  }
  if (typeof args.enr?.tcp === "number") {
    enr.tcp = args.enr.tcp;
  }
  if (typeof args.enr?.udp === "number") {
    enr.udp = args.enr.udp;
  }
  if (args.enr?.ip6) {
    enr.ip6 = args.enr.ip6;
  }
  if (typeof args.enr?.tcp6 === "number") {
    enr.tcp6 = args.enr.tcp6;
  }
  if (typeof args.enr?.udp6 === "number") {
    enr.udp6 = args.enr.udp6;
  }
}
