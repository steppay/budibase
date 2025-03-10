<script>
  import { createEventDispatcher } from "svelte"
  import "@spectrum-css/table/dist/index-vars.css"
  import CellRenderer from "./CellRenderer.svelte"
  import SelectEditRenderer from "./SelectEditRenderer.svelte"
  import { cloneDeep, deepGet } from "../helpers"
  import ProgressCircle from "../ProgressCircle/ProgressCircle.svelte"
  import Checkbox from "../Form/Checkbox.svelte"

  /**
   * The expected schema is our normal couch schemas for our tables.
   * Each field schema can be enriched with a few extra properties to customise
   * the behaviour.
   * All of these are optional and do not need to be added.
   * displayName: Overrides the field name displayed as the column title
   * sortable: Set to false to disable sorting data by a certain column
   * editable: Set to false to disable editing a certain column if the
   *  allowEditColumns prop is true
   * width: the width of the column
   * align: the alignment of the column
   * template: a HBS or JS binding to use as the value
   * background: the background color
   * color: the text color
   */
  export let data = []
  export let schema = {}
  export let showAutoColumns = false
  export let rowCount = 0
  export let quiet = false
  export let loading = false
  export let allowSelectRows = true
  export let allowEditRows = true
  export let allowEditColumns = true
  export let selectedRows = []
  export let customRenderers = []
  export let disableSorting = false
  export let autoSortColumns = true
  export let compact = false

  const dispatch = createEventDispatcher()

  // Config
  const headerHeight = 36
  $: rowHeight = compact ? 46 : 55

  // Sorting state
  let sortColumn
  let sortOrder

  // Table state
  let height = 0
  let loaded = false
  let checkboxStatus = false

  $: schema = fixSchema(schema)
  $: if (!loading) loaded = true
  $: fields = getFields(schema, showAutoColumns, autoSortColumns)
  $: rows = fields?.length ? data || [] : []
  $: totalRowCount = rows?.length || 0
  $: visibleRowCount = getVisibleRowCount(
    loaded,
    height,
    rows.length,
    rowCount,
    rowHeight
  )
  $: heightStyle = getHeightStyle(
    visibleRowCount,
    rowCount,
    totalRowCount,
    rowHeight
  )
  $: sortedRows = sortRows(rows, sortColumn, sortOrder)
  $: gridStyle = getGridStyle(fields, schema, showEditColumn)
  $: showEditColumn = allowEditRows || allowSelectRows
  $: cellStyles = computeCellStyles(schema)

  // Deselect the "select all" checkbox when the user navigates to a new page
  $: {
    let checkRowCount = rows.filter(o1 =>
      selectedRows.some(o2 => o1._id === o2._id)
    )
    if (checkRowCount.length === 0) {
      checkboxStatus = false
    }
  }

  const fixSchema = schema => {
    let fixedSchema = {}
    Object.entries(schema || {}).forEach(([fieldName, fieldSchema]) => {
      if (typeof fieldSchema === "string") {
        fixedSchema[fieldName] = {
          type: fieldSchema,
          name: fieldName,
        }
      } else {
        fixedSchema[fieldName] = {
          ...fieldSchema,
          name: fieldName,
        }
      }
    })
    return fixedSchema
  }

  const getVisibleRowCount = (loaded, height, allRows, rowCount, rowHeight) => {
    if (!loaded) {
      return rowCount || 0
    }
    if (rowCount) {
      return Math.min(allRows, rowCount)
    }
    return Math.min(allRows, Math.ceil(height / rowHeight))
  }

  const getHeightStyle = (
    visibleRowCount,
    rowCount,
    totalRowCount,
    rowHeight
  ) => {
    if (!rowCount || !visibleRowCount || totalRowCount <= rowCount) {
      return ""
    }
    return `height: ${headerHeight + visibleRowCount * rowHeight}px;`
  }

  const getGridStyle = (fields, schema, showEditColumn) => {
    let style = "grid-template-columns:"
    if (showEditColumn) {
      style += " auto"
    }
    fields?.forEach(field => {
      const fieldSchema = schema[field]
      if (fieldSchema.width) {
        style += ` ${fieldSchema.width}`
      } else {
        style += " minmax(auto, 1fr)"
      }
    })
    style += ";"
    return style
  }

  const sortRows = (rows, sortColumn, sortOrder) => {
    if (!sortColumn || !sortOrder || disableSorting) {
      return rows
    }
    return rows.slice().sort((a, b) => {
      const colA = a[sortColumn]
      const colB = b[sortColumn]
      if (sortOrder === "Descending") {
        return colA > colB ? -1 : 1
      } else {
        return colA > colB ? 1 : -1
      }
    })
  }

  const sortBy = fieldSchema => {
    if (fieldSchema.sortable === false) {
      return
    }
    if (fieldSchema.name === sortColumn) {
      sortOrder = sortOrder === "Descending" ? "Ascending" : "Descending"
    } else {
      sortColumn = fieldSchema.name
      sortOrder = "Descending"
    }
    dispatch("sort", { column: sortColumn, order: sortOrder })
  }

  const getDisplayName = schema => {
    let name = schema?.displayName
    if (schema && name === undefined) {
      name = schema.name
    }
    return name || ""
  }

  const getFields = (schema, showAutoColumns, autoSortColumns) => {
    let columns = []
    let autoColumns = []
    Object.entries(schema || {}).forEach(([field, fieldSchema]) => {
      if (!field || !fieldSchema) {
        return
      }
      if (!autoSortColumns || !fieldSchema?.autocolumn) {
        columns.push(fieldSchema)
      } else if (showAutoColumns) {
        autoColumns.push(fieldSchema)
      }
    })
    return columns
      .sort((a, b) => {
        const orderA = a.order || Number.MAX_SAFE_INTEGER
        const orderB = b.order || Number.MAX_SAFE_INTEGER
        const nameA = getDisplayName(a)
        const nameB = getDisplayName(b)
        if (orderA !== orderB) {
          return orderA < orderB ? orderA : orderB
        }
        return nameA < nameB ? a : b
      })
      .concat(autoColumns)
      .map(column => column.name)
  }

  const editColumn = (e, field) => {
    e.stopPropagation()
    dispatch("editcolumn", field)
  }

  const editRow = (e, row) => {
    e.stopPropagation()
    dispatch("editrow", cloneDeep(row))
  }

  const toggleSelectRow = row => {
    if (!allowSelectRows) {
      return
    }
    if (selectedRows.some(selectedRow => selectedRow._id === row._id)) {
      selectedRows = selectedRows.filter(
        selectedRow => selectedRow._id !== row._id
      )
    } else {
      selectedRows = [...selectedRows, row]
    }
  }

  const toggleSelectAll = e => {
    const select = !!e.detail
    if (select) {
      // Add any rows which are not already in selected rows
      rows.forEach(row => {
        if (selectedRows.findIndex(x => x._id === row._id) === -1) {
          selectedRows.push(row)
        }
      })
    } else {
      // Remove any rows from selected rows that are in the current data set
      selectedRows = selectedRows.filter(el =>
        rows.every(f => f._id !== el._id)
      )
    }
  }

  const computeCellStyles = schema => {
    let styles = {}
    Object.keys(schema || {}).forEach(field => {
      styles[field] = ""
      if (schema[field].color) {
        styles[field] += `color: ${schema[field].color};`
      }
      if (schema[field].background) {
        styles[field] += `background-color: ${schema[field].background};`
      }
      if (schema[field].align === "Center") {
        styles[field] += "justify-content: center; text-align: center;"
      }
      if (schema[field].align === "Right") {
        styles[field] += "justify-content: flex-end; text-align: right;"
      }
    })
    return styles
  }
</script>

<div
  class="wrapper"
  class:wrapper--quiet={quiet}
  class:wrapper--compact={compact}
  bind:offsetHeight={height}
  style={`--row-height: ${rowHeight}px; --header-height: ${headerHeight}px;`}
>
  {#if !loaded}
    <div class="loading" style={heightStyle}>
      <ProgressCircle />
    </div>
  {:else}
    <div class="spectrum-Table" style={`${heightStyle}${gridStyle}`}>
      {#if fields.length}
        <div class="spectrum-Table-head">
          {#if showEditColumn}
            <div
              class="spectrum-Table-headCell spectrum-Table-headCell--divider spectrum-Table-headCell--edit"
            >
              {#if allowSelectRows}
                <Checkbox
                  bind:value={checkboxStatus}
                  on:change={toggleSelectAll}
                />
              {:else}
                Edit
              {/if}
            </div>
          {/if}
          {#each fields as field}
            <div
              class="spectrum-Table-headCell"
              class:spectrum-Table-headCell--alignCenter={schema[field]
                .align === "Center"}
              class:spectrum-Table-headCell--alignRight={schema[field].align ===
                "Right"}
              class:is-sortable={schema[field].sortable !== false}
              class:is-sorted-desc={sortColumn === field &&
                sortOrder === "Descending"}
              class:is-sorted-asc={sortColumn === field &&
                sortOrder === "Ascending"}
              on:click={() => sortBy(schema[field])}
            >
              <div class="title">{getDisplayName(schema[field])}</div>
              {#if schema[field]?.autocolumn}
                <svg
                  class="spectrum-Icon spectrum-Table-autoIcon"
                  focusable="false"
                >
                  <use xlink:href="#spectrum-icon-18-MagicWand" />
                </svg>
              {/if}
              {#if sortColumn === field}
                <svg
                  class="spectrum-Icon spectrum-UIIcon-ArrowDown100 spectrum-Table-sortedIcon"
                  focusable="false"
                  aria-hidden="true"
                >
                  <use xlink:href="#spectrum-css-icon-Arrow100" />
                </svg>
              {/if}
              {#if allowEditColumns && schema[field]?.editable !== false}
                <svg
                  class="spectrum-Icon spectrum-Table-editIcon"
                  focusable="false"
                  on:click={e => editColumn(e, field)}
                >
                  <use xlink:href="#spectrum-icon-18-Edit" />
                </svg>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if sortedRows?.length}
        {#each sortedRows as row, idx}
          <div
            class="spectrum-Table-row"
            on:click={() => dispatch("click", row)}
            on:click={() => toggleSelectRow(row)}
          >
            {#if showEditColumn}
              <div
                class="spectrum-Table-cell spectrum-Table-cell--divider spectrum-Table-cell--edit"
                on:click={e => {
                  toggleSelectRow(row)
                  e.stopPropagation()
                }}
              >
                <SelectEditRenderer
                  data={row}
                  selected={selectedRows.findIndex(
                    selectedRow => selectedRow._id === row._id
                  ) !== -1}
                  onEdit={e => editRow(e, row)}
                  {allowSelectRows}
                  {allowEditRows}
                />
              </div>
            {/if}
            {#each fields as field}
              <div
                class="spectrum-Table-cell"
                class:spectrum-Table-cell--divider={!!schema[field].divider}
                style={cellStyles[field]}
              >
                <CellRenderer
                  {customRenderers}
                  {row}
                  schema={schema[field]}
                  value={deepGet(row, field)}
                  on:clickrelationship
                >
                  <slot />
                </CellRenderer>
              </div>
            {/each}
          </div>
        {/each}
      {:else}
        <div class="placeholder" class:placeholder--no-fields={!fields?.length}>
          <div class="placeholder-content">
            <svg class="spectrum-Icon spectrum-Icon--sizeXXL" focusable="false">
              <use xlink:href="#spectrum-icon-18-Table" />
            </svg>
            <div>No rows found</div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Wrapper */
  .wrapper {
    position: relative;
    z-index: 0;
    --table-bg: var(--spectrum-global-color-gray-50);
    --table-border: 1px solid var(--spectrum-alias-border-color-mid);
    --cell-padding: var(--spectrum-global-dimension-size-250);
  }
  .wrapper--quiet {
    --table-bg: var(--spectrum-alias-background-color-transparent);
  }
  .wrapper--compact {
    --cell-padding: var(--spectrum-global-dimension-size-150);
  }

  /* Loading */
  .loading {
    display: grid;
    place-items: center;
    min-height: 100px;
  }

  /* Table */
  .spectrum-Table {
    width: 100%;
    border-radius: 0;
    display: grid;
    overflow: auto;
  }

  /* Header */
  .spectrum-Table-head {
    display: contents;
  }
  .spectrum-Table-head > :first-child {
    border-left: 1px solid transparent;
    padding-left: var(--cell-padding);
  }
  .spectrum-Table-head > :last-child {
    border-right: 1px solid transparent;
    padding-right: var(--cell-padding);
  }
  .spectrum-Table-headCell {
    height: var(--header-height);
    position: sticky;
    top: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    background-color: var(--spectrum-alias-background-color-secondary);
    z-index: 2;
    border-bottom: var(--table-border);
    padding: 0 calc(var(--cell-padding) / 1.33);
    display: flex;
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    user-select: none;
  }
  .spectrum-Table-headCell--alignCenter {
    justify-content: center;
  }
  .spectrum-Table-headCell--alignRight {
    justify-content: flex-end;
  }
  .spectrum-Table-headCell--divider {
    padding-right: var(--cell-padding);
  }
  .spectrum-Table-headCell--divider + .spectrum-Table-headCell {
    padding-left: var(--cell-padding);
  }
  .spectrum-Table-headCell--edit {
    position: sticky;
    left: 0;
    z-index: 3;
  }
  .spectrum-Table-headCell .title {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spectrum-Table-headCell:hover .spectrum-Table-editIcon {
    opacity: 1;
    transition: opacity 0.2s ease;
  }
  .spectrum-Table-headCell .spectrum-Icon {
    pointer-events: all;
    margin-left: var(
      --spectrum-table-header-sort-icon-gap,
      var(--spectrum-global-dimension-size-125)
    );
  }
  .spectrum-Table-editIcon,
  .spectrum-Table-autoIcon {
    width: var(--spectrum-global-dimension-size-150);
    height: var(--spectrum-global-dimension-size-150);
  }
  .spectrum-Table-editIcon {
    opacity: 0;
  }

  /* Table rows */
  .spectrum-Table-row {
    display: contents;
  }
  .spectrum-Table-row:hover .spectrum-Table-cell {
    /*background-color: var(--hover-bg) !important;*/
  }
  .spectrum-Table-row:hover .spectrum-Table-cell:after {
    background-color: var(--spectrum-alias-highlight-hover);
  }
  .wrapper--quiet .spectrum-Table-row {
    border-left: none;
    border-right: none;
  }
  .spectrum-Table-row > :first-child {
    border-left: var(--table-border);
    padding-left: var(--cell-padding);
  }
  .spectrum-Table-row > :last-child {
    border-right: var(--table-border);
    padding-right: var(--cell-padding);
  }

  /* Table cells */
  .spectrum-Table-cell {
    flex: 1 1 auto;
    padding: 0 calc(var(--cell-padding) / 1.33);
    border-top: none;
    border-bottom: none;
    border-radius: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    height: var(--row-height);
    display: flex;
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    gap: 4px;
    border-bottom: 1px solid var(--spectrum-alias-border-color-mid);
    background-color: var(--table-bg);
    z-index: 1;
  }
  .spectrum-Table-cell--divider {
    padding-right: var(--cell-padding);
  }
  .spectrum-Table-cell--divider + .spectrum-Table-cell {
    padding-left: var(--cell-padding);
  }
  .spectrum-Table-cell--edit {
    position: sticky;
    left: 0;
    z-index: 2;
  }
  .spectrum-Table-cell:after {
    content: "";
    position: absolute;
    width: 100%;
    height: 100%;
    background-color: transparent;
    top: 0;
    left: 0;
    pointer-events: none;
    transition: background-color
      var(--spectrum-global-animation-duration-100, 0.13s) ease-in-out;
  }

  /* Placeholder  */
  .placeholder {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    border: var(--table-border);
    border-top: none;
    grid-column: 1 / -1;
    background-color: var(--table-bg);
  }
  .placeholder--no-fields {
    border-top: var(--table-border);
  }
  .wrapper--quiet .placeholder {
    border-left: none;
    border-right: none;
  }
  .placeholder-content {
    padding: 40px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: var(
      --spectrum-table-cell-text-color,
      var(--spectrum-alias-text-color)
    );
  }
  .placeholder-content div {
    margin-top: 10px;
    font-size: var(
      --spectrum-table-cell-text-size,
      var(--spectrum-alias-font-size-default)
    );
    text-align: center;
  }
</style>
