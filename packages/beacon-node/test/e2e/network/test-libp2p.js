import {tcp} from "@libp2p/tcp";
import {multiaddr} from "@multiformats/multiaddr";

const transport = tcp({})();
const listener = transport.createListener({
  handler: (connection) => {
    console.info(connection);
  },
});
await listener.listen(multiaddr("/ip4/127.0.0.1/tcp/9999"));
await listener.close();
