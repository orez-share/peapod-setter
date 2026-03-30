<script>
  import { base } from '$app/paths';
  import CellInfo from './CellInfo.svelte';
  import RegionInfo from './RegionInfo.svelte';
  export let dict;
  export let acrossFills;
  export let downFills;
  export let cellFills;
  export let gridCallbacks;

  let selectedTab = "cell";
</script>

<div>
  {#if dict}
    <div class="tabs">
      <div class="cell tab" on:click={() => selectedTab = "cell"}>Cell</div>
      <div class="region tab" on:click={() => selectedTab = "region"}>Region [Experimental!]</div>
    </div>
    <div class="body">
      <div class:hidden={selectedTab !== "cell"}>
        <CellInfo {downFills} {acrossFills} {cellFills} {gridCallbacks} />
      </div>
      <div class:hidden={selectedTab !== "region"}>
        <RegionInfo {dict} {gridCallbacks}/>
      </div>
    </div>
  {:else}
    <div class="spinner-container">
      <img class="spinner" src="{base}/spinner.gif" alt="loading fill suggestions" />
    </div>
  {/if}
</div>

<style>
  .spinner-container {
    text-align: center;
  }

  img.spinner {
    width: 99px;
    image-rendering: pixelated;
  }

  .hidden {
    display: none;
  }

  .tabs {
    display: flex;
  }

  .tab {
    user-select: none;
    cursor: pointer;
    padding: 10px 20px;
    margin-right: 5px;
    border-bottom: none;
    font-family: Arial;
  }

  .cell {
    background-color: lightyellow;
  }

  .region {
    background-color: lightblue;
  }
</style>
