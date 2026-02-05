<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import init, { generate_puz } from "xword-puz";
  import { chunked as chunkedGen } from './util';
  import { serializeGrid, deserializeGrid } from './serde';
  import { renumberSubgrid } from "./grid";

  export let cellFillLen;
  const chunked = word => chunkedGen(word, cellFillLen);

  const height = 20;
  const width = 20;

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

  let grid = Array(width * height).fill(null)
    .map(() => ({
      wall: false,
      fill: "",
      number: null,
      downClue: null,
      acrossClue: null,
    }));

  const setSelected = sel => {
    selected = {x: sel.x, y: sel.y, x2: sel.x, y2: sel.y};
    dispatchUpdate();
  }

  const dispatchUpdate = () => {
    if (!selected) return;
    let idx = selected.y * width + selected.x;
    dispatch('update', {
      downPattern: downPattern(selected),
      acrossPattern: acrossPattern(selected),
      cell: grid[idx],
    });
  }

  // silly overkill decorators for fns which step through
  // the grid either Down or Across.
  // The decorated function should be generic over, and accept,:
  // - `x` and `y`, some starting position
  // - `front`, representing the index of the start of the axis (inclusive)
  // - `back`, representing the index past the end of the axis (exclusive)
  // - `step`, the amount to step the index by

  const downStep = fn => ({x, y, ...kwargs}) => fn({
    x, y, ...kwargs,
    front: 0,
    back: grid.length,
    step: width,
  });

  const acrossStep = fn => ({x, y, ...kwargs}) => {
    const row = y * width;
    return fn({
      x, y, ...kwargs,
      front: row,
      back: row + width,
      step: 1,
    });
  }

  // fns for fetching the "fill pattern" around some coordinate.
  // A "pattern" (: [String]) is the cell fill before and after
  // the coordinate in the given axis, from wall to wall.

  const snagPattern = ({front, back, step, x, y, x2, y2}) => {
    // I wrote this function bad, as a joke.
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
      const fill = grid[idx].fill;
      // XXX: omit partially-filled cells, for now
      const partialFill = fill.length && fill.length !== cellFillLen;
      gridChunks.push(partialFill ? "" : fill);
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

  const acrossPattern = acrossStep(snagPattern);
  const downPattern = downStep(snagPattern);

  // fns for setting a full clue starting at some coordinate.
  // delimits the clue with walls, if needed.

  // XXX: does not check that this is legal fill
  const setFill = ({front, back, step, x, y, word, pivotIdx}) => {
    let idx = y * width + x - pivotIdx * step;
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
    performAction("Set fill", updates);
    gridRef.focus();
    renumber();
    dispatchUpdate();
  };

  const setAcrossFill = acrossStep(setFill);
  const setDownFill = downStep(setFill);
  export const setAcrossFillAtSelected = ({...args}) => setAcrossFill({...selected, ...args});
  export const setDownFillAtSelected = ({...args}) => setDownFill({...selected, ...args});

  const frontClueCell = ({front, step, x, y, grid}) => {
    // unselected value is an empty object
    // because it simplifies the svelte binds
    if (x == null || y == null) return {};
    let idx = x + width * y;
    if (!grid[idx]) return null;
    for (; idx >= front && !grid[idx].wall; idx -= step) { }
    return grid[idx + step];
  };
  const acrossClueCell = acrossStep(frontClueCell);
  const downClueCell = downStep(frontClueCell);

  // ===

  const setPreview = ({front, back, step, x, y, word, pivotIdx}) => {
    let idx = y * width + x - pivotIdx * step;
    preview.clear();
    for (const chunk of chunked(word)) {
      preview.set(idx, chunk);
      idx += step;
    }
    preview = preview;
  };
  const setPreviewAcross = acrossStep(setPreview);
  const setPreviewDown = downStep(setPreview);
  export const setPreviewAcrossAtSelected = ({...args}) => setPreviewAcross({...selected, ...args});
  export const setPreviewDownAtSelected = ({...args}) => setPreviewDown({...selected, ...args});
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
    renumber();
  }

  const renumber = () => renumberSubgrid({grid, width, height});

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
    renumber(); // TODO: could only renumber if a wall were changed.
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
    renumber(); // TODO: could only renumber if a wall were changed.
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
    renumber();
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

  const normalizedRegion = ({x, y, x2, y2}) => {
    return {
      minX: Math.min(x, x2),
      maxX: Math.max(x, x2),
      minY: Math.min(y, y2),
      maxY: Math.max(y, y2),
    }
  }

  const normalizedSelected = () => normalizedRegion(selected);

  const copySelected = () => {
    if (!selected) return;
    let region = normalizedSelected();
    const clone = cloneSubgrid(region);
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
    renumber();
  }

  const cloneSubgrid = ({minX, minY, maxX, maxY}) => {
    const subgrid = [];
    const subheight = maxY - minY + 1;
    const subwidth = maxX - minX + 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * width + x;
        subgrid.push({...grid[idx]});
      }
    }
    return { grid: subgrid, width: subwidth, height: subheight };
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

    const sub = cloneSubgrid(region);
    renumberSubgrid(sub);
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

  $: selAcrossClueCell = acrossClueCell({...selected, grid});
  $: selDownClueCell = downClueCell({...selected, grid});
  renumber();

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
        {@const previewFill = preview.get(idx)}
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
          {#if !cell.fill && previewFill }
            <span class="cell-fill preview">{previewFill}</span>
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
    display: inline-block;
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
