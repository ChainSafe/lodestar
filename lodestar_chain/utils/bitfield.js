var exports = module.exports = {};

// Takes a bitfield(str) and index(int) and returns a bool
const hasVoted(bitfield, index) => {
    return bitfield[Math.floor(index / 8)] & (128 >> (index % 8));
}

exports.hasVoted = hasVoted;

const setVoted(bitfield, index) => {
    var byteIndex = Math.floor(index / 8);
    var bitIndex = index % 8;
    var newByteValue = bitfield[byteIndex] | (128 >> bitIndex);
    return bitfield[:byteIndex] + newByteValue + bitfield[byteIndex + 1:];
}

exports.setVoted = setVoted;

const getBitfieldLength(bitCount) => {
    return Math.floor((bitCount + 7) / 8);
}

exports.getBitfieldLength = getBitfieldLength;

const getEmptyBitfield(bitCount) => {
    return 'x00'.repeat(getBitfieldLength(bitCount));
}

exports.getEmptyBitfield = getEmptyBitfield;

const getVoteCount(bitfield) => {
    var votes = 0;
    for(var i=0; i < bitfield.length * 8; i++) {
      if(hasVoted(bitfield, i)) {
        votes += 1;
      }
    }
    return votes
}

exports.getVoteCount = getVoteCount;
