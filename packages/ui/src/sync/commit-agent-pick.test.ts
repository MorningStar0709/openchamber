import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { opencodeClient } from '@/lib/opencode/client';
import { commitAgentPick } from '@/sync/commit-agent-pick';
import { useSelectionStore } from '@/sync/selection-store';

/**
 * What a refused pick leaves behind.
 *
 * The record only re-reads a session whose agent changed, and a refusal changes
 * nothing — so no effect comes along to undo the pick. If the selection kept
 * the agent the server rejected, the composer would show an agent the session
 * does not run on, and the next send would compare against that phantom.
 */

const SESSION = 'ses_pick_write';
const DIRECTORY = '/home/skyler/project';

let switchSpy: ReturnType<typeof spyOn>;
const writes: Array<{ agent: string; directory?: string }> = [];

beforeEach(() => {
    writes.length = 0;
    switchSpy = spyOn(opencodeClient, 'switchSessionAgent').mockImplementation((async (
        _sessionId: string,
        agent: string,
        directory?: string,
    ) => {
        writes.push({ agent, directory });
    }) as never);
    useSelectionStore.setState({
        sessionAgentSelections: new Map(),
        sessionFollowedAgents: new Map(),
        pendingAgentSwitches: new Map(),
    });
});

afterEach(() => {
    switchSpy.mockRestore();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a pick the record refuses', () => {
    test('reports the refusal and puts the pick back on the agent the session runs on', async () => {
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'plan']]),
            sessionFollowedAgents: new Map([[SESSION, 'plan']]),
        });
        switchSpy.mockImplementation((async () => {
            throw new Error('agent build is not available in /home/skyler/project');
        }) as never);

        const landed = await commitAgentPick(SESSION, 'build', DIRECTORY);

        expect(landed).toBe(false);
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('plan');
    });
});

describe('a pick naming the agent the session already runs on', () => {
    test('writes nothing, because the record would gain a line and change nothing', async () => {
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'build']]),
            sessionFollowedAgents: new Map([[SESSION, 'build']]),
        });

        const landed = await commitAgentPick(SESSION, 'build', DIRECTORY);

        expect(landed).toBe(true);
        expect(writes).toEqual([]);
    });
});

describe('a pick the record accepts', () => {
    test('lands in the session directory and reports it', async () => {
        const landed = await commitAgentPick(SESSION, 'build', DIRECTORY);
        await settle();

        expect(landed).toBe(true);
        expect(writes).toEqual([{ agent: 'build', directory: DIRECTORY }]);
    });
});
