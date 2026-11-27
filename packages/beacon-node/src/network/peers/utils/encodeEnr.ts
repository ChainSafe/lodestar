import {ENR} from "@chainsafe/enr";
import {LoggerNode} from "@lodestar/logger/node";
import {PeerEnr} from "../peersData.js";

export function encodeEnr(enr: ENR, logger: LoggerNode): PeerEnr | null {
  try {
    return {txt: enr.encodeTxt(), seq: enr.seq};
  } catch (e) {
    logger.debug("Could not encode peer ENR", {}, e as Error);
    return null;
  }
}
