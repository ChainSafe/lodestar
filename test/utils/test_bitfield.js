const bitfield = require('../../lodestar_chain/utils/bitfield');
const assert = require('assert');

const attestBitfield = [
	[0, 0],
	[1, 1],
	[8, 1],
	[9, 2],
	[16, 2],
	[17, 3],
];

describe('Bitfield', () => {

	it('getBitfieldLength() should return the correct length', () => {
		for(let i=0; i < attestBitfield.length; i++) {
			const cur = attestBitfield[i];
			const length = bitfield.getBitfieldLength(cur[0]);
			assert.equal(length, cur[1]);
		}
	});

	it('getEmptyBitfieldLength should ', () => {
		const attesters =
	});
});
