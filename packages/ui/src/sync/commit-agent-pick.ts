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
import { useSelectionStore } from '@/sync/selection-store';
import { pushAgentSwitch } from '@/sync/agent-switch';

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
export function commitAgentPick(sessionId: string, agent: string, directory?: string): Promise<boolean> {
    // The record already names this agent: the request would append a switch
    // to the session's transcript and change nothing.
    if (useSelectionStore.getState().sessionFollowedAgents.get(sessionId) === agent) {
        useSelectionStore.getState().saveSessionAgentSelection(sessionId, agent);
        return Promise.resolve(true);
    }
    return pushAgentSwitch({
        switchSessionAgent: (id, name, dir) => opencodeClient.switchSessionAgent(id, name, dir),
        begin: (id, name) => useSelectionStore.getState().beginAgentSwitch(id, name),
        // The refusal undoes the pick: it drops the marker and puts the
        // selection back where the session already runs.
        abandon: (id) => {
            useSelectionStore.getState().refuseAgentSwitch(id, agent);
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
