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
 * session's own directory (that is where the record is). A refusal is shown
 * and leaves the session on the agent it actually runs on. Not awaited: the
 * picker must respond to the click, not to the round trip.
 */
export function commitAgentPick(sessionId: string, agent: string, directory?: string): void {
    void pushAgentSwitch({
        switchSessionAgent: (id, name, dir) => opencodeClient.switchSessionAgent(id, name, dir),
        begin: (id, name) => useSelectionStore.getState().beginAgentSwitch(id, name),
        abandon: (id) => useSelectionStore.getState().abandonAgentSwitch(id),
    }, sessionId, agent, directory).catch((error: unknown) => {
        console.error('[agent-pick] Agent switch failed:', error);
        toast.error(formatMessage(useI18nStore.getState().dictionary, 'chat.agent.switchFailed', { agent }), {
            description: error instanceof Error ? error.message : String(error),
        });
    });
}
