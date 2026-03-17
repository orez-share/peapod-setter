<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import init, { generate_puz } from "xword-puz";
  import { chunked as chunkedGen, normalizedRegion } from './util';
  import { serializeGrid, deserializeGrid } from './serde';
  import Grid from "./grid";
  import { Heap } from 'heap-js';

  export let cellFillLen;
  export let dict;
  const chunked = word => chunkedGen(word, cellFillLen);

  const gridObj = new Grid({width: 20, height: 20});
  $: grid = gridObj.grid;
  $: width = gridObj.width;
  $: height = gridObj.height;

  const dispatch = createEventDispatcher();
  let undos = [];
  let redos = [];

  let gridRef;
  let preview = new Map;
  let title = "Untitled";
  let author = "Anonymous";
  let selected = null;
  $: selectedCell = selected && grid[selected.x + selected.y * width];
  $: showClues = selectedCell && !selectedCell.wall;
  $: isAreaSelected = selected && (selected.x != selected.x2 || selected.y != selected.y2);

  let suggestion;

  const setSelected = sel => {
    selected = {x: sel.x, y: sel.y, x2: sel.x, y2: sel.y};
    dispatchUpdate();
  }

  const dispatchUpdate = () => {
    if (!selected) return;
    let idx = selected.y * width + selected.x;
    dispatch('update', {
      downPattern: gridObj.downPattern(selected),
      acrossPattern: gridObj.acrossPattern(selected),
      cell: grid[idx],
    });
  }

  const setUpdates = updates => {
    performAction("Set fill", updates);
    gridRef.focus();
    gridObj.renumber();
    dispatchUpdate();
  };

  export const setAcrossFillAtSelected = args => {
    const updates = gridObj.updatesForAcrossFill({...selected, ...args});
    setUpdates(updates);
  };
  export const setDownFillAtSelected = args => {
    const updates = gridObj.updatesForDownFill({...selected, ...args});
    setUpdates(updates);
  }

  // ===

  const setPreview = ({step, x, y, word, pivotIdx}) => {
    let idx = y * width + x - pivotIdx * step;
    preview.clear();
    for (const chunk of chunked(word)) {
      preview.set(idx, chunk);
      idx += step;
    }
    preview = preview;
  };
  const setPreviewAcross = gridObj.acrossStep(setPreview).bind(gridObj);
  const setPreviewDown = gridObj.downStep(setPreview).bind(gridObj);
  export const setPreviewAcrossAtSelected = args => setPreviewAcross({...selected, ...args});
  export const setPreviewDownAtSelected = args => setPreviewDown({...selected, ...args});
  export const setPreviewAtSelected = fill => {
    let idx = selected.y * width + selected.x;
    preview.clear();
    preview.set(idx, fill);
    preview = preview;
  };
  export const clearPreview = () => {
    preview.clear();
    preview = preview;
  }

  // ===

  export const setFillAtSelected = fill => {
    performAction("Set fill", [{
      idx: selected.y * width + selected.x,
      is: {
        wall: false,  // ᖍ(∙⟞∙)ᖌ
        fill,
      },
    }]);
    gridRef.focus();
    dispatchUpdate();
  }

  const toggleWall = (evt, x, y) => {
    evt.preventDefault();
    const idx = y * width + x;
    performAction("Toggle wall", [{
      idx,
      is: {
        fill: "",
        wall: !grid[idx].wall,
      }
    }]);
    gridObj.renumber();
  }

  const handleCellMouseOver = ({event, x, y}) => {
    if (event.buttons != 1 || selected?.state !== "area") return;
    selected.x2 = x;
    selected.y2 = y;
    dispatchUpdate();
  }

  const handleKey = evt => {
    switch (evt.keyCode) {
      case 37: // <
        evt.preventDefault();
        if (selected && selected.x > 0) {
          setSelected({x: selected.x - 1, y: selected.y});
        }
        break;
      case 38: // ^
        evt.preventDefault();
        if (selected && selected.y > 0) {
          setSelected({x: selected.x, y: selected.y - 1});
        }
        break;
      case 39: // >
        evt.preventDefault();
        if (selected && selected.x < width-1) {
          setSelected({x: selected.x + 1, y: selected.y});
        }
        break;
      case 40: // v
        evt.preventDefault();
        if (selected && selected.y < height-1) {
          setSelected({x: selected.x, y: selected.y + 1});
        }
        break;
      case 8: // bksp
        if (!selected) return;
        if (isAreaSelected) {
          deleteSelected("Delete region");
          break;
        }
        const idx = selected.y * width + selected.x;
        if (grid[idx].fill.length) {
          performAction("Delete cell contents", [{idx, is: {fill: ""}}]);
        } else if (selected.x != 0 && !grid[idx-1].wall) {
          setSelected({x: selected.x - 1, y: selected.y});
        }
        break;
      default:
        if (!selected) return;
        if (evt.ctrlKey || evt.metaKey) {
          switch (evt.keyCode) {
            case 67: // C
              copySelected();
              break;
            case 88: // X
              copySelected();
              deleteSelected("Cut region");
              break;
            case 86: // V
              navigator.clipboard.readText().then(text => {
                // TODO: we should REALLY, REALLY sanitize this input.
                let obj;
                let pastable;
                try {
                  obj = JSON.parse(text);
                  pastable = deserializeGrid(obj);
                } catch (exc) {
                  console.warn(exc);
                  return
                };
                paste(pastable);
              })
              break;
            case 90: // Z
              if (evt.shiftKey) {
                redo();
              } else {
                undo();
              }
              break;
          }
        }
        if (evt.ctrlKey || evt.altKey || evt.metaKey) return;
        if (evt.keyCode > 64 && evt.keyCode < 91) {
          const chr = String.fromCharCode(evt.keyCode);
          const idx = selected.y * width + selected.x;
          if (grid[idx].wall) return;
          if (grid[idx].fill.length < cellFillLen) {
            const fill = grid[idx].fill + chr;
            performAction("Type character", [{idx, is: {fill}}]);
          }
        }
    }
  };

  const cellIsSelected = (selected, x, y) => {
    if (!selected) return false;
    const { minX, maxX, minY, maxY } = normalizedSelected();
    return minX <= x && x <= maxX &&
      minY <= y && y <= maxY;
  }

  // Perform an undo-able action, and register it to the undo stack.
  const performAction = (action, updates) => {
    for (let update of updates) {
      const keys = Object.keys(update.is);
      update.was = Object.fromEntries(keys.map(key => [key, grid[update.idx][key]]));
      grid[update.idx] = {...grid[update.idx], ...update.is};
    }

    undos.push({action, updates});
    undos = undos;
    redos = [];
    dispatchUpdate();
  }

  const undo = () => {
    let action = undos.pop();
    redos.push(action);

    for (let update of action.updates) {
      grid[update.idx] = {...grid[update.idx], ...update.was};
    }

    undos = undos;
    redos = redos;
    gridObj.renumber(); // TODO: could only renumber if a wall were changed.
    gridRef.focus();
    dispatchUpdate();
  }

  const redo = () => {
    let action = redos.pop();
    undos.push(action);

    for (let update of action.updates) {
      grid[update.idx] = {...grid[update.idx], ...update.is};
    }

    undos = undos;
    redos = redos;
    gridObj.renumber(); // TODO: could only renumber if a wall were changed.
    gridRef.focus();
    dispatchUpdate();
  }

  const paste = (sub) => {
    if (!selected) return;
    // TODO: some visual feedback if this fails
    if (selected.x + sub.width > width || selected.y + sub.height > height) return;
    const updates = [];
    let gridIdx = 0;
    for (let y = 0; y < sub.height; y++) {
      for (let x = 0; x < sub.width; x++) {
        const idx = (selected.y + y) * width + (selected.x + x);
        updates.push({
          idx,
          is: sub.grid[gridIdx],
        });
        gridIdx++;
      }
    }
    performAction("Paste region", updates);
    gridObj.renumber();
  }

  const downloadURL = (data, fileName) => {
    const a = document.createElement('a');
    a.href = data;
    a.download = fileName;
    document.body.appendChild(a);
    a.style.display = 'none';
    a.click();
    a.remove();
  }

  const downloadBlob = (data, fileName, mimeType) => {
    const blob = new Blob([data], {
      type: mimeType
    });
    const url = window.URL.createObjectURL(blob);
    downloadURL(url, fileName);
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }

  const normalizedSelected = () => normalizedRegion(selected);

  const copySelected = () => {
    if (!selected) return;
    let region = normalizedSelected();
    const clone = gridObj.cloneSubgrid(region);
    let serialized = serializeGrid(clone);
    navigator.clipboard.writeText(JSON.stringify(serialized));
  }

  const deleteSelected = (action) => {
    if (!selected) return;
    const updates = [];
    const { minX, maxX, minY, maxY } = normalizedSelected();

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * width + x;
        updates.push({
          idx,
          is: {
            fill: "",
            wall: false,
          },
        });
      }
    }
    performAction(action, updates);
    gridObj.renumber();
  }

  const exportPuz = () => {
    let region;
    if (isAreaSelected) {
      region = normalizedSelected();
    } else {
      region = {
        minX: 0,
        minY: 0,
        maxX: width-1,
        maxY: height-1,
      };
    }

    const sub = gridObj.cloneSubgrid(region);
    const acrossClues = [];
    const downClues = [];
    for (const cell of sub.grid) {
      if (cell.number == null) continue
      if (cell.acrossClue != null) {
        acrossClues.push([cell.number, cell.acrossClue]);
      }
      if (cell.downClue != null) {
        downClues.push([cell.number, cell.downClue]);
      }
    }
    const fill = sub.grid.map(cell => cell.wall ? null : cell.fill);

    const payload = {
      width: sub.width,
      height: sub.height,
      grid: fill,
      acrossClues,
      downClues,
      title,
      author,
    };
    const fileContents = generate_puz(payload, "ipuz");
    const filename = sanitizeFilename(title) || "Untitled";
    downloadBlob(fileContents, `${filename}.ipuz`, "application/octet-stream");
  }

  const sanitizeFilename = (title) => {
    return title
      .replace(/[^\x23-\x7F]/g, "")
      .replace(/[/?<>\\:*|"]/g, "");
  }

  const inscribePreview = (cell, preview) => {
    if (!preview) return null;
    const idx = preview.indexOf(cell);
    return {
      before: preview.substring(0, idx),
      existing: cell,
      after: preview.substring(idx + cell.length),
    };
  }

  // &gridObj, &mut suggestion
  const suggestRegion = () => {
    // The way our current suggestion code works, we REALLY REALLY want to have a pivot.
    // This isn't strictly required, but it simplifies the mental model a bit, I think.
    //
    // so, okay, how about this:
    // start by picking the fill order:
    // - enumerate all the lines we need (filtering out fully-filled lines),
    //   and max-heap em by how many characters are already filled
    //   - or perhaps `max(filled), min(missing)`
    //   - this ensures we always have a pivot
    // - as you pick each one, insert each (new) cross fill back into the heap,
    //   with the weight updated
    // - keep pluckin from the heap, discarding lines we've already plucked
    //
    // After we've got the fill order, we can DFS following that order without
    // having to think too hard about it. But with a modified DFS that can
    // be suspended (ie no recursion).
    //
    // Christ, I wish we were doin this in Rust

    if (!isAreaSelected) return;
    const region = normalizedSelected();
    // Javascript Have A Std Equality Operator Like Literally
    // Every Other Modern Language Challenge [Impossible]
    const props = ['minX', 'minY', 'maxX', 'maxY'];
    if (!suggestion || !props.every(prop => suggestion.region[prop] === region[prop])) {
      // Prime the generator if we don't have one for this region already
      const sub = gridObj.cloneSubgrid(region);
      const order = pickSuggestionOrder(sub);
      const generator = findFills(sub, order);
      suggestion = { region, generator };
    }
    // TODO: might need to lock the button while the generator is running
    const { done, value } = suggestion.generator.next();
    if (done) {
      suggestion = null;
      console.log("no more suggestions");
      // TODO: display a "no more suggestions" or something.
      return;
    }
    console.log("a suggestion:", value);
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
        const crossId = elem.dir === "across" ? `${crossCell.number}D` : `${crossCell.number}A`;
        const cross = current.get(crossId);
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
  function* findFills(sub, order) {
    // { idx, fills }
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
      stack.push({ fills, idx: 0, start, step });
    }
    addFrame();
    while (true) {
      // # Succ
      // Pop frames with no more potential words
      let top;
      while ((top = stack[stack.length - 1]) && top.idx >= top.fills.length) {
        stack.pop();
        // reset the cells set by this slot
        for (let [idx, fill] of order[stack.length].cells) {
          sub.grid[idx].fill = fill;
        }
      }
      // no more possible fills
      if (!top) return;

      // apply the next word
      const word = top.fills[top.idx];
      let idx = top.start;
      for (const fill of chunked(word)) {
        sub.grid[idx].fill = fill;
        idx += top.step;
      }
      top.idx++;

      // if we've filled our slots, yield this as a possible fill
      if (stack.length === order.length) {
        yield sub; // TODO: dunno if this is the most helpful return format.
        continue;
      }
      // otherwise, add a frame
      addFrame();
    }
  }

  // doing an unpack here to coerce `null` to an object
  $: selAcrossClueCell = gridObj.acrossClueCell({...selected});
  $: selDownClueCell = gridObj.downClueCell({...selected});

  onMount(async () => {
    await init();
  });
</script>

<svelte:window
  on:mouseup={() => selected && (selected.state = null)}
/>
<div id="grid-wrapper">
  <div class="header">
    <div class="meta">
      <div class="flex-container">
        <input class="title fill-width" type="text" bind:value={title} />
      </div>
      <div class="flex-container">
        by&nbsp;<input class="fill-width" type="text" bind:value={author} />
      </div>
    </div>
    <button on:click={exportPuz}>Export{#if isAreaSelected}&nbsp;Selected{/if}</button>
    <button on:click={suggestRegion}>Offer Fill</button>
    <button>Accept Fill</button>
    <button class="push" disabled={undos.length === 0} on:click={undo}>Undo</button>
    <button disabled={redos.length === 0} on:click={redo}>Redo</button>
  </div>
  <div id="grid"
    tabindex="0"
    style="grid-template-columns: repeat({width}, 1fr)"
    on:keydown={handleKey}
    on:contextmenu={evt => evt.preventDefault()}
    bind:this={gridRef}
  >
    {#each {length: height} as _, y }
      {#each {length: width} as _, x }
        {@const idx = width * y + x}
        {@const cell = grid[idx]}
        {@const previewFill = inscribePreview(cell.fill, preview.get(idx))}
        {@const isSelected = selected && selected.x == x && selected.y == y}
        <div class="cell"
          class:selected-area={cellIsSelected(selected, x, y)}
          class:selected={isSelected}
          class:wall={cell.wall}
          class:error={cell.fill.length > 0 && cell.fill.length < cellFillLen}
          on:mousedown={evt => {
            if (evt.buttons === 1) {
              setSelected({x, y});
              selected.state = "area";
            }
          }}
          on:mouseover={event => handleCellMouseOver({event, x, y})}
          on:contextmenu={evt => toggleWall(evt, x, y)}
        >
          {#if cell.number}
            <span class="cell-number">{cell.number}</span>
          {/if}
          {#if previewFill }
            {""+/* We need to cram all these spans into one line because html is maintaining the spaces */""}
            <span class="cell-fill">
              <span class="preview">{previewFill.before}</span><span>{previewFill.existing}</span><span class="preview">{previewFill.after}</span>
            </span>
          {:else}
            <span class="cell-fill">{cell.fill}</span>
          {/if}
        </div>
      {/each}
    {/each}
  </div>
  {#if showClues}
    {#if selAcrossClueCell.number}
      <div class="clue">
        <label for="across-clue">{selAcrossClueCell.number}A</label>
        <div class="flex-container">
          <input id="across-clue"
            class="fill-width"
            type="text"
            bind:value={selAcrossClueCell.acrossClue}
          />
        </div>
      </div>
    {/if}
    {#if selDownClueCell.number}
      <div class="clue">
        <label for="down-clue">{selDownClueCell.number}D</label>
        <div class="flex-container">
          <input id="down-clue"
            class="fill-width"
            type="text"
            bind:value={selDownClueCell.downClue}
          />
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  #grid-wrapper {
    display: flex;
    flex-direction: column;
  }

  #grid {
    display: grid;
    background-color: #111;
    grid-gap: 1px;
    padding: 1px;
  }

  .cell {
    background-color: white;
    width: 2em;
    height: 2em;
    text-align: center;
    font-family: "DejaVu Sans Mono", monospace;
    user-select: none;
    position: relative;
  }

  .error {
    background-color: lightpink;
  }

  #grid:focus .selected.wall {
    background-color: #550;
  }

  #grid:focus .selected {
    background-color: yellow;
  }

  .selected.selected-area.wall {
    background-color: #441;
  }

  .selected.selected-area {
    background-color: #cc6;
  }

  .selected-area.wall {
    background-color: #234;
  }

  .selected-area {
    background-color: #ace;
  }

  .wall {
    background-color: #111;
  }

  .cell-number {
    font-size: 0.5em;
    left: 1px;
    top: 1px;
    position: absolute;
  }

  .cell-fill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 2px;
    margin-left: auto;
    margin-right: auto;
  }

  .preview {
    color: darkgray;
  }

  .clue label {
    display: block;
  }

  .meta {
    display: inline-block;
    width: 400px;
    margin-right: 10px;
  }

  .flex-container {
    display: flex;
  }

  .fill-width {
    flex: 1;
  }

  .header {
    display: flex;
    margin-bottom: 10px;
    width: 661px; /* TODO: don't */
    flex-wrap: wrap;
  }

  .push {
    margin-left: auto;
  }

  input.title {
    font-size: 1.5em;
    display: block;
    margin-bottom: 5px;
  }

  button {
    margin-bottom: 10px;
  }
</style>
