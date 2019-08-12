import net, {Socket} from "net";
import {Method, ProtocolType} from "../../../../src/network/hobbits/constants";
import {serialize} from "@chainsafe/ssz";
import {decodeRequestBody, encodeRequestBody} from "../../../../src/network/hobbits/rpc/codec";
import {assert} from "chai";
import {decodeMessage, encodeMessage, generateRPCHeader} from "../../../../src/network/hobbits/codec";
import {DecodedMessage} from "../../../../src/network/hobbits/types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import BN from "bn.js";

describe("[hobbits] test network transfer", () => {

  let sockets = [];
  let server, client;

  beforeEach(() => {
    client = new net.Socket();
  });

  afterEach(() => {
    client.end();
    server.close();
  });

  /*it.skip('should be able to transfer data', function () {
    function reply(socket){
      sockets.push(socket);
      sockets.forEach(socket => {
        socket.write("Hello, client");
      });
    }

    const serverListener = socket => {
      socket.on('data', data => {
        // console.log('Server Received: ' + data);
      });
      // socket.pipe(socket);
      reply(socket);
    };

    server = net.createServer(socket => serverListener(socket));
    server.listen(1337, '127.0.0.1');

    client.connect(1337, '127.0.0.1', () => {
      // console.log('Connected');
      client.write('Hello, server!');
    });

    let counter = 0;
    client.on('data', data => {
      counter ++;
      // console.log('Client Received: '+ counter + data);
    });

  });*/


  it('should be able to transfer data 2', function () {
    // create encoded message
    const msg = {
      reason: new BN(3)
    };
    const id = 0;
    const method = Method.Goodbye;
    // encode
    const body = serialize(msg, config.types.Goodbye);
    const actualEncoded = encodeRequestBody(config, method, msg);
    let requestHeader = generateRPCHeader(id, method);
    const encodedMessage = encodeMessage(ProtocolType.RPC, requestHeader, actualEncoded);

    const serverListener = socket => {
      socket.on('data', data => {
        // console.log('Server Received: ' + data);
      });
      socket.write(encodedMessage);
    };

    // run the server
    server = net.createServer(socket => serverListener(socket));
    server.listen(1337, '127.0.0.1');

    client.connect(1337, '127.0.0.1', () => {
      // console.log('Connected');
    });

    client.on('data', data => {
      // decode
      const decodedMessage: DecodedMessage = decodeMessage(encodedMessage);
      // console.log(decodedMessage);
      const requestHeader = decodedMessage.requestHeader.rpcHeader;
      const requestBody = decodedMessage.requestBody;
      const decodedBody = decodeRequestBody(config, requestHeader.methodId, requestBody);
      // compare
      assert.deepEqual(decodedBody.toString(), msg.toString());
    });

  });
});