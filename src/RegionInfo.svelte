<script>
  import { Heap } from 'heap-js';
  import { chunked as chunkedGen, normalizedRegion } from './util';

  export let dict;
  export let cellFillLen;
  const chunked = word => chunkedGen(word, cellFillLen);
  const maxResults = 100;

  export let gridCallbacks;
  const {
    getSelectedRegion,
    setPreviewFromSubgrid,
    clearPreview,
  } = gridCallbacks;

  let suggestions = [];
  let searchedRegion = null;
  let status = "start";
  $: searchedOffset = searchedRegion && {offX: searchedRegion.minX, offY: searchedRegion.minY};
  $: ready = status !== "searching";

  const suggestRegion = async () => {
    // The way our current suggestion code works, we REALLY REALLY want to have an anchor.
    // This isn't strictly required, but it simplifies the mental model a bit, I think.
    //
    // so, okay, how about this:
    // start by picking the fill order:
    // - enumerate all the lines we need (filtering out fully-filled lines),
    //   and max-heap em by how many characters are already filled
    //   - or perhaps `max(filled), min(missing)`
    //   - this ensures we always have an anchor
    // - as you pick each one, insert each (new) cross fill back into the heap,
    //   with the weight updated
    // - keep pluckin from the heap, discarding lines we've already plucked
    //
    // After we've got the fill order, we can DFS following that order without
    // having to think too hard about it. But with a modified DFS that can
    // be suspended (ie no recursion).
    //
    // Christ, I wish we were doin this in Rust

    suggestions = [];
    const selectedRegion = getSelectedRegion();
    if (!selectedRegion) return;
    status = "searching";
    const { region, grid } = selectedRegion;
    searchedRegion = region;

    const order = pickSuggestionOrder(grid);
    const generator = findFills(grid, order);

    // TODO: mechanism to cancel the search
    let idx = 0;
    for await (const sub of generator) {
      idx++;
      suggestions.push({ sub, idx });
      suggestions = suggestions;
      if (idx >= maxResults) {
        // TODO: figure out what to do here
        status = "truncated";
        return;
      }
    }
    status = "done";
  }

  const pickSuggestionOrder = sub => {
    // Collect all the lines
    const priorityComparator = (a, b) => b.filled - a.filled || a.missing - b.missing;
    const frontier = new Heap(priorityComparator);
    const current = new Map;
    const fromPattern = args => {
      const pattern = args.pattern;
      const len = pattern.length;
      const missing = pattern.reduce((agg, fill) => agg + (fill.length !== cellFillLen), 0);
      if (!missing) return null;
      const filled = len - missing;
      const end = args.start + args.step * pattern.length;
      return { missing, filled, end, ...args };
    }
    for (let idx = 0; idx < sub.grid.length; idx++) {
      const x = idx % sub.width;
      const y = Math.floor(idx / sub.width);
      const cell = sub.grid[idx];
      if (cell.acrossClue != null) {
        const across = sub.acrossPattern({x, y});
        const elem = fromPattern({
          pattern: across.pattern,
          start: idx,
          step: 1,
          dir: "across",
          id: `${cell.number}A`,
        });
        if (elem) {
          frontier.push({...elem});
          current.set(elem.id, elem);
        }
      }
      if (cell.downClue != null) {
        const down = sub.downPattern({x, y});
        const elem = fromPattern({
          pattern: down.pattern,
          start: idx,
          step: sub.width,
          dir: "down",
          id: `${cell.number}D`,
        });
        if (elem) {
          frontier.push({...elem});
          current.set(elem.id, elem);
        }
      }
    }

    // Determine an order
    const order = [];
    const seenLines = new Set;
    const seenCells = new Set; // XXX: could be a `bool[]` instead.
    const pick = ({start, step, end}) => ({start, step, end});
    let elem;
    while (elem = frontier.pop()) {
      if (seenLines.has(elem.id)) continue;
      seenLines.add(elem.id);

      // Track which `cells` we're actually updating with this line.
      // ie: which cells aren't being updated by another line
      const cells = [];
      for (let idx = elem.start; idx < elem.end; idx += elem.step) {
        const fill = sub.grid[idx].fill;
        const isFilled = fill.length === cellFillLen;
        if (isFilled || seenCells.has(idx)) continue;
        seenCells.add(idx);
        cells.push([idx, fill]);

        // update `missing` and `filled` on the cross line
        const x = idx % sub.width;
        const y = Math.floor(idx / sub.width);
        // note these conditions are intentionally swapped: we're seeking the cross line.
        const crossCell = elem.dir === "across" ? sub.downClueCell({x, y}) : sub.acrossClueCell({x, y});
        if (!crossCell) continue; // no cross line
        const crossId = elem.dir === "across" ? `${crossCell.number}D` : `${crossCell.number}A`;
        const cross = current.get(crossId);
        if (!cross) continue; // no cross line
        cross.missing -= 1;
        cross.filled += 1;
        frontier.push({...cross});
      }
      order.push({...pick(elem), cells});
    }
    // order: {cells: [idx, fill], start, step, end }}
    return order;
  }

  // &dict
  async function* findFills(sub, order) {
    if (!order.length) return;
    // Don't suggest fill with duplicate words in it.
    // Like, cmon man.
    const seenWords = new Set;

    // Each element of the stack contains the following properties:
    // - `fills`: a list of words (`string[]`) which could fit this line
    // - `seek`: the index in `fills` of the next word we're going to try
    // - `cur`: the index in `fills` of the word currently slotted into the grid.
    // - `stack[i]`'s `start` and `step` are copied from `order[i]`, for convenience.
    //   These define how to walk the line.
    const stack = [];
    // &mut stack, &sub, &order, &dict
    const addFrame = () => {
      const { start, step, end } = order[stack.length];
      const gridChunks = [];
      for (let idx = start; idx < end; idx += step) {
        gridChunks.push(sub.grid[idx].fill);
      }
      const { gridFills } = dict.filterFit(gridChunks, 0, true);
      const fills = gridFills.map(elem => elem.entry.word);
      stack.push({ fills, seek: 0, cur: null, start, step });
    }
    addFrame();

    // https://stackoverflow.com/a/63646084
    // Finding fills is a slow process. We don't want to freeze the tab while we
    // churn on it. `await`ing a `setTimeout` allows the UI to update, preventing
    // the freezing effect. Running a `setTimeout` every iteration is slow, however
    // (slows down fill find results). So we only run it every 20ms.
    let startTime = performance.now();
    async function refreshUi() {
      const waitMs = 20;
      if(performance.now() > startTime + waitMs) {
        startTime = performance.now();
        await new Promise(r => setTimeout(r, 0));
      }
    }

    while (true) {
      await refreshUi();
      // # Succ
      // Pop frames with no more potential words
      let top;
      while ((top = stack[stack.length - 1]) && top.seek >= top.fills.length) {
        if (top.cur != null) seenWords.delete(top.fills[top.cur]);
        stack.pop();
        // reset the cells set by this slot
        for (let [idx, fill] of order[stack.length].cells) {
          sub.grid[idx].fill = fill;
        }
      }
      // no more possible fills
      if (!top) return;

      // apply the next word
      const word = top.fills[top.seek];
      if (seenWords.has(word)) {
        top.seek++;
        continue;
      }
      seenWords.add(word);
      if (top.cur != null) seenWords.delete(top.fills[top.cur]);
      top.cur = top.seek;
      let idx = top.start;
      for (const fill of chunked(word)) {
        sub.grid[idx].fill = fill;
        idx += top.step;
      }
      top.seek++;

      // if we've filled our slots, yield this as a possible fill
      if (stack.length === order.length) {
        yield sub.clone(); // TODO: dunno if this is the most helpful return format.
        continue;
      }
      // otherwise, add a frame
      addFrame();
    }
  }

  // ===

  const displayStatus = status => {
    switch (status) {
      case "start":
        return ""
      case "searching":
        return "Searching..."
      case "truncated":
        return `Stopping after ${maxResults} results.`
      case "done":
        return `Done! Found ${suggestions.length} result${suggestions.length === 1 ? "" : "s"}.`
      default:
        throw new Error(`unexpected status ${status}`);
    }
  }
</script>

<div class="body">
  <button disabled={!ready} on:click={suggestRegion}>Suggest Fill</button>
  { displayStatus(status) }
  <div class="opt-grid">
    {#each suggestions as suggestion}
      <div
        on:mouseover={() => setPreviewFromSubgrid(suggestion.sub, searchedOffset)}
        on:mouseout={() => clearPreview()}
      >
        Option {suggestion.idx}
      </div>
    {/each}
  </div>
</div>

<style>
  .body {
    overflow: auto;
    background-color: lightblue;
    font-family: Arial;
    padding: 16px 40px;
  }

  .opt-grid {
    margin-top: 20px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }

  .opt-grid > * {
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: 10px;
  }
</style>
