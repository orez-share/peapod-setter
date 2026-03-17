<script>
  import { onMount } from 'svelte';
  import Grid from '../Grid.svelte';
  import CellInfo from '../CellInfo.svelte';
  import loadDict from '../dict.js';

  const cellFillLen = 2;
  let grid;
  let dict = null;
  let downFills = null;
  let acrossFills = null;
  let cellFills = null;
  onMount(async () => {
    dict = await loadDict();
  });

  const intersect = (left, right) => {
    // XXX: should probably clone here.
    if (!left || !right) return left || right;
    let both = new Set;
    for (const elem of right) {
      if (left.has(elem)) {
        both.add(elem);
      }
    }
    return both;
  }

  const generateCellOptions = evt => {
    grid.clearPreview();
    if (evt.detail.cell?.wall) {
      downFills = null;
      acrossFills = null;
      cellFills = null;
      return
    }
    let allCellFills;
    const getStats = ({ pattern, index, exact }) => {
      // Only look for fits if we have some cell on this axis to anchor on
      if (pattern.some(cell => cell.length === cellFillLen)) {
        const { gridFills, cellFills } = dict.filterFit(pattern, index, exact);
        allCellFills = intersect(allCellFills, cellFills);
        return gridFills;
      }
      return null;
    }

    downFills = getStats(evt.detail.downPattern);
    acrossFills = getStats(evt.detail.acrossPattern);

    // Limit to entries that are fill-able on the other axis.
    // XXX: should this be toggleable?
    downFills = downFills?.filter(({ entry, pivotIdx }) => {
      let idx = pivotIdx * cellFillLen;
      let pivot = entry.word.slice(idx, idx + cellFillLen);
      return allCellFills.has(pivot);
    });
    acrossFills = acrossFills?.filter(({ entry, pivotIdx }) => {
      let idx = pivotIdx * cellFillLen;
      let pivot = entry.word.slice(idx, idx + cellFillLen);
      return allCellFills.has(pivot);
    });

    if (allCellFills != null) {
      cellFills = [...allCellFills];
      cellFills.sort();
    } else {
      cellFills = null;
    }
  }
</script>

<svelte:head>
  <title>🫛 Peapod Crossword Setter</title>
</svelte:head>

<div id="body-wrapper">
  <Grid {dict} bind:this={grid} on:update={generateCellOptions} {cellFillLen} />
  <CellInfo {dict} {downFills} {acrossFills} {cellFills} {cellFillLen}
    on:fillAcross={evt => grid.setAcrossFillAtSelected(evt.detail)}
    on:fillDown={evt => grid.setDownFillAtSelected(evt.detail)}
    on:fillCell={evt => grid.setFillAtSelected(evt.detail.fill)}
    on:previewAcross={evt => grid.setPreviewAcrossAtSelected(evt.detail)}
    on:previewDown={evt => grid.setPreviewDownAtSelected(evt.detail)}
    on:previewCell={evt => grid.setPreviewAtSelected(evt.detail.fill)}
    on:clearPreview={evt => grid.clearPreview()}
  />
</div>

<style>
  #body-wrapper {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-gap: 10px;
  }
</style>
