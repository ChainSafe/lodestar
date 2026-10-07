import bindings from "@chainsafe/lodestar-z";
import {createNativeNetwork} from "@chainsafe/lodestar-z/network";

let network;
let active = 0;
// The least a host does: take no work, so the binding only settles results.
const host = {
  capacity: () => ({gossipValidation: "backpressured", incomingRequestSlots: 0}),
  subscribeCapacity: () => () => {},
  validate: async (job) => job.messages.map(() => "ignore"),
  checkDependencies: (checks) => checks.map(() => false),
  serve: (request) => request.cancel(),
  peers: () => {},
  failed: (error) => {
    throw error;
  },
  logs: () => {},
};
process.on("message", async ({id, method, args}) => {
  if (++active > 16) process.exit(2);
  try {
    let value;
    switch (method) {
      case "initialize":
        network = createNativeNetwork({...args[0], beaconConfig: new bindings.BeaconConfig(args[1], args[2]), logLevel: "off"}, host);
        network.stopDelivery();
        value = await network.getIdentity();
        break;
      case "applyIntent":
        value = await network.applyIntent(...args);
        break;
      case "getPeers":
        value = await network.getPeers();
        break;
      case "close":
        value = await network.close();
        break;
      default:
        throw new Error("Unknown native binding peer command");
    }
    process.send({id, value});
  } catch (error) {
    process.send({id, error});
  } finally {
    active--;
  }
});
process.on("disconnect", async () => {
  await network?.close();
  process.exit(0);
});
