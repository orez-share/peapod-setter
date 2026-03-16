// Module for the `Grid` class
const chunkLen = 2;

import { chunked as chunkedGen, normalizedRegion } from './util';
const chunked = word => chunkedGen(word, chunkLen);

// silly overkill decorators for fns which step through
// the grid either Down or Across.
// The decorated function should be generic over, and accept,:
// - `x` and `y`, some starting position
// - `front`, representing the index of the start of the axis (inclusive)
// - `back`, representing the index past the end of the axis (exclusive)
// - `step`, the amount to step the index by

const downStep = function(fn) {
  return function({x, y, ...kwargs}) {
    console.assert(this instanceof Grid, "`this` bound wrong");
    return fn.call(this, {
      x, y, ...kwargs,
      front: 0,
      back: this.grid.length,
      step: this.width,
    });
  }
};

const acrossStep = function(fn) {
  return function({x, y, ...kwargs}) {
    console.assert(this instanceof Grid, "`this` bound wrong");
    const row = y * this.width;
    return fn.call(this, {
      x, y, ...kwargs,
      front: row,
      back: row + this.width,
      step: 1,
    });
  }
}

// ===
// fn for fetching the "fill pattern" around some coordinate.
// A "pattern" (: [String]) is the cell fill before and after
// the coordinate in the given axis, from wall to wall.

const snagPattern = function({front, back, step, x, y, x2, y2}) {
  // I wrote this function bad, as a joke.
  const { grid, width } = this;
  const ERROR = null;
  let chunkIndex = -1;
  let idx = y * width + x;
  if (grid[idx].wall) return ERROR; // XXX
  // run backwards
  for(; idx >= front; idx -= step) {
    if (grid[idx].wall) break;
    chunkIndex++;
  }
  const region = normalizedRegion({x, y, x2, y2});
  const selIdx = {
    start: region.minY * width + region.minX,
    end: region.maxY * width + region.maxX,
  };
  const sel = { start: null, end: null };
  const start = idx + step;
  let gridChunks = [];
  // run forward and collect chunks
  for (idx = start; idx < back && !grid[idx].wall; idx += step) {
    if (idx == selIdx.start) sel.start = gridChunks.length;
    else if (idx == selIdx.end) sel.end = gridChunks.length;
    gridChunks.push(grid[idx].fill);
  }

  // If we're selecting a single line of cells which falls entirely within
  // the pattern we're snagging, force the suggestions to completely
  // fill the selection.
  //
  // Understanding how these requirements are represented by this condition
  // is left as an exercise to the reader (sorry).
  let exact = false;
  if (sel.start != null && sel.end != null) {
    gridChunks = gridChunks.slice(sel.start, sel.end + 1);
    chunkIndex -= sel.start;
    exact = true;
  }
  return { pattern: gridChunks, index: chunkIndex, exact };
}

// ===

const frontClueCell = function({front, step, x, y}) {
  const { grid, width } = this;
  // unselected value is an empty object
  // because it simplifies the svelte binds
  if (x == null || y == null) return {};
  let idx = x + width * y;
  if (!grid[idx]) return null;
  for (; idx >= front && !grid[idx].wall; idx -= step) { }
  return grid[idx + step];
};

// fns for setting a full clue starting at some coordinate.
// delimits the clue with walls, if needed.
//
// Note that this fn does not perform the changes, but instead returns a
// set of updates to be performed.
//
// XXX: does not check that this is legal fill
const updatesForFill = function({front, back, step, x, y, word, pivotIdx}) {
  let idx = y * this.width + x - pivotIdx * step;
  const updates = [];
  if (front <= idx - step) {
    updates.push({
      idx: idx - step,
      is: {
        fill: "",
        wall: true,
      },
    });
  }
  for (const fill of chunked(word)) {
    updates.push({
      idx,
      is: {
        fill,
        wall: false,
      },
    });
    idx += step;
  }
  if (idx < back) {
    updates.push({
      idx,
      is: {
        fill: "",
        wall: true,
      },
    });
  }
  return updates;
}

// ===

export default class Grid {
  constructor({width, height, grid}) {
    console.assert(grid == null || grid.length === width * height, "wrong size grid");
    this.width = width;
    this.height = height;
    this.grid = grid ?? Array(width * height).fill(null)
      .map(() => ({
        wall: false,
        fill: "",
        number: null,
        downClue: null,
        acrossClue: null,
      }));
    this.renumber();
  }

  acrossStep(fn) { return acrossStep(fn) }
  downStep(fn) { return downStep(fn) }

  acrossPattern = acrossStep(snagPattern);
  downPattern = downStep(snagPattern);

  acrossClueCell = acrossStep(frontClueCell);
  downClueCell = downStep(frontClueCell);

  updatesForAcrossFill = acrossStep(updatesForFill);
  updatesForDownFill = downStep(updatesForFill);

  cloneSubgrid({minX, minY, maxX, maxY}) {
    const grid = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * this.width + x;
        grid.push({...this.grid[idx]});
      }
    }
    return new Grid({
      grid,
      height: maxY - minY + 1,
      width: maxX - minX + 1,
    });
  }

  renumber() {
    const { grid, width, height } = this;
    let num = 1;
    const setNum = ({idx, topBounded, leftBounded}) => {
      const cell = grid[idx];
      const bounded = topBounded || leftBounded;
      cell.number = null;
      if (topBounded) cell.downClue ??= "";
      else cell.downClue = null;
      if (leftBounded) cell.acrossClue ??= "";
      else cell.acrossClue = null;
      if (!cell.wall && bounded) {
        cell.number = num;
        num++;
      }
    };

    const isWall = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return true;
      const idx = y * width + x;
      return grid[idx].wall;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        // one cell regions do NOT get clues.
        const topBounded = isWall(x, y-1) && !isWall(x, y+1);
        const leftBounded = isWall(x-1, y) && !isWall(x+1, y);
        setNum({idx, topBounded, leftBounded});
      }
    }
  }
}
