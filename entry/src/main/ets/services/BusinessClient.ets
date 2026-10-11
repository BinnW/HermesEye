import { ReadingSnapshot, ReadingPolicy, ReadingQuestion, ReadingQuestionRequest, ReadingAnswerRequest, ReadingCollectRequest } from '../core/Reading';
import { http } from '@kit.NetworkKit';
import { apiBase } from '../core/Domain';
import { BusinessIdentity, BusinessMutation, BusinessReceipt, BusinessPage, BusinessIntent, BusinessOperation } from '../core/BusinessSync';
import { BusinessTransport } from './BusinessCoordinator';

/** Separate endpoint family and separate credential: never reuse the direct Hermes token implicitly. */
export class BusinessClient implements BusinessTransport {
  private root: string;
  private token: string;
  constructor(root: string, token: string, allowPrivateHttp: boolean = false) {
    this.token = token;
    // Reuse transport policy while avoiding legacy /v1 insertion before /eye/v1.
    if (/\/v1\/?$/.test(root)) { throw new Error('业务服务请填写根地址，不含 /v1'); }
    const validated = apiBase(root, allowPrivateHttp);
    this.root = validated.substring(0, validated.length - 3);
  }
  private async request(path: string, body: string = ''): Promise<string> {
    if (!this.token.trim()) { throw new Error('请配置独立的业务服务凭据'); }
    const client = http.createHttp();
    try {
      const response = await client.request(this.root + '/eye/v1' + path, {
        method: body ? http.RequestMethod.POST : http.RequestMethod.GET,
        header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token.trim() },
        extraData: body, expectDataType: http.HttpDataType.STRING, connectTimeout: 10000,
        readTimeout: 60000, usingCache: false, maxRedirects: 0, maxLimit: 1024 * 1024
      });
      if (response.responseCode !== 200) { throw new Error('业务请求未确认，HTTP ' + response.responseCode); }
      return response.result as string;
    } catch { throw new Error('业务请求未确认，请保留原操作并查询结果；不要重复发送'); }
    finally { client.destroy(); }
  }
  async identity(): Promise<BusinessIdentity> { return JSON.parse(await this.request('/capabilities')) as BusinessIdentity; }
  async mutate(mutation: BusinessMutation): Promise<BusinessReceipt> {
    return JSON.parse(await this.request('/mutations', JSON.stringify(mutation))) as BusinessReceipt;
  }
  async pull(cursor: number): Promise<BusinessPage> { return JSON.parse(await this.request('/sync?cursor=' + cursor)) as BusinessPage; }
  async snapshot(): Promise<BusinessPage> { return JSON.parse(await this.request('/snapshot')) as BusinessPage; }
  async submit(intent: BusinessIntent): Promise<BusinessOperation> {
    return JSON.parse(await this.request('/operations', JSON.stringify(intent))) as BusinessOperation;
  }
  async query(operationId: string): Promise<BusinessOperation> {
    return JSON.parse(await this.request('/operations/' + encodeURIComponent(operationId))) as BusinessOperation;
  }
  async reading(): Promise<ReadingSnapshot> { return JSON.parse(await this.request('/reading')) as ReadingSnapshot; }
  async readingPolicy(policy: ReadingPolicy): Promise<ReadingPolicy> {
    return JSON.parse(await this.request('/reading/policy', JSON.stringify(policy))) as ReadingPolicy;
  }
  async collectReading(request: ReadingCollectRequest): Promise<ReadingSnapshot> {
    return JSON.parse(await this.request('/reading/collect', JSON.stringify(request))) as ReadingSnapshot;
  }
  async readingQuestion(request: ReadingQuestionRequest): Promise<ReadingQuestion> {
    return JSON.parse(await this.request('/reading/questions', JSON.stringify(request))) as ReadingQuestion;
  }
  async readingAnswer(request: ReadingAnswerRequest): Promise<BusinessOperation> {
    return JSON.parse(await this.request('/reading/answer', JSON.stringify(request))) as BusinessOperation;
  }

}
