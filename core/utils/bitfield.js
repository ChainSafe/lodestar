// Takes a bitfield(str) and index(int) and returns a bool
const hasVoted = (bitfield, index) => {
    return Boolean(bitfield[Math.floor(index / 8)] & (128 >> (index % 8)));
}

const setVoted = (bitfield, index) => {
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    const newByteValue = bitfield[byteIndex] | (128 >> bitIndex);
    return bitfield.slice(0,byteIndex) + newByteValue + bitfield.slice(byteIndex + 1);
}

const getBitfieldLength = (bitCount) => {
    return Math.floor((bitCount + 7) / 8);
}


const getEmptyBitfield = (bitCount) => {
	return new Int8Array(Math.ceil(bitCount/8));
}

const getVoteCount = (bitfield) => {
    let votes = 0;
    for(let i=0; i < bitfield.length * 8; i++) {
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
