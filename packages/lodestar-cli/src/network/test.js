const {FileENR} = require('./lib/cmds/beacon/fileEnr.js');
const {readPeerId} = require('./lib/network/peerId.js');

const enrFile = '.medalla/enr.json';
const peerIdFile = '.medalla/peer-id.json'
const peerId = await readPeerId(peerIdFile);

const enr = FileENR.initFromFile(enrFile, peerId);
enr.delete('port', 55);
enr.delete('por');
