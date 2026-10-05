import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { AppData } from '../core/Domain';
import { Workspace, newWorkspace, migrateLegacy, validateWorkspace } from '../core/Workspace';

export class WorkspaceRepository {
  private path: string = '';
  async load(context: common.UIAbilityContext): Promise<Workspace> {
    this.path = `${context.filesDir}/hermes-eye-workspace-v2.json`;
    if (fileIo.accessSync(this.path)) {
      return validateWorkspace(JSON.parse(fileIo.readTextSync(this.path)) as Workspace);
    }
    const legacy = `${context.filesDir}/hermes-eye-v1.json`;
    const data = fileIo.accessSync(legacy) ? migrateLegacy(JSON.parse(fileIo.readTextSync(legacy)) as AppData) : newWorkspace();
    await this.save(data);
    return data;
  }
  async save(data: Workspace): Promise<void> {
    if (!this.path) { throw new Error('本地存储尚未就绪'); }
    validateWorkspace(data);
    const file = fileIo.openSync(this.path + '.tmp', fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
    try {
      const bytes = new util.TextEncoder().encodeInto(JSON.stringify(data)).buffer;
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = fileIo.writeSync(file.fd, bytes.slice(offset));
        if (written <= 0) { throw new Error('本地写入未完成'); }
        offset += written;
      }
      fileIo.fsyncSync(file.fd);
    } finally { fileIo.closeSync(file); }
    fileIo.renameSync(this.path + '.tmp', this.path);
  }
}
