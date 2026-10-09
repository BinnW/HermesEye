import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { LOG_DOMAIN, LogTag } from './Logging';

export function platformCode(error: Error): number {
  const code = (error as BusinessError).code;
  return Number.isFinite(code) ? code : 0;
}

// Preserve the operation and numeric SDK code, never raw SDK messages (paths, tokens or user data).
class PlatformFailure extends Error {
  code: number;
  constructor(operation: string, code: number, advice: string) {
    super(`${advice}（${operation}，错误码 ${code}）`);
    this.code = code;
  }
}

export function platformFailure(operation: string, error: Error, advice: string): Error {
  return new PlatformFailure(operation, platformCode(error), advice);
}

export function reportPlatformFailure(operation: string, error: Error): void {
  // operation 是稳定的操作名常量，error 只取数值错误码；两者都不含用户数据。
  hilog.error(LOG_DOMAIN, LogTag.Platform, '平台调用失败，操作=%{public}s，错误码=%{public}d', operation, platformCode(error));
}
