import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { AppData } from '../core/Domain';
import { Workspace, newWorkspace, migrateLegacy, validateWorkspace } from '../core/Workspace';
import { platformCode, platformFailure } from './PlatformErrors';

function storageFailure(operation: string, error: Error): Error {
  const code = platformCode(error);
  let advice = '本地存储操作失败，原文件未被替换，请稍后重试';
  if (code === 13900025 || code === 13900041) { advice = '存储空间或配额不足，请清理空间后重试'; }
  else if (code === 13900001 || code === 13900012 || code === 13900027) {
    advice = '本地文件不可访问或只读，请检查应用存储状态';
  }
  return platformFailure(operation, error, advice);
}

export class WorkspaceRepository {
  private path: string = '';
  private exists(path: string): boolean {
    try { return fileIo.accessSync(path); }
    catch (error) {
      if (platformCode(error as Error) === 13900002) { return false; }
      throw storageFailure('file.access', error as Error);
    }
  }
  private read(path: string): string {
    try { return fileIo.readTextSync(path); }
    catch (error) { throw storageFailure('file.read', error as Error); }
  }
  async load(context: common.UIAbilityContext): Promise<Workspace> {
    this.path = '';
    const path = `${context.filesDir}/hermes-eye-workspace-v2.json`;
    try {
      if (this.exists(path)) {
        const data = validateWorkspace(JSON.parse(this.read(path)) as Workspace);
        this.path = path;
        return data;
      }
      const legacy = `${context.filesDir}/hermes-eye-v1.json`;
      const data = this.exists(legacy) ? migrateLegacy(JSON.parse(this.read(legacy)) as AppData) : newWorkspace();
      this.path = path;
      await this.save(data);
      return data;
    } catch (error) {
      this.path = ''; // A failed load must never enable writes over an unread workspace.
      throw error as Error;
    }
  }
  async save(data: Workspace): Promise<void> {
    if (!this.path) { throw new Error('本地存储尚未就绪'); }
    validateWorkspace(data);
    let file: fileIo.File | undefined = undefined;
    let failure: Error | undefined = undefined;
    let operation = 'file.open';
    try {
      file = fileIo.openSync(this.path + '.tmp', fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
      const bytes = new util.TextEncoder().encodeInto(JSON.stringify(data)).buffer;
      let offset = 0;
      operation = 'file.write';
      while (offset < bytes.byteLength) {
        const written = fileIo.writeSync(file.fd, bytes.slice(offset));
        if (written <= 0) { throw new Error('本地写入未完成'); }
        offset += written;
      }
      operation = 'file.fsync';
      fileIo.fsyncSync(file.fd);
    } catch (error) { failure = storageFailure(operation, error as Error); }
    if (file) {
      try { fileIo.closeSync(file); }
      catch (error) {
        const closeFailure = storageFailure('file.close', error as Error);
        failure = failure ? new Error(failure.message + '；' + closeFailure.message) : closeFailure;
      }
    }
    if (failure) { throw failure; }
    try { fileIo.renameSync(this.path + '.tmp', this.path); }
    catch (error) { throw storageFailure('file.rename', error as Error); }
  }
}
