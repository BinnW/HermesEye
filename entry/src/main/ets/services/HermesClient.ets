import { http } from '@kit.NetworkKit';
import { apiBase, ChatRequest, parseReply, Settings } from '../core/Domain';

export class HermesClient {
  private active: http.HttpRequest | undefined = undefined;
  private stopped: boolean = false;

  stop(): void {
    this.stopped = true;
    if (this.active) {
      this.active.destroy();
      this.active = undefined;
    }
  }

  private async request(settings: Settings, token: string, path: string, body: string): Promise<http.HttpResponse> {
    const base = apiBase(settings.baseUrl, settings.allowLocalHttp);
    if (!token.trim()) { throw new Error('请在设置页输入本次使用的 Token'); }
    const client = http.createHttp();
    this.active = client;
    this.stopped = false;
    try {
      const response = await client.request(base + path, {
        method: body ? http.RequestMethod.POST : http.RequestMethod.GET,
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.trim()}` },
        extraData: body,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 60000,
        usingCache: false,
        maxRedirects: 0,
        maxLimit: 1024 * 1024
      });
      if (this.stopped) { throw new Error('Request stopped'); }
      return response;
    } catch {
      if (this.stopped) { throw new Error('已停止等待，输入已保留。服务端可能仍在执行，请确认后再发送'); }
      throw new Error('连接中断或超时。服务端可能仍在执行，请确认后再重试');
    } finally {
      if (this.active === client) { client.destroy(); this.active = undefined; }
    }
  }

  async check(settings: Settings, token: string): Promise<void> {
    const response = await this.request(settings, token, '/models', '');
    if (response.responseCode === 401 || response.responseCode === 403) { throw new Error('认证失败，请检查 Token'); }
    if (response.responseCode !== 200) { throw new Error(`连接检测失败：HTTP ${response.responseCode}`); }
    const result = JSON.parse(response.result as string) as ModelsResponse;
    if (!Array.isArray(result.data)) { throw new Error('服务未返回模型列表，请确认 API 地址'); }
  }

  async chat(settings: Settings, token: string, request: ChatRequest): Promise<string> {
    const response = await this.request(settings, token, '/chat/completions', JSON.stringify(request));
    return parseReply(response.responseCode, response.result as string);
  }
}
interface ModelEntry { id: string; }
interface ModelsResponse { data: ModelEntry[]; }
