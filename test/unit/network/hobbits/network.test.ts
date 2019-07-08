import PeerInfo from "peer-info";
import waterfall from "async/waterfall";
import promisify from "es6-promisify";
import net, {Socket} from "net";
import {Method} from "../../../../src/network/hobbits/constants";
import {deserialize, serialize} from "@chainsafe/ssz";
import {Goodbye, WireRequest} from "../../../../src/network/hobbits/rpc/messages";
import {decodeRequestBody, encodeRequest} from "../../../../src/network/hobbits/rpc/codec";
import {assert} from "chai";
import {decodeMessage, encodeMessage, protocolType} from "../../../../src/network/hobbits/codec";
import {DecodedMessage} from "../../../../src/network/hobbits/types";

describe("[hobbits] network", () => {

  it('should be able to transfer data', function () {
    function reply(socket){
      sockets.push(socket);
      sockets.forEach(socket => {
        socket.write("Hello, client");
      });
    }
    let sockets = [];
    let server = net.createServer(socket => {
      socket.on('data', data => {
        console.log('Server Received: ' + data);
      });
      // socket.pipe(socket);
      reply(socket);
    });

    server.listen(1337, '127.0.0.1');

    let client = new net.Socket();
    client.connect(1337, '127.0.0.1', () => {
      console.log('Connected');
      client.write('Hello, server! Love, Client.');
    });

    let counter = 0;
    client.on('data', data => {
      counter ++;
      console.log('Client Received: '+ counter + data);
    });

    client.on('close', () => {
      console.log('Connection closed');
    });

  });
  it('should be able to transfer data 2', function () {

    let msg = {
      reason: 3
    };
    const id = 0;
    let method = Method.Goodbye;
    const actualEncoded = encodeRequest(id, method, msg);
    const encodedMessage = encodeMessage(protocolType.RPC, actualEncoded);

    let server = net.createServer(socket => {
      socket.on('data', data => {
        console.log('Server Received: ' + data);
      });
      socket.write(encodedMessage);
      server.close();
    });

    server.listen(1337, '127.0.0.1');

    let client = new net.Socket();
    client.connect(1337, '127.0.0.1', () => {
      console.log('Connected');
      // client.write('Hello, server! Love, Client.');
    });

    client.on('data', data => {
      const decodedMessage: DecodedMessage = decodeMessage(encodedMessage);
      const decodedWireRequest: WireRequest = deserialize(decodedMessage.payload, WireRequest);
      // console.log(decodedWireRequest);

      const decodedRequestBody = decodeRequestBody(decodedWireRequest.methodId, decodedWireRequest.body);
      console.log(decodedRequestBody);

      assert.equal(decodedMessage.command, "RPC");
      assert.deepEqual(msg, decodedRequestBody);
      client.end();
    });

    client.on('close', () => {
      console.log('Connection closed');
    });

  });
});