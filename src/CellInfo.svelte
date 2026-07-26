<script>
  import { base } from '$app/paths';
  import { cellFillLen } from './constants';

  export let acrossFills;
  export let downFills;
  export let cellFills;
  export let gridCallbacks;

  const suggestedWordLimit = 100;

  const highlightEntry = ({entry, pivotIdx}) => {
    const wordStart = pivotIdx * cellFillLen;
    const wordEnd = wordStart + cellFillLen;
    const front = entry.word.slice(0, wordStart);
    const pivot = entry.word.slice(wordStart, wordEnd);
    const back = entry.word.slice(wordEnd);
    return `${front}<strong>${pivot}</strong>${back}`;
  };
</script>

<div id="cell-data">
  <div class="section">
    {acrossFills?.length ?? "?"} potential across fills
    {#if acrossFills?.length}
      <div class="section-contents">
        <ol class="word-grid">
          {#each acrossFills.slice(0, suggestedWordLimit) as entry}
            <li>
              <button on:click={() => gridCallbacks.fillAcross({
                  word: entry.entry.word,
                  pivotIdx: entry.pivotIdx,
                })}
                on:mouseover={() => gridCallbacks.previewAcross({
                  word: entry.entry.word,
                  pivotIdx: entry.pivotIdx,
                })}
                on:mouseout={() => gridCallbacks.clearPreview()}
              >
                {@html highlightEntry(entry)}
              </button>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  </div>
  <div class="section">
    {downFills?.length ?? "?"} potential down fills
    {#if downFills?.length}
      <div class="section-contents">
        <ol class="word-grid">
          {#each downFills.slice(0, suggestedWordLimit) as entry}
            <li>
              <button on:click={() => gridCallbacks.fillDown({
                  word: entry.entry.word,
                  pivotIdx: entry.pivotIdx,
                })}
                on:mouseover={() => gridCallbacks.previewDown({
                  word: entry.entry.word,
                  pivotIdx: entry.pivotIdx,
                })}
                on:mouseout={() => gridCallbacks.clearPreview()}
              >
                {@html highlightEntry(entry)}
              </button>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  </div>
  <div class="section">
    {cellFills?.length ?? "?"} potential fills for this cell
    {#if cellFills?.length}
      <div class="section-contents">
        <ol class="letter-grid">
          {#each cellFills as fill}
            <li><button
              on:click={() => gridCallbacks.fillCell({ fill })}
              on:mouseover={() => gridCallbacks.previewCell({ fill })}
              on:mouseout={() => gridCallbacks.clearPreview()}
            >{fill}</button></li>
          {/each}
        </ol>
      </div>
    {/if}
  </div>
</div>

<style>
  #cell-data {
    background-color: lightyellow;
    font-family: Arial;
    padding: 10px 0;
  }

  .section {
    padding: 0 15px;
  }

  .section-contents {
    max-height: 20.5em;
    overflow-y: scroll;
    background-color: #ffe;
    border: solid 1px #cc9;
    margin-top: 3px;
    margin-bottom: 10px;
  }

  ol {
    list-style-type: none;
    padding-left: 15px;
    margin-top: 5px;
    margin-bottom: 5px;
  }

  ol.word-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }

  ol.word-grid > li {
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: 10px;
  }

  ol.letter-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(2em, 1fr));
  }

  button {
    all: unset;
    cursor: pointer;
  }
</style>
