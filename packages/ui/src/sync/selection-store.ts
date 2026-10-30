/**
 * Selection Store — per-session model, agent, and variant selections.
 * Extracted from session-ui-store for subscription isolation.
 */

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { z } from "zod"
import { createDeferredSafeJSONStorage } from "@/stores/utils/safeStorage"
import { getRuntimeKey } from "@/lib/runtime-switch"

type ModelSelection = { providerId: string; modelId: string }
type LastUsedProvider = { providerID: string; modelID: string }
type VariantSelections = Map<string, Map<string, Map<string, string | null>>>
const variantEntriesSchema = z.array(z.tuple([
  z.string(), z.array(z.tuple([
    z.string(), z.array(z.tuple([z.string(), z.string().nullable()])),
  ])),
]))
const modelSelectionSchema = z.object({ providerId: z.string(), modelId: z.string() })
const persistedSelectionSchema = z.object({
  sessionModelSelections: z.array(z.tuple([z.string(), modelSelectionSchema])).optional().catch(undefined),
  sessionAgentSelections: z.array(z.tuple([z.string(), z.string()])).optional().catch(undefined),
  sessionFollowedAgents: z.array(z.tuple([z.string(), z.string()])).optional().catch(undefined),
  sessionFollowedModels: z.array(z.tuple([z.string(), z.string()])).optional().catch(undefined),
  sessionAgentModelSelections: z.array(z.tuple([
    z.string(), z.array(z.tuple([z.string(), modelSelectionSchema])),
  ])).optional().catch(undefined),
  agentModelVariantSelections: variantEntriesSchema.optional().catch(undefined),
  lastUsedProvider: z.object({ providerID: z.string(), modelID: z.string() }).nullable().optional().catch(undefined),
})

/**
 * What a refusal found.
 *
 * `owned: false` — a newer pick had already taken the marker over (or the
 * marker was gone): the caller must leave both the selection and the composer
 * alone, because the choice on screen is the user's latest one.
 *
 * `owned: true` — this request's pick was the one refused. `fallback` is the
 * agent to go back to (the one the record last accepted, else the one the
 * composer showed before the pick), or null when nothing is known, in which
 * case the selection entry has been dropped and consumers fall back to the
 * record.
 */
export type RefusedPick = { owned: boolean; fallback: string | null }

type SelectionState = {
  sessionModelSelections: Map<string, ModelSelection>
  sessionAgentSelections: Map<string, string>
  /** The agent OpenCode's session record held when the composer last followed it. */
  sessionFollowedAgents: Map<string, string>
  /** The model (`provider/model#variant`) the session record held when the composer last reconciled with it. */
  sessionFollowedModels: Map<string, string>
  /**
   * The pick in flight, and when it started. The record echoes back a moment
   * later; until it does it still names the previous agent, which must not be
   * read as somebody else switching the session. The time is what keeps a lost
   * echo from silencing the session for good: after `PENDING_SWITCH_TTL_MS`
   * the marker stops holding the composer back and the record wins again. Not
   * persisted: a pick in flight does not outlive a reload.
   */
  pendingAgentSwitches: Map<string, { agent: string; at: number; token: number; previous: string | null }>
  /**
   * The agent the record last accepted for the session. A refusal puts the
   * composer back on this, not on the last followed read: a record echo that
   * arrived while a newer pick was in flight is dropped, so the read can be
   * behind the record. Not persisted: it is a cache of the record, not state.
   */
  landedAgentSwitches: Map<string, string>
  sessionAgentModelSelections: Map<string, Map<string, ModelSelection>>
  agentModelVariantSelections: VariantSelections
  lastUsedProvider: LastUsedProvider | null

  saveSessionModelSelection: (sessionId: string, providerId: string, modelId: string) => void
  getSessionModelSelection: (sessionId: string) => { providerId: string; modelId: string } | null
  saveSessionAgentSelection: (sessionId: string, agentName: string) => void
  getSessionAgentSelection: (sessionId: string) => string | null
  /**
   * Selects `agentName` for the session and marks the pick as travelling to
   * the session record. Call before the switch request, so a record echo that
   * arrives mid-flight cannot undo the pick.
   */
  beginAgentSwitch: (sessionId: string, agentName: string) => number
  /**
   * Undoes a pick the record refused. Drops its marker and selects the agent
   * the session last reconciled to, so the composer shows the agent the
   * session actually runs on rather than the one it never took.
   *
   * Returns that agent, or null when there is nothing to go back to: no write
   * has landed and no record value was followed yet (the selection entry is
   * then dropped, so consumers fall back to the record), or a newer pick has
   * taken the marker over and this failure belongs to a request it superseded.
   */
  refuseAgentSwitch: (sessionId: string, agentName: string, token?: number) => RefusedPick
  /** Notes the agent the record accepted, so a later refusal can restore it. */
  markAgentSwitchLanded: (sessionId: string, agentName: string) => void
  /**
   * Reconciles the composer with the agent on OpenCode's session record.
   * Returns true, and selects `agent` for the session, only when the record
   * holds a different agent than the one last followed (or none was followed
   * yet): the session switched since the composer last looked, so that newer
   * switch wins. An unchanged record returns false and leaves a picker choice
   * made after it in place.
   */
  followSessionAgent: (sessionId: string, agent: string) => boolean
  /**
   * Whether the session record's model differs from the one last reconciled:
   * a switch made since (another client, a plugin) that outranks a model
   * picked here. With nothing reconciled yet there is no evidence of a switch,
   * so a pick that disagrees with the record keeps winning, as before.
   */
  isSessionModelSwitched: (sessionId: string, model: string) => boolean
  markSessionModelFollowed: (sessionId: string, model: string) => void
  saveAgentModelForSession: (sessionId: string, agentName: string, providerId: string, modelId: string) => void
  getAgentModelForSession: (sessionId: string, agentName: string) => { providerId: string; modelId: string } | null
  clearSessionSelections: (sessionId: string) => void
  /**
   * `variant` is the effort chosen for this agent/model in this session:
   * a name, `null` for an explicit "Default" (send no effort), or `undefined`
   * to forget the choice so the inherited default applies again.
   */
  saveAgentModelVariantForSession: (sessionId: string, agentName: string, providerId: string, modelId: string, variant: string | null | undefined) => void
  getAgentModelVariantForSession: (sessionId: string, agentName: string, providerId: string, modelId: string) => string | null | undefined
}

// Maximum number of sessions to persist to local storage to prevent unbounded growth
const MAX_PERSISTED_SESSIONS = 150
// How long a pick may hold the composer back while the record catches up. Long
// enough for a round trip and the echo after it, short enough that a lost echo
// does not leave the session on an agent nobody chose.
const PENDING_SWITCH_TTL_MS = 10_000
// Distinguishes two requests for the same agent, so an older one failing does
// not roll back the pick that replaced it.
let nextSwitchToken = 1
const variantSessionKey = (sessionId: string) => JSON.stringify([getRuntimeKey(), sessionId])

export const useSelectionStore = create<SelectionState>()(
  persist(
    (set, get) => ({
      sessionModelSelections: new Map(),
      sessionAgentSelections: new Map(),
      sessionFollowedAgents: new Map(),
      sessionFollowedModels: new Map(),
      pendingAgentSwitches: new Map(),
      landedAgentSwitches: new Map(),
      sessionAgentModelSelections: new Map(),
      agentModelVariantSelections: new Map(),
      lastUsedProvider: null,

      saveSessionModelSelection: (sessionId, providerId, modelId) =>
        set((s) => {
          const map = new Map(s.sessionModelSelections)
          map.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          map.set(sessionId, { providerId, modelId })
          return { sessionModelSelections: map, lastUsedProvider: { providerID: providerId, modelID: modelId } }
        }),

      getSessionModelSelection: (sessionId) => get().sessionModelSelections.get(sessionId) ?? null,

      saveSessionAgentSelection: (sessionId, agentName) =>
        set((s) => {
          if (s.sessionAgentSelections.get(sessionId) === agentName) return s
          const map = new Map(s.sessionAgentSelections)
          map.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          map.set(sessionId, agentName)
          return { sessionAgentSelections: map }
        }),

      getSessionAgentSelection: (sessionId) => get().sessionAgentSelections.get(sessionId) ?? null,

      followSessionAgent: (sessionId, agent) => {
        const inFlight = get().pendingAgentSwitches.get(sessionId)
        if (inFlight !== undefined && Date.now() - inFlight.at > PENDING_SWITCH_TTL_MS) {
          // The record never echoed the pick — a dropped subscription, a
          // switch away before it landed. Holding the composer back any
          // longer would swallow real switches, so the marker goes.
          set((s) => {
            const stale = new Map(s.pendingAgentSwitches)
            stale.delete(sessionId)
            return { pendingAgentSwitches: stale }
          })
        } else if (inFlight !== undefined) {
          const pending = inFlight.agent
          // A pick is on its way to the record. An echo naming the same agent
          // means it landed, so the marker goes and there is nothing to
          // follow; any other agent is the record lagging behind the pick,
          // which must not overwrite it.
          if (pending !== agent) return false
          set((s) => {
            const pendingSwitches = new Map(s.pendingAgentSwitches)
            pendingSwitches.delete(sessionId)
            const followed = new Map(s.sessionFollowedAgents)
            followed.delete(sessionId)
            followed.set(sessionId, agent)
            const landed = new Map(s.landedAgentSwitches)
            landed.delete(sessionId)
            landed.set(sessionId, agent)
            return { pendingAgentSwitches: pendingSwitches, sessionFollowedAgents: followed, landedAgentSwitches: landed }
          })
          return false
        }
        if (get().sessionFollowedAgents.get(sessionId) === agent) return false
        set((s) => {
          const followed = new Map(s.sessionFollowedAgents)
          followed.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          followed.set(sessionId, agent)
          const selections = new Map(s.sessionAgentSelections)
          selections.delete(sessionId)
          selections.set(sessionId, agent)
          // The record now runs on `agent`, whatever a pick wrote earlier.
          const landed = new Map(s.landedAgentSwitches)
          landed.delete(sessionId)
          landed.set(sessionId, agent)
          return { sessionFollowedAgents: followed, sessionAgentSelections: selections, landedAgentSwitches: landed }
        })
        return true
      },

      beginAgentSwitch: (sessionId, agentName) => {
        // What the composer showed before this pick: the agent to go back to
        // when the record's own agent is not known yet. Read before the pick
        // overwrites the entry.
        const previous = get().sessionAgentSelections.get(sessionId) ?? null
        get().saveSessionAgentSelection(sessionId, agentName)
        // Names this request, not just this agent: two picks for the same
        // agent are two requests, and the first one failing must not undo the
        // second.
        const token = nextSwitchToken++
        set((s) => {
          const pendingSwitches = new Map(s.pendingAgentSwitches)
          pendingSwitches.delete(sessionId)
          pendingSwitches.set(sessionId, { agent: agentName, at: Date.now(), token, previous })
          return { pendingAgentSwitches: pendingSwitches }
        })
        return token
      },

      refuseAgentSwitch: (sessionId, agentName, token) => {
        const state = get()
        const marker = state.pendingAgentSwitches.get(sessionId)
        // The marker names the newest pick in flight. When it names another
        // request, this refusal belongs to one that pick has superseded: it
        // must not touch the newer choice or the composer showing it.
        if (marker === undefined || marker.agent !== agentName) return { owned: false, fallback: null }
        if (token !== undefined && marker.token !== token) return { owned: false, fallback: null }
        // What the record last accepted outranks what the composer last read:
        // an echo that arrived while a newer pick was in flight is dropped, so
        // the read can name an agent the record has already left.
        const fallback = state.landedAgentSwitches.get(sessionId)
            ?? state.sessionFollowedAgents.get(sessionId)
            ?? marker.previous
            ?? null
        set((s) => {
          const pendingSwitches = new Map(s.pendingAgentSwitches)
          pendingSwitches.delete(sessionId)
          // Pinned columns and the side panel read this map, so the pick has to
          // go back here; the app-wide composer is the caller's business.
          const selections = new Map(s.sessionAgentSelections)
          if (fallback === null) {
            // Nothing is known to be running: dropping the entry lets those
            // consumers fall back to the record instead of keeping the agent
            // it just refused. No echo will ever rewrite it.
            selections.delete(sessionId)
            return { pendingAgentSwitches: pendingSwitches, sessionAgentSelections: selections }
          }
          selections.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          selections.set(sessionId, fallback)
          return { pendingAgentSwitches: pendingSwitches, sessionAgentSelections: selections }
        })
        return { owned: true, fallback }
      },

      markAgentSwitchLanded: (sessionId, agentName) => set((s) => {
        if (s.landedAgentSwitches.get(sessionId) === agentName) return s
        const landed = new Map(s.landedAgentSwitches)
        landed.delete(sessionId)
        landed.set(sessionId, agentName)
        return { landedAgentSwitches: landed }
      }),

      isSessionModelSwitched: (sessionId, model) => {
        const followed = get().sessionFollowedModels.get(sessionId)
        return followed !== undefined && followed !== model
      },

      markSessionModelFollowed: (sessionId, model) => set((s) => {
        if (s.sessionFollowedModels.get(sessionId) === model) return s
        const followed = new Map(s.sessionFollowedModels)
        followed.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
        followed.set(sessionId, model)
        return { sessionFollowedModels: followed }
      }),

      saveAgentModelForSession: (sessionId, agentName, providerId, modelId) =>
        set((s) => {
          const existing = s.sessionAgentModelSelections.get(sessionId)?.get(agentName)
          if (existing?.providerId === providerId && existing?.modelId === modelId) return s
          const outer = new Map(s.sessionAgentModelSelections)
          const inner = new Map(outer.get(sessionId) ?? new Map())

          outer.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          inner.set(agentName, { providerId, modelId })
          outer.set(sessionId, inner)

          return { sessionAgentModelSelections: outer }
        }),

      getAgentModelForSession: (sessionId, agentName) =>
        get().sessionAgentModelSelections.get(sessionId)?.get(agentName) ?? null,

      clearSessionSelections: (sessionId) => set((state) => {
        const variantKey = variantSessionKey(sessionId)
        const hadVariant = state.agentModelVariantSelections.has(variantKey)
        if (!hadVariant && !state.sessionModelSelections.has(sessionId)
          && !state.sessionAgentSelections.has(sessionId)
          && !state.sessionFollowedAgents.has(sessionId)
          && !state.sessionFollowedModels.has(sessionId)
          && !state.sessionAgentModelSelections.has(sessionId)
          && !state.landedAgentSwitches.has(sessionId)
          && !state.pendingAgentSwitches.has(sessionId)) return state
        const sessionModelSelections = new Map(state.sessionModelSelections)
        const sessionAgentSelections = new Map(state.sessionAgentSelections)
        const sessionFollowedAgents = new Map(state.sessionFollowedAgents)
        const sessionFollowedModels = new Map(state.sessionFollowedModels)
        const sessionAgentModelSelections = new Map(state.sessionAgentModelSelections)
        const landedAgentSwitches = new Map(state.landedAgentSwitches)
        const pendingAgentSwitches = new Map(state.pendingAgentSwitches)
        const agentModelVariantSelections = new Map(state.agentModelVariantSelections)
        sessionModelSelections.delete(sessionId)
        sessionAgentSelections.delete(sessionId)
        sessionFollowedAgents.delete(sessionId)
        sessionFollowedModels.delete(sessionId)
        sessionAgentModelSelections.delete(sessionId)
        landedAgentSwitches.delete(sessionId)
        pendingAgentSwitches.delete(sessionId)
        agentModelVariantSelections.delete(variantKey)
        return { sessionModelSelections, sessionAgentSelections, sessionFollowedAgents, sessionFollowedModels, sessionAgentModelSelections, landedAgentSwitches, pendingAgentSwitches, agentModelVariantSelections }
      }),

      saveAgentModelVariantForSession: (sessionId, agentName, providerId, modelId, variant) => set((state) => {
        const key = `${providerId}/${modelId}`
        const sessionKey = variantSessionKey(sessionId)
        if (state.agentModelVariantSelections.get(sessionKey)?.get(agentName)?.get(key) === variant) return state
        const selections = new Map(state.agentModelVariantSelections)
        const agentMap = new Map(selections.get(sessionKey))
        const modelMap = new Map(agentMap.get(agentName))
        if (variant === undefined) {
          modelMap.delete(key)
        } else {
          modelMap.set(key, variant)
        }
        if (modelMap.size) agentMap.set(agentName, modelMap)
        else agentMap.delete(agentName)
        selections.delete(sessionKey)
        if (agentMap.size) selections.set(sessionKey, agentMap)
        return { agentModelVariantSelections: selections }
      }),

      getAgentModelVariantForSession: (sessionId, agentName, providerId, modelId) => {
        const key = `${providerId}/${modelId}`
        return get().agentModelVariantSelections.get(variantSessionKey(sessionId))?.get(agentName)?.get(key)
      },
    }),
    {
      name: "selection-store",
      version: 1,
      storage: createDeferredSafeJSONStorage(),
      partialize: (state) => {
        // Convert Maps to arrays and slice to keep only the most recent MAX_PERSISTED_SESSIONS
        const models = Array.from(state.sessionModelSelections.entries()).slice(-MAX_PERSISTED_SESSIONS)
        const agents = Array.from(state.sessionAgentSelections.entries()).slice(-MAX_PERSISTED_SESSIONS)
        const followedAgents = Array.from(state.sessionFollowedAgents.entries()).slice(-MAX_PERSISTED_SESSIONS)
        const followedModels = Array.from(state.sessionFollowedModels.entries()).slice(-MAX_PERSISTED_SESSIONS)
        const agentModels = Array.from(state.sessionAgentModelSelections.entries())
          .slice(-MAX_PERSISTED_SESSIONS)
          .map(([sessionId, agentMap]) => [sessionId, Array.from(agentMap.entries())])

        return {
          sessionModelSelections: models,
          sessionAgentSelections: agents,
          sessionFollowedAgents: followedAgents,
          sessionFollowedModels: followedModels,
          sessionAgentModelSelections: agentModels,
          agentModelVariantSelections: Array.from(state.agentModelVariantSelections)
            .slice(-MAX_PERSISTED_SESSIONS)
            .map(([sessionId, agents]) => [sessionId, Array.from(agents, ([agent, models]) => [agent, Array.from(models)])]),
          lastUsedProvider: state.lastUsedProvider,
        }
      },
      merge: (persistedState, currentState) => {
        const parsed = persistedSelectionSchema.safeParse(persistedState)
        if (!parsed.success) return currentState
        const persisted = parsed.data
        const agentModelSelections = persisted.sessionAgentModelSelections
          ? new Map<string, Map<string, ModelSelection>>()
          : currentState.sessionAgentModelSelections
        const agentModelVariantSelections: VariantSelections = persisted.agentModelVariantSelections
          ? new Map(persisted.agentModelVariantSelections.map(([sessionId, agents]) => [sessionId,
            new Map(agents.map(([agent, models]) => [agent, new Map(models)])),
          ]))
          : currentState.agentModelVariantSelections
        if (Array.isArray(persisted?.sessionAgentModelSelections)) {
          persisted.sessionAgentModelSelections.forEach(([sessionId, agentArray]) => {
            agentModelSelections.set(sessionId, new Map(agentArray))
          })
        }

        return {
          ...currentState,
          lastUsedProvider: persisted?.lastUsedProvider ?? currentState.lastUsedProvider,
          sessionModelSelections: persisted.sessionModelSelections ? new Map(persisted.sessionModelSelections) : currentState.sessionModelSelections,
          sessionAgentSelections: persisted.sessionAgentSelections ? new Map(persisted.sessionAgentSelections) : currentState.sessionAgentSelections,
          sessionFollowedAgents: persisted.sessionFollowedAgents ? new Map(persisted.sessionFollowedAgents) : currentState.sessionFollowedAgents,
          sessionFollowedModels: persisted.sessionFollowedModels ? new Map(persisted.sessionFollowedModels) : currentState.sessionFollowedModels,
          sessionAgentModelSelections: agentModelSelections,
          agentModelVariantSelections,
        }
      },
      migrate: (persistedState) => {
        // Scaffold for future schema migrations
        return persistedState
      }
    }
  )
)
