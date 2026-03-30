import { base } from '$app/paths';
import { cellFillLen as chunkLen } from "./constants";
import { chunked, filterMap, keyToCmp } from "./util";

export default async () => {
  const file = await fetch(`${base}/dict/words.txt`);
  const text = await file.text();
  const entries = filterMap(text.split('\n'), toEntry);
  const chunkIndex = new Map;
  for (const entry of entries) {
    const chunks = new Set(chunked(entry.word));
    for (const chunk of chunks) {
      const indexEntry = chunkIndex.get(chunk) || [];
      indexEntry.push(entry);
      chunkIndex.set(chunk, indexEntry);
    }
  }
  return { entries, chunkIndex, filterFit };
}

// ["", "AB", "", "CD"] <- gridChunks
//             ^ pivotIndex
function filterFit(gridChunks, pivotIndex, exact) {
  // pivotIndex is relative to gridChunks
  // anchorIdx is relative to gridChunks
  // wordIdx is relative to wordChunks

  // TODO: `gridFills` is sucks.
  // we want a Set<(String, usize)>,
  // but js makes this hell.
  // (usize => idx into `grid`)
  let gridFills = [];
  let pivotFills = new Set;

  // `anchor` is the real-ass text closest to our pivot point.
  //   we use this to lookup potential words.
  // `pivot` is our focal cell. It's probably empty, but it _must_
  //   be included within the suggested word.
  const fitEm = anchorIdx => {
    let anchor = gridChunks[anchorIdx];
    let words = this.chunkIndex.get(anchor) || [];
    for (const entry of words) {
      const wordChunks = chunked(entry.word);
      if (exact && wordChunks.length != gridChunks.length) continue;
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
          const fits = wordChunks.every((chunk, idx) => {
            const cell = gridChunks[gridStart + idx];
            return chunk.includes(cell);
          });
          if (!fits) continue;

          // we good!
          gridFills.push({ entry, pivotIdx: wordPivotIdx});
          pivotFills.add(pivot);
        }
      }
    }
  };

  if (gridChunks[pivotIndex].length === chunkLen) {
    fitEm(pivotIndex);
  } else {
    // find words that fit:
    // - previous filled cell from pivot (& include pivot)
    for (let idx = pivotIndex; idx >= 0; idx--) {
      if (gridChunks[idx].length === chunkLen) {
        fitEm(idx);
        break
      }
    }

    // find words that fit:
    // - next filled cell from pivot (& include pivot)
    for (let idx = pivotIndex; idx < gridChunks.length; idx++) {
      if (gridChunks[idx].length === chunkLen) {
        fitEm(idx);
        break
      }
    }
  }
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

  return { gridFills, cellFills: pivotFills };
}

const toEntry = line => {
  let [word, score] = line.split(';');
  if (!word.match(`^([A-Z]{${chunkLen}})+$`)) return null;

  score = +score;
  return { word, score }
}
