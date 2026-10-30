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
    /** Marks the pick as in flight, so a lagging record cannot undo it. */
    begin: (sessionId: string, agent: string) => void
    /** Drops that marker when the switch did not land. */
    abandon: (sessionId: string) => void
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
    deps.begin(sessionId, agent)

    const previous = sessionChains.get(sessionId) ?? Promise.resolve()
    const run = previous.then(
        () => deps.switchSessionAgent(sessionId, agent, directory),
        () => deps.switchSessionAgent(sessionId, agent, directory),
    )
    const tail = run.then(() => undefined, () => undefined)
    sessionChains.set(sessionId, tail)
    void tail.then(() => {
        if (sessionChains.get(sessionId) === tail) sessionChains.delete(sessionId)
    })

    try {
        await run
    } catch (error) {
        deps.abandon(sessionId)
        throw error
    }
}
