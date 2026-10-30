import { describe, expect, test } from 'bun:test';
import { pushAgentSwitch } from '@/sync/agent-switch';
import { useSelectionStore } from '@/sync/selection-store';

/**
 * A pick reaches the session record as a request, and the record echoes back
 * afterwards. The marker has to be up before the request leaves — the echo can
 * beat the response — and down again when it fails, or the composer could never
 * follow the record again.
 */

const SESSION = 'ses_push';

function deps(outcome: 'ok' | 'fail', calls: Array<{ agent: string; directory?: string }>) {
    return {
        switchSessionAgent: async (_sessionId: string, agent: string, directory?: string) => {
            calls.push({ agent, directory });
            if (outcome === 'fail') throw new Error('agent build is not available in this directory');
        },
        begin: (sessionId: string, agentName: string) => useSelectionStore.getState().beginAgentSwitch(sessionId, agentName),
        abandon: (sessionId: string) => useSelectionStore.getState().abandonAgentSwitch(sessionId),
    };
}

describe('pushAgentSwitch', () => {
    test('writes the pick to the record in the session directory', async () => {
        useSelectionStore.setState({ pendingAgentSwitches: new Map() });
        const calls: Array<{ agent: string; directory?: string }> = [];

        await pushAgentSwitch(deps('ok', calls), SESSION, 'build', '/home/skyler/project');

        expect(calls).toEqual([{ agent: 'build', directory: '/home/skyler/project' }]);
        // Still marked: the record has not echoed the switch yet.
        expect(useSelectionStore.getState().followSessionAgent(SESSION, 'plan')).toBe(false);
    });

    test('two picks reach the record in the order the user made them', async () => {
        useSelectionStore.setState({ pendingAgentSwitches: new Map() });
        const landed: string[] = [];
        const session = 'ses_ordered';
        const slow = {
            switchSessionAgent: async (_sessionId: string, agent: string) => {
                // The first request is slow enough that a second request fired
                // at once would overtake it and leave the record on the first.
                await new Promise((resolve) => setTimeout(resolve, agent === 'build' ? 20 : 0));
                landed.push(agent);
            },
            begin: (sessionId: string, agentName: string) => useSelectionStore.getState().beginAgentSwitch(sessionId, agentName),
            abandon: (sessionId: string) => useSelectionStore.getState().abandonAgentSwitch(sessionId),
        };

        await Promise.all([
            pushAgentSwitch(slow, session, 'build', undefined),
            pushAgentSwitch(slow, session, 'plan', undefined),
        ]);

        expect(landed).toEqual(['build', 'plan']);
    });

    test('a refused switch drops the marker and reports the failure', async () => {
        useSelectionStore.setState({ pendingAgentSwitches: new Map() });

        await expect(pushAgentSwitch(deps('fail', []), SESSION, 'build', undefined))
            .rejects.toThrow('agent build is not available in this directory');

        expect(useSelectionStore.getState().followSessionAgent(SESSION, 'plan')).toBe(true);
    });
});
