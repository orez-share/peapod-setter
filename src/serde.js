import { filterMap } from "./util";
import { renumberSubgrid } from "./grid";

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
  // if the copied subgrid has dangling one-long sections
  // that were not one-long in the full grid, we want to be
  // sure we clear their `*Clue` fields.
  renumberSubgrid(sub);
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
    } else {
      const fill = grid[idx].fill;
      const first = encodeChr(fill.charCodeAt(0));
      const second = fill.length === 1 ? EMPTY_ONE : encodeChr(fill.charCodeAt(1));
      write5(first);
      write5(second);
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
  renumberSubgrid(grid);
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
      let fill;
      const next = read(5);
      if (next === EMPTY_ONE) {
        fill = String.fromCharCode(elem + 65);
      } else if (next < 26) {
        fill = String.fromCharCode(elem + 65, next + 65);
      } else {
        throw new Error("could not deserialize -- unexpected fill byte");
      }
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
  return { grid, width, height };
}
