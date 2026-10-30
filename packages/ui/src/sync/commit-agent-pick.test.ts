import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { opencodeClient } from '@/lib/opencode/client';
import { commitAgentPick } from '@/sync/commit-agent-pick';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSelectionStore } from '@/sync/selection-store';
import { useSessionUIStore } from '@/sync/session-ui-store';

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
        landedAgentSwitches: new Map(),
    });
    useSessionUIStore.setState({ currentSessionId: SESSION });
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

describe('a pick that returns to the agent the record held', () => {
    test('is still written behind the pick already in flight', async () => {
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'plan']]),
            sessionFollowedAgents: new Map([[SESSION, 'plan']]),
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        switchSpy.mockImplementationOnce((async (
            _sessionId: string,
            agent: string,
            directory?: string,
        ) => {
            writes.push({ agent, directory });
            await gate;
        }) as never);

        const first = commitAgentPick(SESSION, 'build', DIRECTORY);
        const second = commitAgentPick(SESSION, 'plan', DIRECTORY);
        await settle();
        // The earlier pick owns the record until it lands, so this one waits.
        expect(writes.map((write) => write.agent)).toEqual(['build']);

        release();
        await Promise.all([first, second]);

        // Both went: the last pick is the one the record must end on.
        expect(writes.map((write) => write.agent)).toEqual(['build', 'plan']);
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('plan');
    });
});

describe('two picks for the same agent', () => {
    test('keep the newer one when the older request is refused', async () => {
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'plan']]),
            sessionFollowedAgents: new Map([[SESSION, 'plan']]),
        });
        let calls = 0;
        switchSpy.mockImplementation((async (
            _sessionId: string,
            agent: string,
            directory?: string,
        ) => {
            calls += 1;
            writes.push({ agent, directory });
            if (calls === 1) throw new Error('refused');
        }) as never);

        const older = commitAgentPick(SESSION, 'build', DIRECTORY);
        const newer = commitAgentPick(SESSION, 'build', DIRECTORY);

        expect(await older).toBe(false);
        expect(await newer).toBe(true);
        // The refusal belonged to a request the newer pick superseded.
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('build');
        // The marker still stands for the newer request, waiting for its echo.
        expect(useSelectionStore.getState().pendingAgentSwitches.get(SESSION)?.agent).toBe('build');
    });
});

describe('a refusal after an earlier pick landed', () => {
    test('restores the agent the record accepted, not a stale read', async () => {
        await commitAgentPick(SESSION, 'build', DIRECTORY);
        // The echo of that write never reached the folio: the read is behind.
        useSelectionStore.setState({ sessionFollowedAgents: new Map([[SESSION, 'plan']]) });
        switchSpy.mockImplementation((async () => {
            throw new Error('refused');
        }) as never);

        await commitAgentPick(SESSION, 'work', DIRECTORY);

        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('build');
    });
});

describe('a refusal with no agent yet known to be running', () => {
    test('goes back to the agent the composer showed before the pick', async () => {
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'build']]),
            sessionFollowedAgents: new Map(),
        });
        switchSpy.mockImplementation((async () => {
            throw new Error('refused');
        }) as never);

        await commitAgentPick(SESSION, 'build', DIRECTORY, { previousAgent: 'plan' });

        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('plan');
    });

    test('goes back to what the picker showed even when it re-picked the same agent', async () => {
        // setAgent writes the pick into the selection map before it is
        // committed, so the map cannot say what was on screen; the picker can.
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'build']]),
            sessionFollowedAgents: new Map(),
        });
        switchSpy.mockImplementation((async () => {
            throw new Error('refused');
        }) as never);

        await commitAgentPick(SESSION, 'build', DIRECTORY, { previousAgent: 'build' });

        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('build');
    });
});

describe('the composer after a refusal', () => {
    test('goes back to the restored agent, with that agent own model', async () => {
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'plan']]),
            sessionFollowedAgents: new Map([[SESSION, 'plan']]),
        });
        switchSpy.mockImplementation((async () => {
            throw new Error('refused');
        }) as never);
        const setAgent = spyOn(useConfigStore.getState(), 'setAgent').mockImplementation(() => {});

        await commitAgentPick(SESSION, 'build', DIRECTORY);

        expect(setAgent.mock.calls.length).toBe(1);
        expect(setAgent.mock.calls[0]).toEqual(['plan']);
        setAgent.mockRestore();
    });

    test('is left alone when it has moved to another session', async () => {
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'plan']]),
            sessionFollowedAgents: new Map([[SESSION, 'plan']]),
        });
        useSessionUIStore.setState({ currentSessionId: 'ses_somewhere_else' });
        switchSpy.mockImplementation((async () => {
            throw new Error('refused');
        }) as never);
        const setAgent = spyOn(useConfigStore.getState(), 'setAgent').mockImplementation(() => {});

        await commitAgentPick(SESSION, 'build', DIRECTORY);

        expect(setAgent.mock.calls.length).toBe(0);
        setAgent.mockRestore();
    });
});

describe('a refusal that no longer owns the marker', () => {
    test('leaves the composer on the pick that superseded it', async () => {
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'plan']]),
            sessionFollowedAgents: new Map([[SESSION, 'plan']]),
        });
        let calls = 0;
        switchSpy.mockImplementation((async () => {
            calls += 1;
            if (calls === 1) throw new Error('refused');
        }) as never);
        const setAgent = spyOn(useConfigStore.getState(), 'setAgent').mockImplementation(() => {});

        const older = commitAgentPick(SESSION, 'build', DIRECTORY);
        const newer = commitAgentPick(SESSION, 'work', DIRECTORY);
        await Promise.all([older, newer]);

        // The newer pick owns the selection; touching the composer would
        // re-resolve its model to no purpose.
        expect(setAgent.mock.calls.length).toBe(0);
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('work');
        setAgent.mockRestore();
    });
});

describe('a refusal in a column picker', () => {
    test('never moves the app-wide composer', async () => {
        useSelectionStore.setState({
            sessionAgentSelections: new Map([[SESSION, 'plan']]),
            sessionFollowedAgents: new Map([[SESSION, 'plan']]),
        });
        switchSpy.mockImplementation((async () => {
            throw new Error('refused');
        }) as never);
        const setAgent = spyOn(useConfigStore.getState(), 'setAgent').mockImplementation(() => {});

        await commitAgentPick(SESSION, 'build', DIRECTORY, { column: true });

        expect(setAgent.mock.calls.length).toBe(0);
        // The column reads the store, which the refusal has already put back.
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('plan');
        setAgent.mockRestore();
    });
});
