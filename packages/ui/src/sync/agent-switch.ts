/**
 * Writes a picker choice to the session record.
 *
 * OpenCode 2.x keeps the agent on the session, so a pick is a server write, not
 * a local setting. It has to happen when the choice is made: the send path only
 * travels a difference it can see, and it sees what the record said a moment
 * ago. A pick left for the next send therefore races that send, and loses.
 */

export type AgentSwitchDeps = {
    /** `switchSessionAgent` of the OpenCode client. Rejects when the server refuses. */
    switchSessionAgent: (sessionId: string, agent: string, directory?: string) => Promise<void>
    /** Marks the pick as in flight, so a lagging record cannot undo it. Returns the request's token. */
    begin: (sessionId: string, agent: string) => number
    /**
     * Drops that marker when the switch did not land. Carries the agent and the
     * token of the request that failed: a newer pick may already own the
     * marker, and rolling that one back would lose a choice the user made.
     */
    abandon: (sessionId: string, agent: string, token: number) => void
    /** Notes the agent the record accepted, so a later refusal can restore it. */
    landed?: (sessionId: string, agent: string) => void
}

/**
 * Requests in flight per session, in the order they were made.
 *
 * Two quick picks are two writes, and the record ends on whichever answer
 * arrives last, not on whichever the user picked last. A request that is merely
 * slow must not overtake a newer one, so the writes for one session run one
 * after another: the record then ends on the last pick, which is the one the
 * composer shows.
 */
const sessionChains = new Map<string, Promise<void>>()

/**
 * Switches the session to `agent` in `directory` (the directory the session
 * lives in, which is where its record is). The marker is up before the request
 * leaves and goes only if it fails; on success the record's own echo clears it.
 * A refusal is rethrown for the caller to show.
 */
export async function pushAgentSwitch(
    deps: AgentSwitchDeps,
    sessionId: string,
    agent: string,
    directory: string | undefined,
): Promise<void> {
    // The marker names the newest pick at once, not when its turn in the queue
    // comes: the record may echo the older one back while this one waits.
    const token = deps.begin(sessionId, agent)

    const previous = sessionChains.get(sessionId) ?? Promise.resolve()
    // `previous` is a tail, so it never rejects: the queue must not be blocked
    // by a failure that the failing request itself reports to its caller.
    const run = previous.then(() => deps.switchSessionAgent(sessionId, agent, directory))
    const tail = run.then(() => undefined, () => undefined)
    sessionChains.set(sessionId, tail)
    void tail.then(() => {
        if (sessionChains.get(sessionId) === tail) sessionChains.delete(sessionId)
    })

    try {
        await run
    } catch (error) {
        deps.abandon(sessionId, agent, token)
        throw error
    }
    // Bookkeeping only: the record has already moved, so a throw here must not
    // reject this promise — the caller would report a landed pick as a refusal
    // and roll the composer off it.
    try {
        deps.landed?.(sessionId, agent)
    } catch (error) {
        console.error('[agent-pick] Recording the landed switch failed:', error)
    }
}
