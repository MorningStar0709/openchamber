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
    deps.begin(sessionId, agent)
    try {
        await deps.switchSessionAgent(sessionId, agent, directory)
    } catch (error) {
        deps.abandon(sessionId)
        throw error
    }
}
