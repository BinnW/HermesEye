import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { AppData, initialData, validateData } from '../core/Domain';

export class Repository {
  private path: string = '';

  async load(context: common.UIAbilityContext): Promise<AppData> {
    this.path = `${context.filesDir}/hermes-eye-v1.json`;
    if (!fileIo.accessSync(this.path)) { return initialData(); }
    const raw = fileIo.readTextSync(this.path);
    return validateData(JSON.parse(raw) as AppData);
  }

  async save(data: AppData): Promise<void> {
    if (!this.path) { throw new Error('本地存储尚未就绪'); }
    validateData(data);
    const temporary = this.path + '.tmp';
    const file = fileIo.openSync(temporary, fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
    try {
      const buffer = new util.TextEncoder().encodeInto(JSON.stringify(data)).buffer;
      let offset = 0;
      while (offset < buffer.byteLength) {
        const written = fileIo.writeSync(file.fd, buffer.slice(offset));
        if (written <= 0) { throw new Error('本地文件写入未完成'); }
        offset += written;
      }
      fileIo.fsyncSync(file.fd);
    } finally { fileIo.closeSync(file); }
    fileIo.renameSync(temporary, this.path);
  }
}
