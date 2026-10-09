import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { platformCode, platformFailure } from './PlatformErrors';
import { newId } from '../core/Workspace';

export class CredentialStore {
  // Immutable aliases ensure a failed configuration write cannot replace the previous credential.
  async save(token: string): Promise<string> {
    if (!token.trim()) { throw new Error('请填写 Token'); }
    const reference = 'hermes-eye-' + newId();
    const attributes: asset.AssetMap = new Map();
    attributes.set(asset.Tag.ALIAS, new util.TextEncoder().encodeInto(reference));
    attributes.set(asset.Tag.SECRET, new util.TextEncoder().encodeInto(token.trim()));
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
    try { await asset.add(attributes); }
    catch (error) {
      const advice = platformCode(error as Error) === 24000005 ? '请解锁设备后重试；' : '';
      throw platformFailure('asset.add', error as Error, advice + '安全存储失败，配置未保存；不会降级为明文存储');
    }
    return reference;
  }
  async read(reference: string): Promise<string> {
    if (!reference) { return ''; }
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, new util.TextEncoder().encodeInto(reference));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const result = await asset.query(query);
      if (!result.length) { throw new Error('Missing credential'); }
      return util.TextDecoder.create('utf-8').decodeToString(result[0].get(asset.Tag.SECRET) as Uint8Array);
    } catch (error) {
      const code = platformCode(error as Error);
      const advice = code === 24000002 ? '安全凭据不存在，请重新填写 Token' :
        code === 24000004 || code === 24000005 ? '安全凭据暂不可用，请解锁设备后重试' :
          '安全凭据暂不可用，请解锁设备或重新填写 Token';
      throw platformFailure('asset.query', error as Error, advice);
    }
  }
  async remove(reference: string): Promise<void> {
    if (!reference) { return; }
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, new util.TextEncoder().encodeInto(reference));
    try { await asset.remove(query); }
    catch (error) {
      // The requested end state is already satisfied when the alias is absent.
      if (platformCode(error as Error) === 24000002) { return; }
      throw platformFailure('asset.remove', error as Error, '安全凭据清理失败，仍保留在安全存储中');
    }
  }
}
