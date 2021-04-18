import {getHealth} from "./getHealth";
import {getNetworkIdentity} from "./getNetworkIdentity";
import {getPeers} from "./getPeers";
import {getPeer} from "./getPeer";
import {getNodeVersion} from "./getNodeVersion";
import {getSyncingStatus} from "./getSyncingStatus";

export const nodeRoutes = [getHealth, getNetworkIdentity, getPeers, getPeer, getNodeVersion, getSyncingStatus];
