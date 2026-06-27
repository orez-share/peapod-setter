import { base } from '$app/paths';
import { cellFillLen as chunkLen } from "./constants";
import { chunked, filterMap, keyToCmp } from "./util";

export default async () => {
  const file = await fetch(`${base}/dict/words.txt`);
  const text = await file.text();
  const entries = filterMap(text.split('\n'), toEntry);

  const chunkIndex = new Map;
  for (const entry of entries) {
    const chunks = new Set(entry.chunks);
    for (const chunk of chunks) {
      const indexEntry = chunkIndex.get(chunk) || [];
      indexEntry.push(entry);
      chunkIndex.set(chunk, indexEntry);
    }
  }

  const exactChunkIndex = new Map;
  for (const entry of entries) {
    const len = entry.chunks.length;
    for (const [idx, chunk] of entry.chunks.entries()) {
      const key = exactChunkIndexKey(idx, chunk, len);
      const indexEntry = exactChunkIndex.get(key) || [];
      indexEntry.push(entry);
      exactChunkIndex.set(key, indexEntry);
    }
  }

  return { entries, chunkIndex, exactChunkIndex, filterFit };
}

// I hate javascript I hate javascript I hate javascript I hate javascript
const exactChunkIndexKey = (idx, chunk, length) => `${idx}${chunk}${length}`;

function wordFitsGrid(wordChunks, gridChunks, gridStart) {
  return wordChunks.every((chunk, idx) => {
    const cell = gridChunks[gridStart + idx];
    return chunk.includes(cell);
  });
}

function filterFit(gridChunks, pivotIndex, exact) {
  const fn = exact ? filterFitExact : filterFitInexact;
  let gridFills = fn.call(this, gridChunks, pivotIndex);

  gridFills.sort(keyToCmp(elem => [-elem.entry.score, elem.entry.word, elem.pivotIdx]));
  // this is `dedupe`, but we avoid writing a util function for it
  // because somehow JS has gotten away with being the only modern
  // language to not provide _equality_ out of the box.
  let prev = null;
  gridFills = gridFills.reduce((acc, elem) => {
    // XXX: this equality check is brittle and sucks.
    // in particular `entry` is doing an identity check.
    if (!(prev && elem.pivotIdx == prev.pivotIdx && elem.entry == prev.entry)) {
      acc.push(elem);
      prev = elem;
    }
    return acc;
  }, []);

  return gridFills;
}

function filterFitExact(gridChunks, pivotIdx) {
  let gridFills = [];

  // Pick a set of potential fills from our index
  let potentials = null;
  for (const [idx, chunk] of gridChunks.entries()) {
    if (chunk.length !== chunkLen) continue;
    const key = exactChunkIndexKey(idx, chunk, gridChunks.length);
    const pot = this.exactChunkIndex.get(key) || [];
    if (potentials == null || potentials.length > pot.length) potentials = pot;
  }

  if (potentials == null) {
    // When we've got no anchor points on an exact fill, we simply
    // find all words of the proper length.
    potentials = this.entries.filter(entry => entry.chunks.length === gridChunks.length);
  }

  // Filter the indexed potentials down to words that actually fit
  potentials = potentials.filter(entry => wordFitsGrid(entry.chunks, gridChunks, 0));
  return potentials.map(entry => ({ entry, pivotIdx }));
}

// Find words that fit the given `gridChunks`, such that they include the
// cell at `pivotIndex`.
// The exact length and position of matching words is otherwise unconstrained.
//
// ["", "AB", "", "CD"] <- gridChunks
//             ^ pivotIndex
function filterFitInexact(gridChunks, pivotIndex) {
  // pivotIndex is relative to gridChunks
  // anchorIdx is relative to gridChunks
  // wordIdx is relative to wordChunks

  // TODO: `gridFills` is sucks.
  // we want a Set<(String, usize)>,
  // but js makes this hell.
  // (usize => idx into `grid`)
  let gridFills = [];

  // This fn was written assuming a single (full) cell is enough to prune
  // a LOT of the full dictionary. This is true for a peapod; this is
  // NOT true for a crossword.
  //
  // Would be nice to run this fn nonblocking, or to have an alternate
  // strategy for crosswords. But I don't want to do any of that right now.
  if (chunkLen === 1) return gridFills;

  // `anchor` is the real-ass text closest to our pivot point.
  //   we use this to lookup potential words.
  // `pivot` is our focal cell. It's probably empty, but it _must_
  //   be included within the suggested word.
  const findLineFill = anchorIdx => {
    let anchor = gridChunks[anchorIdx];
    let words = this.chunkIndex.get(anchor) || [];
    for (const entry of words) {
      const wordChunks = entry.chunks;
      for (const [wordIdx, chunk] of wordChunks.entries()) {
        if (chunk === anchor) {  // try anchoring here
          // word       ["AB", "CD", "EF", "GH"]
          // grid [ "" ,  "" , "CD",  "" ,  "" ]
          //             anchor ^      ^ pivot
          // anchorIdx = 2
          //   wordIdx = 1

          // these are the indexes in `gridChunks` that delimit
          // where `word` would be placed.
          const gridStart = anchorIdx - wordIdx;
          const gridEnd = gridStart + wordChunks.length;

          const wordPivotIdx = pivotIndex - gridStart;
          // we wanna include the pivot pt in the words we're lookin for.
          // that's... the whole point.
          if (wordPivotIdx < 0 || wordPivotIdx >= wordChunks.length) continue;
          const pivot = wordChunks[wordPivotIdx];

          if (gridStart < 0) continue; // `word` starts too early
          // bad boundary: can't place the bookending wall
          if (gridStart > 0 && gridChunks[gridStart - 1]) continue;

          if (gridEnd > gridChunks.length) continue; // `word` ends too late
          // bad boundary: can't place the bookending wall
          if (gridEnd < gridChunks.length && gridChunks[gridEnd]) continue;

          // all characters fit
          const fits = wordFitsGrid(wordChunks, gridChunks, gridStart);
          if (!fits) continue;

          // we good!
          gridFills.push({ entry, pivotIdx: wordPivotIdx});
        }
      }
    }
  };

  if (gridChunks[pivotIndex].length === chunkLen) {
    findLineFill(pivotIndex);
  } else {
    // find words that fit:
    // - previous filled cell from pivot (& include pivot)
    for (let idx = pivotIndex; idx >= 0; idx--) {
      if (gridChunks[idx].length === chunkLen) {
        findLineFill(idx);
        break
      }
    }

    // find words that fit:
    // - next filled cell from pivot (& include pivot)
    for (let idx = pivotIndex; idx < gridChunks.length; idx++) {
      if (gridChunks[idx].length === chunkLen) {
        findLineFill(idx);
        break
      }
    }
  }

  return gridFills;
}

const toEntry = line => {
  let [word, score] = line.split(';');
  if (!word.match(`^([A-Z]{${chunkLen}})+$`)) return null;

  score = +score;
  const chunks = chunked(word);
  return { word, score, chunks }
}
