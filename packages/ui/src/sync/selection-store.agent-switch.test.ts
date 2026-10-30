import { beforeEach, describe, expect, test } from 'bun:test';
import { useSelectionStore } from '@/sync/selection-store';

/**
 * A pick must not be undone by a record that has not heard about it yet.
 *
 * The composer writes a pick to the session record on the server, and the
 * record echoes back a moment later. Until it does, the record still names the
 * previous agent — and the follow effect reads that as "somebody else switched
 * this session". Without a marker for the pick in flight, the composer takes
 * the stale record and throws the pick away; the send path then compares the
 * session against a pick that no longer exists and sends nothing, so the
 * server stays on the old agent for good.
 */

const SESSION = 'ses_pick';

beforeEach(() => {
    useSelectionStore.setState({
        sessionAgentSelections: new Map(),
        sessionFollowedAgents: new Map(),
        pendingAgentSwitches: new Map(),
    });
});

describe('agent pick in flight', () => {
    test('an older record does not override the pick', () => {
        useSelectionStore.getState().beginAgentSwitch(SESSION, 'build');

        const followed = useSelectionStore.getState().followSessionAgent(SESSION, 'plan');

        expect(followed).toBe(false);
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('build');
    });

    test('the record reporting the pick clears the marker', () => {
        useSelectionStore.getState().beginAgentSwitch(SESSION, 'build');

        expect(useSelectionStore.getState().followSessionAgent(SESSION, 'build')).toBe(false);

        // Nothing is in flight any more: a genuine switch elsewhere is followed.
        expect(useSelectionStore.getState().followSessionAgent(SESSION, 'plan')).toBe(true);
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('plan');
    });

    test('a refused switch puts the pick back on the agent the session runs on', () => {
        // The state the app is in before the pick: the record says plan, and
        // the composer followed it.
        useSelectionStore.getState().followSessionAgent(SESSION, 'plan');
        useSelectionStore.getState().beginAgentSwitch(SESSION, 'build');

        expect(useSelectionStore.getState().refuseAgentSwitch(SESSION, 'build')).toBe('plan');
        // A record that never changed is never re-read, so no effect would undo
        // the pick: the selection has to carry the agent the session runs on.
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('plan');
        expect(useSelectionStore.getState().followSessionAgent(SESSION, 'plan')).toBe(false);
    });

    test('a refusal for a pick a newer one replaced leaves the newer pick alone', () => {
        useSelectionStore.getState().followSessionAgent(SESSION, 'plan');
        useSelectionStore.getState().beginAgentSwitch(SESSION, 'build');
        useSelectionStore.getState().beginAgentSwitch(SESSION, 'plan');

        expect(useSelectionStore.getState().refuseAgentSwitch(SESSION, 'build')).toBeNull();
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('plan');
    });

    test('a pick whose echo never lands stops holding the composer back', () => {
        useSelectionStore.getState().beginAgentSwitch(SESSION, 'build');
        const realNow = Date.now;
        Date.now = () => realNow() + 11_000;
        try {
            // The record won again, so a real switch elsewhere is followed
            // instead of being swallowed for the rest of the session.
            expect(useSelectionStore.getState().followSessionAgent(SESSION, 'plan')).toBe(true);
            expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('plan');
        } finally {
            Date.now = realNow;
        }
    });

    test('a marker for another session leaves this one alone', () => {
        useSelectionStore.getState().beginAgentSwitch('ses_other', 'build');

        expect(useSelectionStore.getState().followSessionAgent(SESSION, 'plan')).toBe(true);
        expect(useSelectionStore.getState().getSessionAgentSelection(SESSION)).toBe('plan');
    });
});
