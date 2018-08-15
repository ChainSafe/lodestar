var blakejs = require('blakejs');

var exports = module.exports = {};

exports.blake = (data) => {
    return blakejs.blake2sHex(data);
}
