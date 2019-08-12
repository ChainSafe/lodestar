// Adapted from https://github.com/prysmaticlabs/prysm/blob/master/shared/ssz/encode_test.go#L296


export const SimpleObject = {
  fields: [
    ['b', 'uint16'],
    ['a', 'uint8'],
  ],
};

export const InnerObject = {
  fields: [
    ['v', 'uint16'],
  ],
};

export const OuterObject = {
  fields: [
    ['v', 'uint8'],
    ['subV', InnerObject],
  ],
};

export const ArrayObject = {
  fields: [
    ['v', {
      elementType: SimpleObject,
      maxLength: 100,
    }],
  ],
};
