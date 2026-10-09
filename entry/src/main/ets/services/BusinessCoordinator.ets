import { BusinessState, BusinessMutation, BusinessReceipt, BusinessIdentity, BusinessPage, BusinessIntent,
  BusinessOperation, BusinessPending, BusinessConflict, copyBusinessState, assertBusinessIdentity, enqueueBusinessMutation,
  applyBusinessPage, applyBusinessReceipt } from '../core/BusinessSync';

export interface BusinessPersistence { save(state: BusinessState): Promise<void>; }
export interface BusinessTransport {
  identity(): Promise<BusinessIdentity>;
  mutate(mutation: BusinessMutation): Promise<BusinessReceipt>;
  pull(cursor: number): Promise<BusinessPage>;
  snapshot(): Promise<BusinessPage>;
  submit(intent: BusinessIntent): Promise<BusinessOperation>;
  query(operationId: string): Promise<BusinessOperation>;
}
/** One coordinator owns one replica. Each successful transaction publishes only after durable save. */
export class BusinessCoordinator {
  private busy: boolean = false;
  private state: BusinessState;
  private persistence: BusinessPersistence;
  private remote: BusinessTransport;
  constructor(state: BusinessState, persistence: BusinessPersistence, remote: BusinessTransport) {
    this.state = state; this.persistence = persistence; this.remote = remote;
  }
  current(): BusinessState { return copyBusinessState(this.state); }
  private async persist(next: BusinessState): Promise<void> {
    await this.persistence.save(next);
    this.state = next;
  }
  private enter(): void {
    if (this.busy) { throw new Error('业务操作处理中'); }
    this.busy = true;
  }
  async edit(mutation: BusinessMutation): Promise<void> {
    this.enter();
    try {
      const next = this.current(); enqueueBusinessMutation(next, mutation); await this.persist(next);
    } finally { this.busy = false; }
  }
  async resolve(mutationId: string, keepLocal: boolean, newMutationId: string): Promise<void> {
    this.enter();
    try {
      const next = this.current();
      const conflict = next.conflicts.find((item: BusinessConflict) => item.local.mutationId === mutationId);
      if (!conflict) { throw new Error('冲突已不存在'); }
      next.conflicts = next.conflicts.filter((item: BusinessConflict) => item.local.mutationId !== mutationId);
      if (keepLocal) {
        conflict.local.mutationId = newMutationId;
        conflict.local.baseRevision = conflict.remote?.revision ?? 0;
        next.outbox.push(conflict.local);
      }
      await this.persist(next);
    } finally { this.busy = false; }
  }
  async synchronize(rebuild: boolean = false): Promise<void> {
    this.enter();
    try {
      assertBusinessIdentity(this.state, await this.remote.identity());
      if (rebuild) {
        const next = this.current(); applyBusinessPage(next, await this.remote.snapshot(), true); await this.persist(next);
      }
      // Only an explicit synchronize call sends the durable outbox; there is no retry timer.
      for (const mutation of this.state.outbox) {
        const receipt = await this.remote.mutate(mutation);
        const next = this.current(); applyBusinessReceipt(next, mutation, receipt); await this.persist(next);
      }
      let more = true;
      let pages = 0;
      while (more) {
        const page = await this.remote.pull(this.state.cursor);
        if (page.hasMore && page.cursor <= this.state.cursor) { throw new Error('业务服务同步未推进'); }
        const next = this.current(); applyBusinessPage(next, page); await this.persist(next);
        more = page.hasMore === true;
        pages++;
        if (more && pages >= 100) { throw new Error('本次同步页数已达上限，请继续同步'); }
      }
    } finally { this.busy = false; }
  }
  async send(intent: BusinessIntent): Promise<BusinessOperation> {
    this.enter();
    try {
      assertBusinessIdentity(this.state, await this.remote.identity());
      if (this.state.operations.some((item: BusinessPending) => item.intent.operationId === intent.operationId)) {
        throw new Error('操作已存在，请查询原操作，禁止重新发送');
      }
      if (this.state.operations.some((item: BusinessPending) => item.intent.needId === intent.needId &&
        (!item.operation || !['completed', 'failed', 'cancelled'].includes(item.operation.state)))) {
        throw new Error('此会话有未确认操作，请先查询原操作');
      }
      const next = this.current(); next.operations.push({ intent: intent }); await this.persist(next);
      const operation = await this.remote.submit(intent);
      await this.record(intent.operationId, operation);
      return operation;
    } finally { this.busy = false; }
  }
  async recover(operationId: string): Promise<BusinessOperation> {
    this.enter();
    try {
      assertBusinessIdentity(this.state, await this.remote.identity());
      const operation = await this.remote.query(operationId);
      await this.record(operationId, operation);
      return operation;
    } finally { this.busy = false; }
  }
  private async record(operationId: string, operation: BusinessOperation): Promise<void> {
    const next = this.current();
    const pending = next.operations.find((item: BusinessPending) => item.intent.operationId === operationId);
    if (!pending || operation.id !== operationId || operation.needId !== pending.intent.needId || operation.kind !== pending.intent.kind) {
      throw new Error('操作回执与原请求不符');
    }
    pending.operation = operation; await this.persist(next);
  }
}
