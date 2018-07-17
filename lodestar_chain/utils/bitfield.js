// Takes a bitfield(str) and index(int) and returns a bool
const hasVoted = (bitfield, index) => {
    return bitfield[Math.floor(index / 8)] & (128 >> (index % 8));
}

const setVoted = (bitfield, index) => {
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    const newByteValue = bitfield[byteIndex] | (128 >> bitIndex);
    return bitfield[:byteIndex] + newByteValue + bitfield[byteIndex + 1:];
}

const getBitfieldLength = (bitCount) => {
    return Math.floor((bitCount + 7) / 8);
}


const getEmptyBitfield = (bitCount) => {
    return 'x00'.repeat(getBitfieldLength(bitCount));
}

const getVoteCount = (bitfield) => {
    let votes = 0;
    for(const i=0; i < bitfield.length * 8; i++) {
      if(hasVoted(bitfield, i)) {
        votes += 1;
      }
    }
    return votes
}

module.exports = {
  hasVoted,
  setVoted,
  getBitfieldLength,
  getEmptyBitfield,
  getVoteCount
};