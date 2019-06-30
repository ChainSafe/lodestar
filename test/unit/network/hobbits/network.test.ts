import PeerInfo from "peer-info";
import waterfall from "async/waterfall";
import promisify from "es6-promisify";

describe("[hobbits] network", () => {
  it('should get port and url from PeerInfo - callback', function () {
    let addr;
    waterfall([
      (cb) => PeerInfo.create(cb),
      (peerInfo, cb) => {
        peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/0');
        addr = peerInfo.multiaddrs.toArray()[0];
        console.log(addr.nodeAddress());

      }
    ], (err) => {
      if (err) { throw err; }
    });

  });

  it('should get port and url from PeerInfo - promisify', async function () {
    this.timeout(5000);
    let peerInfo = await promisify(PeerInfo.create.bind(this))();
    peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/0');
    let addr = peerInfo.multiaddrs.toArray()[0];
    console.log(addr.nodeAddress());
  });
});