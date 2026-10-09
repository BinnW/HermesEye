import { newBusinessState, enqueueBusinessMutation, applyBusinessPage } from '../main/ets/core/BusinessSync';
import { BusinessClient } from '../main/ets/services/BusinessClient';
import { BusinessRepository } from '../main/ets/services/BusinessRepository';
import { BusinessCoordinator } from '../main/ets/services/BusinessCoordinator';
import { describe, it, expect } from '@ohos/hypium';
import { newWorkspace, activeSpace, createNeed, linkedNeed, moveNeed, migrateLegacy, validateWorkspace,
  selectConnection, copyWorkspace, importCalendarPlans, Connection, CalendarEntry, Need, planCounts } from '../main/ets/core/Workspace';
import { initialData } from '../main/ets/core/Domain';

export default function localUnitTest() {
  describe('WorkspaceV1Domain', () => {
    it('businessSnapshotRetainsOfflineIntent', 0, () => {
      const state = newBusinessState({ protocolVersion: 1, serverId: 'server', workspaceId: 'personal' }, 'device');
      enqueueBusinessMutation(state, { deviceId: 'device', mutationId: 'm1', kind: 'plan', id: 'p1',
        baseRevision: 0, deleted: false, payload: { title: 'Read' } });
      applyBusinessPage(state, { entities: [], cursor: 0 }, true);
      const coordinator = new BusinessCoordinator(state, new BusinessRepository(), new BusinessClient('https://example.org', 'unused'));
      expect(coordinator.current().outbox.length).assertEqual(1);
      expect(coordinator.current().cursor).assertEqual(0);
    });

    it('aimlessNeedsKeepIndependentHistories', 0, () => {
      const space = activeSpace(newWorkspace());
      const first = createNeed(space, '', 'independent', '');
      const second = createNeed(space, '', 'independent', '');
      first.messages.push({ role: 'user', content: 'first only' });
      expect(first.name).assertEqual('漫无目的');
      expect(first.id === second.id).assertFalse();
      expect(second.messages.length).assertEqual(0);
    });
    it('linkedPlanRestoresSameNeedAndMovePreservesHistory', 0, () => {
      const data = newWorkspace(); const space = activeSpace(data);
      space.plans.push({ id: 'plan', title: 'Read', date: '2026-10-01', status: 'todo', projectId: '' });
      space.projects.push({ id: 'project', name: 'Study', goal: 'Understand', managedBy: 'manual', nextStep: '' });
      const need = linkedNeed(space, 'Read', 'plan', 'plan');
      need.messages.push({ role: 'assistant', content: 'retained' });
      expect(linkedNeed(space, 'Read', 'plan', 'plan').id).assertEqual(need.id);
      moveNeed(space, need.id, 'Study now', 'project');
      expect(need.messages[0].content).assertEqual('retained');
      expect(need.ownerId).assertEqual('project');
      validateWorkspace(data);
    });
    it('switchingServersDoesNotShareLocalRecords', 0, () => {
      const data = migrateLegacy(initialData());
      createNeed(activeSpace(data), 'Local', 'independent', '');
      const connection: Connection = { name: 'Home', host: 'example.org', port: 443, protocol: 'https', basePath: '',
        model: 'hermes-agent', allowPrivateHttp: false, autoConnect: false, credentialRef: '' };
      selectConnection(data, connection);
      expect(activeSpace(data).needs.length).assertEqual(0);
      expect(data.spaces[0].needs.length).assertEqual(1);
      expect(activeSpace(data).lastSyncAt === null).assertTrue();
    });
    it('dailyStatisticsOnlyCountExplicitStatesForThatDay', 0, () => {
      const space = activeSpace(newWorkspace());
      space.plans.push({ id: 'a', title: 'A', date: '2026-10-01', status: 'doing', projectId: '' });
      space.plans.push({ id: 'b', title: 'B', date: '2026-10-02', status: 'done', projectId: '' });
      const counts = planCounts(space, '2026-10-01');
      expect(counts[0]).assertEqual(0); expect(counts[1]).assertEqual(1); expect(counts[2]).assertEqual(0);
    });
    it('copiedWorkspaceDoesNotMutateThePersistedSnapshot', 0, () => {
      const data = newWorkspace(); const space = activeSpace(data);
      const need = createNeed(space, '', 'independent', '');
      need.messages.push({ role: 'user', content: 'original' });
      const draft = copyWorkspace(data);
      activeSpace(draft).needs[0].messages.push({ role: 'assistant', content: 'reply' });
      expect(need.messages.length).assertEqual(1);
      expect(activeSpace(data).needs[0].messages.length).assertEqual(1);
    });
    it('committedSendRequiresRenderingTheNewSnapshot', 0, () => {
      // Emulator regression (docs/10): the chat page kept rendering the pre-send object.
      const data = newWorkspace(); const space = activeSpace(data);
      const need = createNeed(space, '', 'independent', '');
      const next = copyWorkspace(data);
      const target = activeSpace(next).needs.find((item: Need) => item.id === need.id) as Need;
      target.messages.push({ role: 'user', content: 'prompt' }, { role: 'assistant', content: 'answer' });
      expect(need.messages.length).assertEqual(0);
      expect(target === need).assertFalse();
      expect(target.messages.length).assertEqual(2);
      validateWorkspace(next);
    });
    it('storedLinkToMissingConversationFailsLoudly', 0, () => {
      const data = newWorkspace(); const space = activeSpace(data);
      space.projects.push({ id: 'p1', name: 'Learn', goal: 'Understand', managedBy: 'manual', nextStep: '' });
      const need = linkedNeed(space, 'Learn', 'project', 'p1');
      space.needs = space.needs.filter((item: Need) => item.id !== need.id);
      let failed = false;
      try { linkedNeed(space, 'Learn', 'project', 'p1'); } catch { failed = true; }
      expect(failed).assertTrue();
    });
    it('calendarImportDeduplicatesAndPreservesSourceAndProject', 0, () => {
      const data = newWorkspace(); const space = activeSpace(data);
      space.projects.push({ id: 'p1', name: 'Learn', goal: 'Understand', managedBy: 'manual', nextStep: '' });
      const entries: CalendarEntry[] = [
        { key: '1/1/100', title: 'Meeting', start: 100, end: 200, allDay: false },
        { key: '1/1/300', title: 'Meeting', start: 300, end: 400, allDay: false }
      ];
      expect(importCalendarPlans(space, entries, [entries[0].key], '2026-10-03', 'p1')).assertEqual(1);
      expect(importCalendarPlans(space, entries, entries.map(e => e.key), '2026-10-03', 'p1')).assertEqual(1);
      expect(space.plans.length).assertEqual(2);
      expect(space.plans[0].status).assertEqual('todo');
      expect(space.plans[0].projectId).assertEqual('p1');
      expect(space.plans[0].calendarSource?.start).assertEqual(100);
      validateWorkspace(data);
    });
    it('invalidCalendarSourceRejectedWhileLegacyPlansStayValid', 0, () => {
      const data = newWorkspace(); const space = activeSpace(data);
      space.plans.push({ id: 'legacy', date: '2026-10-01', title: 'Old', status: 'todo', projectId: '' });
      validateWorkspace(data);
      space.plans.push({ id: 'imported', date: '2026-10-01', title: 'M', status: 'todo', projectId: '',
        calendarSource: { key: 'k', title: 'M', start: 200, end: 100, allDay: false } });
      let failed = false;
      try { validateWorkspace(data); } catch { failed = true; }
      expect(failed).assertTrue();
    });
  });
}
