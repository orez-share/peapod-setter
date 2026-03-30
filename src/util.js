import { cellFillLen } from "./constants";

export const chunkedGen = (word, chunkLen) => {
  let chunks = [];
  for (let idx = 0; idx < word.length; idx += chunkLen) {
    const chunk = word.substring(idx, idx + chunkLen);
    chunks.push(chunk);
  }
  return chunks;
}

export const chunked = word => chunkedGen(word, cellFillLen);

export const filterMap = (arr, fn) => {
  return arr.reduce((acc, item, idx) => {
    let mapped = fn(item, idx);
    if (mapped != null) acc.push(mapped);
    return acc;
  }, []);
}

// makes a LOT of assumptions.
// JS is not a serious language.
export const keyToCmp = fn => (a, b) => {
  const left = fn(a);
  const right = fn(b);
  for (let idx = 0; idx < left.length; idx++) {
    if (left[idx] < right[idx]) {
      return -1;
    } else if (left[idx] > right[idx]) {
      return 1;
    }
  }
  return 0;
}

export const normalizedRegion = ({x, y, x2, y2}) => {
  return {
    minX: Math.min(x, x2),
    maxX: Math.max(x, x2),
    minY: Math.min(y, y2),
    maxY: Math.max(y, y2),
  }
}
