// import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
// import EventSource from "eventsource";
// import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils";
// import {IBeaconConfig} from "@chainsafe/lodestar-config";
// import {Slot, SignedBeaconBlock} from "@chainsafe/lodestar-types";
// import {sleep} from "@chainsafe/lodestar/src/util/sleep";
// import rimraf from "rimraf";
//
// describe("sync 2 dev nodes", function() {
//   this.timeout(100000);
//   const logger: ILogger = new WinstonLogger();
//   logger.silent = true;
//   const tmpDir = ".tmp";
//
//   after(() => {
//     rimraf.sync(tmpDir);
//   });
//
//   it("should connect 2 dev nodes until blocks found thru init & regular sync", async () => {
//     const genesisState = ".tmp/state.ssz";
//     const devCmdOptions = {
//       genesisTime: Math.floor(Date.now()/1000).toString(),
//       genesisState,
//       validators: "8",
//       preset: "minimal",
//       autoDial: "false",
//       validatorCount: "8",
//       rest: "true",
//       restPort: "9596"
//     };
//     const devCmd = new DevCommand();
//     await devCmd.action(devCmdOptions, logger);
//     logger.verbose("Started dev node with 8 validators");
//     const devUrl = `http://127.0.0.1:${devCmdOptions.restPort}`;
//     await waitForBlock(config, devUrl, 3, logger);
//     // share same genesis state, wait for block 1 on beacon node to make sure it's synced
//     const dev2CmdOptions = {
//       preset: "minimal",
//       genesisState,
//       minPeers: "1",
//       autoDial: "false",
//       multiaddrs: "/ip4/127.0.0.1/tcp/30607",
//       bindAddr: "/ip4/0.0.0.0/udp/5502",
//       rest: "true",
//       restPort: "9597"
//     };
//     const dev2Cmd = new DevCommand();
//     await dev2Cmd.action(dev2CmdOptions, logger);
//     // autoDial=false so we have to dial manually
//     // if autoDial=true connection direction is always "inbound" hence no handshake => no sync
//     await dev2Cmd.node.network.connect(devCmd.node.network.peerInfo);
//     // make sure initial sync work
//     const dev2Url = `http://127.0.0.1:${dev2CmdOptions.restPort}`;
//     await waitForBlock(config, dev2Url, 3, logger);
//     logger.verbose("Found block 3 on beacon node thru init sync");
//     await waitForBlock(config, dev2Url, 6, logger);
//     logger.verbose("Found block 6 on beacon node thru regular sync");
//     await Promise.all(devCmd.validators.map(validator => validator.stop()));
//     logger.verbose("Stopped all validators on dev node 1");
//     await new Promise(resolve => setTimeout(resolve, config.params.SECONDS_PER_SLOT * 1000));
//     await devCmd.node.stop();
//     // wait for dev2 to disconnect
//     await sleep(1000);
//     await dev2Cmd.node.stop();
//     logger.verbose("Stopped beacon nodes");
//   });
// });
//
// async function waitForBlock(config: IBeaconConfig, url: string, slot: Slot, logger: ILogger): Promise<void> {
//   logger.info(`Waiting for block ${slot} at EventSource url ${url}`);
//   const eventSource = new EventSource(`${url}/node/blocks/stream`,  {https: {rejectUnauthorized: false}});
//   await new Promise((resolve) => {
//     eventSource.onmessage = (evt: MessageEvent) => {
//       try {
//         const signedBlock: SignedBeaconBlock = config.types.SignedBeaconBlock.fromJson(JSON.parse(evt.data));
//         if(signedBlock.message.slot === slot) {
//           logger.info(`Found expected block ${signedBlock.message.slot} at EventSource url ${url}`);
//           resolve();
//         } else {
//           logger.info(`Received block ${signedBlock.message.slot} at EventSource url ${url}`);
//         }
//       } catch (err) {
//         logger.error(`Failed to parse block from SSE. Error: ${err.message}`);
//       }
//     };
//   });
//   eventSource.close();
// }
