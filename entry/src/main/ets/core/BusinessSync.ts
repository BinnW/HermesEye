/** Business protocol v1. Separate from the legacy v2 workspace and its private sources. */
export interface BusinessPayload {
  name?: string; goal?: string; managedBy?: string; nextStep?: string;
  date?: string; title?: string; status?: string; projectId?: string; priority?: string;
  minutes?: number; note?: string; content?: string; author?: string; source?: string;
  progress?: number; ownerKind?: string; ownerId?: string; sourceKind?: string;
  sourceId?: string; needId?: string;
}
export interface BusinessEntity {
  kind: string; id: string; revision: number; deleted: boolean; payload: BusinessPayload; origin: string;
}
export interface BusinessMutation {
  deviceId: string; mutationId: string; kind: string; id: string; baseRevision: number;
  deleted: boolean; payload: BusinessPayload;
}
export interface BusinessReceipt { status: string; entity?: BusinessEntity; remote?: BusinessEntity | null; cursor?: number; }
export interface BusinessConflict { local: BusinessMutation; remote: BusinessEntity | null; }
export interface BusinessPage { entities: BusinessEntity[]; cursor: number; hasMore?: boolean; boundary?: number; }
export interface BusinessIdentity { protocolVersion: number; serverId: string; workspaceId: string; }
export interface BusinessIntent { operationId: string; needId: string; kind: string; input: string; }
export interface BusinessOperation {
  id: string; needId: string; kind: string; state: string; remoteId: string | null;
  result: BusinessResult; observation?: string;
}
export interface BusinessResult { message?: string; sessionId?: string; output?: string; }
export interface BusinessPending { intent: BusinessIntent; operation?: BusinessOperation; }
export interface BusinessState {
  version: number; serverId: string; workspaceId: string; deviceId: string; cursor: number;
  entities: BusinessEntity[]; outbox: BusinessMutation[]; conflicts: BusinessConflict[]; operations: BusinessPending[];
}
export function newBusinessState(identity: BusinessIdentity, deviceId: string): BusinessState {
  if (identity.protocolVersion !== 1 || !identity.serverId || !identity.workspaceId || !deviceId) {
    throw new Error('业务服务身份或协议无效');
  }
  return { version: 1, serverId: identity.serverId, workspaceId: identity.workspaceId, deviceId: deviceId,
    cursor: 0, entities: [], outbox: [], conflicts: [], operations: [] };
}
export function validateBusinessState(state: BusinessState): BusinessState {
  if (!state || state.version !== 1 || !state.serverId || !state.workspaceId || !state.deviceId ||
    !Number.isInteger(state.cursor) || state.cursor < 0 || !Array.isArray(state.entities) ||
    !Array.isArray(state.outbox) || !Array.isArray(state.conflicts) || !Array.isArray(state.operations)) {
    throw new Error('业务副本无效，禁止覆盖');
  }
  state.entities.forEach((entity: BusinessEntity) => {
    if (!entity.id || !entity.kind || !Number.isInteger(entity.revision) || entity.revision < 1 ||
      typeof entity.deleted !== 'boolean' || !entity.payload || typeof entity.payload !== 'object') {
      throw new Error('业务对象无效');
    }
  });
  return state;
}
export function assertBusinessIdentity(state: BusinessState, identity: BusinessIdentity): void {
  if (identity.protocolVersion !== 1 || state.serverId !== identity.serverId || state.workspaceId !== identity.workspaceId) {
    throw new Error('业务服务身份已变化，请建立独立副本；禁止合并或上传现有数据');
  }
}
export function copyBusinessState(state: BusinessState): BusinessState {
  return JSON.parse(JSON.stringify(state)) as BusinessState;
}
export function enqueueBusinessMutation(state: BusinessState, mutation: BusinessMutation): void {
  if (mutation.deviceId !== state.deviceId || !mutation.mutationId ||
    state.outbox.some((item: BusinessMutation) => item.mutationId === mutation.mutationId) ||
    state.outbox.some((item: BusinessMutation) => item.kind === mutation.kind && item.id === mutation.id) ||
    state.conflicts.some((item: BusinessConflict) => item.local.kind === mutation.kind && item.local.id === mutation.id)) {
    throw new Error('对象已有待确认修改，请先处理原操作');
  }
  const confirmed = state.entities.find((entity: BusinessEntity) => entity.kind === mutation.kind && entity.id === mutation.id);
  if (mutation.baseRevision !== (confirmed?.revision ?? 0)) { throw new Error('修改基线已过期'); }
  state.outbox.push(mutation);
}
export function applyBusinessPage(state: BusinessState, page: BusinessPage, snapshot: boolean = false): void {
  if (!Number.isInteger(page.cursor) || page.cursor < 0 || (!snapshot && page.cursor < state.cursor)) {
    throw new Error('同步游标无效');
  }
  if (snapshot) { state.entities = []; }
  page.entities.forEach((entity: BusinessEntity) => {
    const index = state.entities.findIndex((item: BusinessEntity) => item.kind === entity.kind && item.id === entity.id);
    if (index < 0) { state.entities.push(entity); }
    else if (entity.revision >= state.entities[index].revision) { state.entities[index] = entity; }
  });
  state.cursor = page.cursor;
  validateBusinessState(state);
  // Pending edits and conflicts survive snapshot recovery. Never infer acknowledgement from a timestamp.
}
export function applyBusinessReceipt(state: BusinessState, mutation: BusinessMutation, receipt: BusinessReceipt): void {
  if (receipt.status === 'conflict') {
    state.conflicts.push({ local: mutation, remote: receipt.remote ?? null });
  } else if (receipt.status === 'accepted' && receipt.entity && receipt.entity.kind === mutation.kind &&
    receipt.entity.id === mutation.id && receipt.entity.revision === mutation.baseRevision + 1) {
    // Do not advance the pull cursor from a mutation receipt: that would skip other clients' changes.
    applyBusinessPage(state, { entities: [receipt.entity], cursor: state.cursor });
  } else { throw new Error('业务确认回执无效'); }
  state.outbox = state.outbox.filter((item: BusinessMutation) => item.mutationId !== mutation.mutationId);
}
