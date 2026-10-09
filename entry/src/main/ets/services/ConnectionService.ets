import { reportPlatformFailure } from './PlatformErrors';
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
      try { await this.credentials.remove(reference); } catch (error) { reportPlatformFailure('asset.rollbackCleanup', error as Error); }
      throw new Error('本地配置保存失败，旧配置仍有效，请重试');
    }
    const previous = current.connection;
    if (previous && previous.credentialRef && previous.credentialRef !== reference) {
      try { await this.credentials.remove(previous.credentialRef); } catch (error) { reportPlatformFailure('asset.oldCredentialCleanup', error as Error); }
    }
    return next;
  }
}
