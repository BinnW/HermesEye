import { Workspace, Connection, copyWorkspace, selectConnection } from '../core/Workspace';
import { WorkspaceRepository } from './WorkspaceRepository';
import { CredentialStore } from './CredentialStore';

export class ConnectionService {
  private repository: WorkspaceRepository;
  private credentials: CredentialStore;
  constructor(repository: WorkspaceRepository, credentials: CredentialStore) {
    this.repository = repository; this.credentials = credentials;
  }
  async save(current: Workspace, input: Connection, token: string): Promise<Workspace> {
    const next = copyWorkspace(current);
    selectConnection(next, input); // Validate the endpoint before touching secrets.
    const reference = await this.credentials.save(token);
    input.credentialRef = reference;
    try { await this.repository.save(next); }
    catch {
      try { await this.credentials.remove(reference); } catch { /* Unreferenced secure asset; never exposed in config. */ }
      throw new Error('本地配置保存失败，旧配置仍有效，请重试');
    }
    const previous = current.connection;
    if (previous && previous.credentialRef && previous.credentialRef !== reference) {
      try { await this.credentials.remove(previous.credentialRef); } catch { /* Safe to keep an unreferenced encrypted asset. */ }
    }
    return next;
  }
}
