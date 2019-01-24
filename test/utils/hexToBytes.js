/**
 * Convert a hex string to a byte array
 *
 * @method hexToBytes
 * @param {string} hex
 * @return {Buffer} the byte buffer
 */
function hexToBytes(hex) {
    hex = hex.toString(16);

    hex = hex.replace(/^0x/i,'');

    let bytes = new Uint8Array(hex.length/2);
    for (let i = 0, c = 0; c < hex.length; c += 2, i += 1){
        bytes[i] = parseInt(hex.substr(c, 2), 16);
    }
    return Buffer.from(bytes.buffer);
};

exports.hexToBytes = hexToBytes;
