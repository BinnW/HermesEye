import { BusinessPersistence } from './BusinessCoordinator';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { BusinessState, validateBusinessState } from '../core/BusinessSync';
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

export class BusinessRepository implements BusinessPersistence {
  private path: string = '';
  private saved: string = '';
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
  async existing(context: common.UIAbilityContext): Promise<BusinessState | undefined> {
    this.path = '';
    const path = `${context.filesDir}/hermes-eye-business-v1.json`;
    if (!this.exists(path)) { return undefined; }
    const state = validateBusinessState(JSON.parse(this.read(path)) as BusinessState);
    this.path = path; this.saved = JSON.stringify(state);
    return state;
  }
  async load(context: common.UIAbilityContext, initial: BusinessState): Promise<BusinessState> {
    this.path = '';
    const path = `${context.filesDir}/hermes-eye-business-v1.json`;
    try {
      if (this.exists(path)) {
        const data = validateBusinessState(JSON.parse(this.read(path)) as BusinessState);
        this.path = path; this.saved = JSON.stringify(data);
        return data;
      }
      const data = validateBusinessState(initial);
      this.path = path;
      await this.save(data);
      return data;
    } catch (error) {
      this.path = ''; // A failed load must never enable writes over an unread workspace.
      throw error as Error;
    }
  }
  async save(data: BusinessState): Promise<void> {
    if (!this.path) { throw new Error('本地存储尚未就绪'); }
    validateBusinessState(data);
    if (this.exists(this.path) && JSON.stringify(JSON.parse(this.read(this.path)) as BusinessState) !== this.saved) {
      throw new Error('业务副本已被更新，请重新进入页面读取最新数据');
    }
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
    this.saved = JSON.stringify(data);
  }
}
