<script context="module">
  // Cache the definition of settings for each component type
  let SettingsDefinitionCache = {}
  let SettingsDefinitionMapCache = {}

  // Cache the settings of each component ID.
  // This speeds up remounting as well as repeaters.
  let InstanceSettingsCache = {}
</script>

<script>
  import { getContext, setContext } from "svelte"
  import { writable, get } from "svelte/store"
  import * as AppComponents from "components/app"
  import Router from "./Router.svelte"
  import { enrichProps, propsAreSame } from "utils/componentProps"
  import { builderStore } from "stores"
  import { Helpers } from "@budibase/bbui"
  import Manifest from "manifest.json"
  import { getActiveConditions, reduceConditionActions } from "utils/conditions"
  import Placeholder from "components/app/Placeholder.svelte"

  export let instance = {}
  export let isLayout = false
  export let isScreen = false
  export let isBlock = false

  // Get parent contexts
  const context = getContext("context")
  const insideScreenslot = !!getContext("screenslot")

  // Create component context
  const componentStore = writable({})
  setContext("component", componentStore)

  // Ref to the svelte component
  let ref

  // Initial settings are passed in on first render of the component.
  // When the first instance of cachedSettings are set, this object is set to
  // reference cachedSettings, so that mutations to cachedSettings also affect
  // initialSettings, but it does not get caught by svelte invalidation - which
  // would happen if we spread cachedSettings directly to the component.
  let initialSettings

  // Dynamic settings contain bindings and need enriched
  let dynamicSettings

  // Static settings do not contain any bindings and can be passed on down
  let staticSettings

  // The enriched component settings
  let enrichedSettings

  // Any setting overrides that need to be applied due to conditional UI
  let conditionalSettings

  // Resultant cached settings which will be passed to the component instance.
  // These are a combination of the enriched, nested and conditional settings.
  let cachedSettings

  // Latest timestamp that we started a props update.
  // Due to enrichment now being async, we need to avoid overwriting newer
  // settings with old ones, depending on how long enrichment takes.
  let latestUpdateTime

  // Keep track of stringified representations of context and instance
  // to avoid enriching bindings as much as possible
  let lastContextKey
  let lastInstanceKey

  // Visibility flag used by conditional UI
  let visible = true

  // Component information derived during initialisation
  let constructor
  let definition
  let settingsDefinition
  let settingsDefinitionMap

  // Set up initial state for each new component instance
  $: initialise(instance)

  // Extract component instance info
  $: children = instance._children || []
  $: id = instance._id
  $: name = instance._instanceName

  // Determine if the component is selected or is part of the critical path
  // leading to the selected component
  $: selected =
    $builderStore.inBuilder && $builderStore.selectedComponentId === id
  $: inSelectedPath = $builderStore.selectedComponentPath?.includes(id)
  $: inDragPath = inSelectedPath && $builderStore.editMode

  // Derive definition properties which can all be optional, so need to be
  // coerced to booleans
  $: editable = !!definition?.editable
  $: hasChildren = !!definition?.hasChildren
  $: showEmptyState = definition?.showEmptyState !== false

  // Interactive components can be selected, dragged and highlighted inside
  // the builder preview
  $: interactive =
    $builderStore.inBuilder &&
    ($builderStore.previewType === "layout" || insideScreenslot) &&
    !isBlock
  $: editing = editable && selected && $builderStore.editMode
  $: draggable =
    !inDragPath &&
    interactive &&
    !isLayout &&
    !isScreen &&
    definition?.draggable !== false
  $: droppable = interactive && !isLayout && !isScreen

  // Empty components are those which accept children but do not have any.
  // Empty states can be shown for these components, but can be disabled
  // in the component manifest.
  $: empty = interactive && !children.length && hasChildren
  $: emptyState = empty && showEmptyState

  // Enrich component settings
  $: enrichComponentSettings($context, settingsDefinitionMap)

  // Evaluate conditional UI settings and store any component setting changes
  // which need to be made. This is broken into 2 lines to avoid svelte
  // reactivity re-evaluating conditions more often than necessary.
  $: conditions = enrichedSettings?._conditions
  $: evaluateConditions(conditions)

  // Determine and apply settings to the component
  $: applySettings(staticSettings, enrichedSettings, conditionalSettings)

  // Update component context
  $: componentStore.set({
    id,
    children: children.length,
    styles: {
      ...instance._styles,
      id,
      empty: emptyState,
      interactive,
      draggable,
      editable,
    },
    empty: emptyState,
    selected,
    name,
    editing,
  })

  const initialise = instance => {
    if (instance == null) {
      return
    }

    // Ensure we're processing a new instance
    const instanceKey = Helpers.hashString(JSON.stringify(instance))
    if (instanceKey === lastInstanceKey) {
      return
    } else {
      lastInstanceKey = instanceKey
    }

    // Pull definition and constructor
    constructor = getComponentConstructor(instance._component)
    definition = getComponentDefinition(instance._component)
    if (!definition) {
      return
    }

    // Get the settings definition for this component, and cache it
    if (SettingsDefinitionCache[definition.name]) {
      settingsDefinition = SettingsDefinitionCache[definition.name]
      settingsDefinitionMap = SettingsDefinitionMapCache[definition.name]
    } else {
      settingsDefinition = getSettingsDefinition(definition)
      settingsDefinitionMap = getSettingsDefinitionMap(settingsDefinition)
      SettingsDefinitionCache[definition.name] = settingsDefinition
      SettingsDefinitionMapCache[definition.name] = settingsDefinitionMap
    }

    // Parse the instance settings, and cache them
    let instanceSettings
    if (InstanceSettingsCache[instanceKey]) {
      instanceSettings = InstanceSettingsCache[instanceKey]
    } else {
      instanceSettings = getInstanceSettings(instance, settingsDefinition)
      InstanceSettingsCache[instanceKey] = instanceSettings
    }

    // Update the settings types
    staticSettings = instanceSettings.staticSettings
    dynamicSettings = instanceSettings.dynamicSettings

    // Force an initial enrichment of the new settings
    enrichComponentSettings(get(context), settingsDefinitionMap, {
      force: true,
    })
  }

  // Gets the component constructor for the specified component
  const getComponentConstructor = component => {
    const split = component?.split("/")
    const name = split?.[split.length - 1]
    if (name === "screenslot" && $builderStore.previewType !== "layout") {
      return Router
    }
    return AppComponents[name]
  }

  // Gets this component's definition from the manifest
  const getComponentDefinition = component => {
    const prefix = "@budibase/standard-components/"
    const type = component?.replace(prefix, "")
    return type ? Manifest[type] : null
  }

  // Gets the definition of this component's settings from the manifest
  const getSettingsDefinition = definition => {
    if (!definition) {
      return []
    }
    let settings = []
    definition.settings?.forEach(setting => {
      if (setting.section) {
        settings = settings.concat(setting.settings || [])
      } else {
        settings.push(setting)
      }
    })
    return settings
  }

  const getSettingsDefinitionMap = settingsDefinition => {
    let map = {}
    settingsDefinition?.forEach(setting => {
      map[setting.key] = setting
    })
    return map
  }

  const getInstanceSettings = (instance, settingsDefinition) => {
    // Get raw settings
    let settings = {}
    Object.entries(instance)
      .filter(([name]) => name === "_conditions" || !name.startsWith("_"))
      .forEach(([key, value]) => {
        settings[key] = value
      })

    // Derive static, dynamic and nested settings if the instance changed
    let newStaticSettings = { ...settings }
    let newDynamicSettings = { ...settings }
    settingsDefinition?.forEach(setting => {
      if (setting.nested) {
        delete newDynamicSettings[setting.key]
      } else {
        const value = settings[setting.key]
        if (value == null) {
          delete newDynamicSettings[setting.key]
        } else if (typeof value === "string" && value.includes("{{")) {
          // Strings can be trivially checked
          delete newStaticSettings[setting.key]
        } else if (setting.type === "event") {
          // Always treat button actions as dynamic
          delete newStaticSettings[setting.key]
        } else if (typeof value === "object") {
          // Stringify and check objects
          const stringified = JSON.stringify(value)
          if (stringified.includes("{{")) {
            delete newStaticSettings[setting.key]
          } else {
            delete newDynamicSettings[setting.key]
          }
        } else {
          // For other types, we can safely assume they are static
          delete newDynamicSettings[setting.key]
        }
      }
    })

    return {
      staticSettings: newStaticSettings,
      dynamicSettings: newDynamicSettings,
    }
  }

  // Enriches any string component props using handlebars
  const enrichComponentSettings = (
    context,
    settingsDefinitionMap,
    options = { force: false }
  ) => {
    const contextChanged = context.key !== lastContextKey
    if (!contextChanged && !options?.force) {
      return
    }
    lastContextKey = context.key

    // Record the timestamp so we can reference it after enrichment
    latestUpdateTime = Date.now()
    const enrichmentTime = latestUpdateTime

    // Enrich settings with context
    const newEnrichedSettings = enrichProps(
      dynamicSettings,
      context,
      settingsDefinitionMap
    )

    // Abandon this update if a newer update has started
    if (enrichmentTime !== latestUpdateTime) {
      return
    }

    enrichedSettings = newEnrichedSettings
  }

  // Evaluates the list of conditional UI conditions and determines any setting
  // or visibility changes required
  const evaluateConditions = conditions => {
    if (!conditions?.length) {
      return
    }

    // Default visible to false if there is a show condition
    let nextVisible = !conditions.find(condition => condition.action === "show")

    // Execute conditions and determine settings and visibility changes
    const activeConditions = getActiveConditions(conditions)
    const result = reduceConditionActions(activeConditions)
    if (result.visible != null) {
      nextVisible = result.visible
    }

    // Update state from condition results
    conditionalSettings = result.settingUpdates
    visible = nextVisible
  }

  // Combines and caches all settings which will be passed to the component
  // instance. Settings are aggressively memoized to avoid triggering svelte
  // reactive statements as much as possible.
  const applySettings = (
    staticSettings,
    enrichedSettings,
    conditionalSettings
  ) => {
    const allSettings = {
      ...staticSettings,
      ...enrichedSettings,
      ...conditionalSettings,
    }
    if (!cachedSettings) {
      cachedSettings = { ...allSettings }
      initialSettings = cachedSettings
    } else {
      Object.keys(allSettings).forEach(key => {
        const same = propsAreSame(allSettings[key], cachedSettings[key])
        if (!same) {
          // Updated cachedSettings (which is assigned by reference to
          // initialSettings) so that if we remount the component then the
          // initial props are up to date. By setting it this way rather than
          // setting it on initialSettings directly, we avoid a double render.
          cachedSettings[key] = allSettings[key]

          if (ref?.$$set) {
            // Programmatically set the prop to avoid svelte reactive statements
            // firing inside components. This circumvents the problems caused by
            // spreading a props object.
            ref.$$set({ [key]: allSettings[key] })
          } else {
            // Sometimes enrichment can occur multiple times before the
            // component has mounted and been assigned a ref.
            // In these cases, for some reason we need to update the
            // initial settings object, even though it is equivalent by
            // reference to cached settings. This solves the problem of multiple
            // initial enrichments, while also not causing wasted renders for
            // any components not affected by this issue.
            initialSettings[key] = allSettings[key]
          }
        }
      })
    }
  }
</script>

{#if constructor && initialSettings && (visible || inSelectedPath)}
  <!-- The ID is used as a class because getElementsByClassName is O(1) -->
  <!-- and the performance matters for the selection indicators -->
  <div
    class={`component ${id}`}
    class:draggable
    class:droppable
    class:empty
    class:interactive
    class:editing
    class:block={isBlock}
    data-id={id}
    data-name={name}
  >
    <svelte:component this={constructor} bind:this={ref} {...initialSettings}>
      {#if children.length}
        {#each children as child (child._id)}
          <svelte:self instance={child} />
        {/each}
      {:else if emptyState}
        <Placeholder />
      {:else if isBlock}
        <slot />
      {/if}
    </svelte:component>
  </div>
{/if}

<style>
  .component {
    display: contents;
  }
  .interactive :global(*:hover) {
    cursor: pointer;
  }
  .draggable :global(*:hover) {
    cursor: grab;
  }
  .editing :global(*:hover) {
    cursor: auto;
  }
</style>
