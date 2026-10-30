/**
 * One way for every picker to write its choice to the session record.
 *
 * The agent a session runs on lives on the session, and a pick is the only
 * moment the user says which one it should be. Writing it later, at send time,
 * leaves the choice competing with whatever the record still says — and the
 * record wins, because the send path only travels a difference it can see.
 */

import { toast } from 'sonner';
import { opencodeClient } from '@/lib/opencode/client';
import { formatMessage, useI18nStore } from '@/lib/i18n/store';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSelectionStore } from '@/sync/selection-store';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { pushAgentSwitch } from '@/sync/agent-switch';

/**
 * Puts the composer back on the agent a refused pick left behind.
 *
 * The refusal changed nothing on the record, so no effect comes along to undo
 * the pick: the composer would keep showing an agent the session does not run
 * on, and the next send would compare against that phantom. Only the composer
 * that is showing this session is touched, and only when the store knows which
 * agent to go back to — otherwise the record speaks.
 *
 * `setAgent` without `keepModel` on purpose: the forward pick resolved a model
 * for the refused agent, and going back has to resolve the restored agent's
 * own model instead of keeping the one that lost.
 */
function restoreComposerAgent(sessionId: string, target: string | null, column: boolean): void {
    if (target === null || column) return
    // A column that happens to show this session must not move the app-wide
    // composer: the column reads the selection, the app-wide one does not.
    if (useSessionUIStore.getState().currentSessionId !== sessionId) return
    useConfigStore.getState().setAgent(target)
}

export type CommitAgentPickOptions = {
    /** The pick came from a column or the side panel, not the app-wide composer. */
    column?: boolean
    /** The agent that composer showed before the pick, for when the record's is unknown. */
    previousAgent?: string | null
}

/**
 * Selects `agent` for the session and switches the record to it, in the
 * session's own directory (that is where the record is).
 *
 * Resolves true when the record took the pick, or already held it. A refusal is
 * shown, and the selection goes back to the agent the session actually runs on
 * so the caller can put the composer back with it: the record did not change,
 * so no effect re-reads it, and nothing else would undo the pick.
 *
 * Not awaited by the picker: it responds to the click, not to the round trip.
 */
export function commitAgentPick(
    sessionId: string,
    agent: string,
    directory?: string,
    options: CommitAgentPickOptions = {},
): Promise<boolean> {
    const state = useSelectionStore.getState();
    // The record already names this agent and nothing is on its way to it: the
    // request would append a switch to the transcript and change nothing. With
    // a pick in flight the read is behind, and a pick that returns to the agent
    // the record held must still be written behind it.
    if (state.pendingAgentSwitches.get(sessionId) === undefined
        && state.sessionFollowedAgents.get(sessionId) === agent) {
        state.saveSessionAgentSelection(sessionId, agent);
        return Promise.resolve(true);
    }
    return pushAgentSwitch({
        switchSessionAgent: (id, name, dir) => opencodeClient.switchSessionAgent(id, name, dir),
        begin: (id, name) => useSelectionStore.getState().beginAgentSwitch(id, name),
        landed: (id, name) => useSelectionStore.getState().markAgentSwitchLanded(id, name),
        // The refusal undoes this request only: the token keeps a request the
        // user has already replaced from rolling the newer pick back.
        abandon: (id, name, token) => {
            const refused = useSelectionStore.getState().refuseAgentSwitch(id, name, token);
            // A refusal that no longer owns the marker belongs to a pick the
            // user has already replaced: leave that one and its composer alone.
            if (!refused.owned) return;
            // The caller's own "before the pick" value is the last resort, and
            // only when it names something other than the refused agent: a
            // picker that had already written the pick into the selection map
            // (setAgent does) reports the refused agent back as its previous.
            const previous = options.previousAgent ?? null;
            const target = refused.fallback ?? (previous !== agent ? previous : null);
            if (target !== null) useSelectionStore.getState().saveSessionAgentSelection(id, target);
            restoreComposerAgent(id, target, options.column === true);
        },
    }, sessionId, agent, directory).then(
        () => true,
        (error: unknown) => {
            console.error('[agent-pick] Agent switch failed:', error);
            toast.error(formatMessage(useI18nStore.getState().dictionary, 'chat.agent.switchFailed', { agent }), {
                description: error instanceof Error ? error.message : String(error),
            });
            return false;
        },
    );
}
