import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
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
    try { await asset.add(attributes); } catch { throw new Error('安全存储失败，配置未保存；不会降级为明文存储'); }
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
    } catch { throw new Error('安全凭据暂不可用，请解锁设备或重新填写 Token'); }
  }
  async remove(reference: string): Promise<void> {
    if (!reference) { return; }
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, new util.TextEncoder().encodeInto(reference));
    await asset.remove(query);
  }
}
