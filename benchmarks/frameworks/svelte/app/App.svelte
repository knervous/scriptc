<script lang="ts">
  import { buildRows, type Row } from "./rows.svelte.ts";

  let rows: Row[] = $state.raw([]);
  let selected = $state(0);

  function run() { rows = buildRows(1000); selected = 0; }
  function runLots() { rows = buildRows(10000); selected = 0; }
  function add() { rows = rows.concat(buildRows(1000)); }
  function update() {
    for (let i = 0; i < rows.length; i += 10) {
      const r = rows[i]!;
      r.label = r.label + " !!!";
    }
  }
  function clear() { rows = []; selected = 0; }
  function swapRows() {
    if (rows.length <= 998) return;
    const next = rows.slice();
    const t = next[1]!;
    next[1] = next[998]!;
    next[998] = t;
    rows = next;
  }
  function remove(id: number) {
    const at = rows.findIndex((r) => r.id === id);
    if (at < 0) return;
    const next = rows.slice();
    next.splice(at, 1);
    rows = next;
  }
</script>

{#snippet button(id: string, title: string, onclick: () => void)}
  <div class="col-sm-6 smallpad">
    <button type="button" class="btn btn-primary btn-block" {id} {onclick}>{title}</button>
  </div>
{/snippet}

<div class="container">
  <div class="jumbotron">
    <div class="row">
      <div class="col-md-6"><h1>Svelte</h1></div>
      <div class="col-md-6">
        <div class="row">
          {@render button("run", "Create 1,000 rows", run)}
          {@render button("runlots", "Create 10,000 rows", runLots)}
          {@render button("add", "Append 1,000 rows", add)}
          {@render button("update", "Update every 10th row", update)}
          {@render button("clear", "Clear", clear)}
          {@render button("swaprows", "Swap Rows", swapRows)}
        </div>
      </div>
    </div>
  </div>
  <table class="table table-hover table-striped test-data">
    <tbody>
      {#each rows as row (row.id)}
        <tr class={selected === row.id ? "danger" : ""}>
          <td class="col-md-1">{row.id}</td>
          <td class="col-md-4"><a onclick={() => (selected = row.id)}>{row.label}</a></td>
          <td class="col-md-1"><a onclick={() => remove(row.id)}><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
          <td class="col-md-6"></td>
        </tr>
      {/each}
    </tbody>
  </table>
  <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
</div>
