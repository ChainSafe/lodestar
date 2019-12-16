// Adapted from https://github.com/prysmaticlabs/prysm/blob/master/shared/ssz/encode_test.go#L296


export const SimpleObject = {
  fields: [
    ["b", "number16"],
    ["a", "number8"],
  ],
};

export const InnerObject = {
  fields: [
    ["v", "number16"],
  ],
};

export const OuterObject = {
  fields: [
    ["v", "number8"],
    ["subV", InnerObject],
  ],
};

export const ArrayObject = {
  fields: [
    ["v", {
      elementType: SimpleObject,
      maxLength: 100,
    }],
  ],
};
