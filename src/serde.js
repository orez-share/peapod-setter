import { cellFillLen } from './constants';
import { filterMap } from "./util";
import Grid from "./grid";

const EMPTY_ONE = 28;
const EMPTY_MANY = 29;
const WALL_ONE = 30;
const WALL_MANY = 31;

const MANY = 3;

const encodeChr = (byte) => {
  if (byte < 65 || byte > 90) {
    throw new Error("found unexpected character in fill");
  }
  return byte - 65;
}

export const serializeGrid = (sub) => {
  return {
    fill: serializeFill(sub),
    across: filterMap(sub.grid, (elem) => elem.acrossClue),
    down: filterMap(sub.grid, (elem) => elem.downClue),
  }
}

const serializeFill = ({grid, width, height}) => {
  let idx;

  // Closure over `&mut idx`.
  // I miss Rust.
  const compress = (one, many, pred) => {
    const start = idx;
    while (idx < grid.length && pred(grid[idx])) idx++;
    let len = idx - start;
    while (len > 0) {
      if (len == 1) {
        write5(one);
        break;
      } else if (len == 2) {
        write5(one);
        write5(one);
        break;
      } else {
        const take = Math.min(len, 255 + MANY);
        len -= take;
        write5(many);
        write8(take - MANY);
      }
    }
  };

  const bytes = [0];
  let remBits = 8;

  const write = (byte, bits) => {
    const last = bytes.length - 1;
    if (bits <= remBits) { // if it fits
      remBits -= bits;
      const left = (byte << remBits) & 0xFF;
      bytes[last] |= left;
    } else { // if it's doesn't fits
      const left = (byte >> (bits - remBits)) & 0xFF;
      remBits += 8;
      remBits -= bits;
      const right = (byte << remBits) & 0xFF;
      bytes[last] |= left;
      bytes.push(right);
    }
  };
  const write5 = (byte) => write(byte, 5);
  const write8 = (byte) => write(byte, 8);

  // everything before this is setting up closure nonsense.
  // this begins the actual encoding algo.
  if (width > 256 || width == 0) {
    throw new Error("unsupported width")
  }
  write8(width-1);
  if (height > 256 || height == 0) {
    throw new Error("unsupported height")
  }
  write8(height-1);

  for (idx = 0; idx < grid.length;) {
    if (grid[idx].wall) {
      compress(WALL_ONE, WALL_MANY, elem => elem.wall);
    } else if (grid[idx].fill === "") {
      compress(EMPTY_ONE, EMPTY_MANY, elem => !elem.wall && elem.fill === "");
    } else if (grid[idx].fill.length > cellFillLen) {
      throw new Error("rebuses are unsupported")
    } else {
      const fill = grid[idx].fill;
      for (let i = 0; i < fill.length; i++) {
        const chr = encodeChr(fill.charCodeAt(i));
        write5(chr);
      }
      if (fill.length < cellFillLen) write5(EMPTY_ONE);
      idx++
    }
  }
  // encoding a character of fill as 5 bits (8 bits -> 5 bits)
  // and then base64 encoding it (6 bits -> 8 bits)
  // only really gives us slight savings.. (5/6s the size).
  // What I'm saying is I definitely overcomplicated this.
  return Uint8Array.from(bytes).toBase64({omitPadding: true});
}

export const deserializeGrid = ({fill, across, down}) => {
  const grid = deserializeFill(fill);
  const acrossIt = across.values();
  const downIt = down.values();
  for (let cell of grid.grid) {
    if (cell.downClue != null) {
      cell.downClue = downIt.next().value;
    }
    if (cell.acrossClue != null) {
      cell.acrossClue = acrossIt.next().value;
    }
  }
  return grid;
}


// The fill serialization format is a compressed, bit-packed version of the grid,
// with run length encoding for walls and empty cells.
//
// The data is bit-compacted:
// - When we read a `character`, we read the next 5 bits. Values 0-25 correspond to
//   the ascii alphabet, while 26-31 are reserved for control characters.
// - When we read a `number`, we read the next 8 bits. The actual value of the number may be
//   shifted by a constant depending on its context.
//
// Deserialization follows the following process:
// - The input starts base64 encoded (for portability), so we need to decode this first.
// - The first two bytes denote the width and height of the grid. Each byte is 1 lower than
//   the actual value (since you can't have a 0-width grid).
//   - eg: if we read 7, then the grid is 8 wide
// - The remainder of the payload represents the grid fill, per cell from left to right,
//   top to bottom. It is read until the grid is filled, in the following way:
//   - We read 5 bits for a character
//     - If the character is a letter, we read another 5 bits for the second character
//       in the cell.
//       - If the second character is a letter, we add both letters to the cell.
//       - If the second character is control character EMPTY_ONE, we add just the one letter.
//       - Any other value is an error.
//     - If the character is EMPTY_ONE, we add an empty cell to the grid.
//     - If the character is EMPTY_MANY, we read 8 bytes to determine how many empty cells to add.
//       The number we read is 3 less than the number of cells.
//       - eg: if we read 7, then we add 10 empty cells
//       - note that we encode two empty cells as two EMPTY_ONE characters.
//     - WALL_ONE and WALL_MANY act as EMPTY_ONE and EMPTY_MANY, but for walls.
//     - Any other value is an error.
const deserializeFill = (fill) => {
  const EMPTY = { fill: "", wall: false};
  const WALL = { fill: "", wall: true };
  const grid = [];
  const bytes = Uint8Array.fromBase64(fill);
  let bytedx = 0;
  let bitdx = 0;

  const read = (bits) => {
    let byte = bytes[bytedx];
    if (bitdx + bits <= 8) {
      bitdx += bits;
      const mask = (1 << bits) - 1;
      const out = (byte >> (8 - bitdx)) & mask;
      return out;
    }
    const leftBits = 8 - bitdx;
    const rightBits = bits - leftBits;
    const leftMask = (1 << leftBits) - 1;
    const left = (byte & leftMask) << rightBits;
    bytedx++;
    byte = bytes[bytedx];
    bitdx = rightBits;
    if (bytedx >= bytes.length) {
      throw new Error("could not deserialize -- unexpected end of stream");
    }
    const rightMask = (1 << rightBits) - 1;
    const right = (byte >> (8 - rightBits)) & rightMask;
    return left | right;
  }

  const width = read(8) + 1;
  const height = read(8) + 1;

  let elem;
  while (grid.length < width * height) {
    const elem = read(5);
    if (elem < 26) {
      const cell = [elem + 65];

      for (let i = 1; i < cellFillLen; i++) {
        const next = read(5);
        if (next === EMPTY_ONE) break;
        if (next >= 26) throw new Error("could not deserialize -- unexpected fill byte");
        cell.push(next + 65);
      }
      const fill = String.fromCharCode(...cell);
      grid.push({ fill, wall: false });
    } else if (elem === EMPTY_ONE) {
      grid.push({...EMPTY});
    } else if (elem === EMPTY_MANY) {
      const count = read(8) + MANY;
      for (let n = 0; n < count; n++) {
        grid.push({...EMPTY});
      }
    } else if (elem === WALL_ONE) {
      grid.push({...WALL});
    } else if (elem === WALL_MANY) {
      const count = read(8) + MANY;
      for (let n = 0; n < count; n++) {
        grid.push({...WALL});
      }
    } else {
      throw new Error("could not deserialize -- unexpected control byte");
    }
  }
  return new Grid({ grid, width, height });
}
