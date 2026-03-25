<script>
  import { onMount } from 'svelte';
  import Grid from '../Grid.svelte';
  import Suggestions from '../Suggestions.svelte';
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

  const gridCallbacks = {
    fillAcross: (evt => grid.setAcrossFillAtSelected(evt)),
    fillDown: (evt => grid.setDownFillAtSelected(evt)),
    fillCell: (evt => grid.setFillAtSelected(evt.fill)),
    previewAcross: (evt => grid.setPreviewAcrossAtSelected(evt)),
    previewDown: (evt => grid.setPreviewDownAtSelected(evt)),
    previewCell: (evt => grid.setPreviewAtSelected(evt.fill)),
    clearPreview: (evt => grid.clearPreview()),
    getSelectedRegion: (() => grid.getSelectedRegion()),
    setPreviewFromSubgrid: ((sub, offset) => grid.setPreviewFromSubgrid(sub, offset)),
    setFillFromSubgrid: ((sub, offset) => grid.setFillFromSubgrid(sub, offset)),
  };
</script>

<svelte:head>
  <title>🫛 Peapod Crossword Setter</title>
</svelte:head>

<div id="body-wrapper">
  <Grid bind:this={grid} on:update={generateCellOptions} {cellFillLen} />
  <Suggestions {dict} {downFills} {acrossFills} {cellFills} {cellFillLen} {gridCallbacks} />
</div>

<style>
  #body-wrapper {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-gap: 10px;
  }
</style>
