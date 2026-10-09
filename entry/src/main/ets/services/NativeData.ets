import { abilityAccessCtrl, common, PermissionRequestResult } from '@kit.AbilityKit';
import { calendarManager } from '@kit.CalendarKit';
import { batteryInfo } from '@kit.BasicServicesKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { CalendarEntry, dayKey, validDate } from '../core/Workspace';
import { platformCode, platformFailure } from './PlatformErrors';
import { cleanText, parseTime } from '../core/Domain';

export function deviceSnapshot(): string {
  return `电量 ${batteryInfo.batterySOC}% · 本地时间 ${new Date().toLocaleString()}`;
}

export async function readCalendarEntries(context: common.UIAbilityContext, date: string = dayKey(new Date())): Promise<CalendarEntry[]> {
  if (!validDate(date)) { throw new Error('请输入有效日期 YYYY-MM-DD'); }
  // Reading phone calendar events requires whole-calendar access, not just this app's events.
  let result: PermissionRequestResult;
  try {
    result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, ['ohos.permission.READ_WHOLE_CALENDAR']);
  } catch (error) {
    const advice = platformCode(error as Error) === 12100009 ? '权限窗口暂不可用，请回到前台后重试；仍可使用手动计划' :
      '申请日历权限失败，请检查应用权限设置；仍可使用手动计划';
    throw platformFailure('calendar.permission', error as Error, advice);
  }
  if (!result.authResults.length || result.authResults[0] !== 0) {
    throw new Error('未获得读取手机日历的权限。请在系统设置的 HermesEye 权限中允许读取日历，再刷新；仍可使用手动计划。');
  }
  let calendars: calendarManager.Calendar[];
  try { calendars = await calendarManager.getCalendarManager(context).getAllCalendars(); }
  catch (error) { throw calendarFailure('calendar.list', error as Error); }
  const start = new Date(date + 'T00:00:00');
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  const events: CalendarEntry[] = [];
  for (const calendar of calendars) {
    let entries: calendarManager.Event[];
    try {
      entries = await calendar.queryEventInstances(start.getTime(), end.getTime(), undefined,
        ['id', 'title', 'startTime', 'endTime', 'instanceStartTime', 'instanceEndTime', 'isAllDay']);
    } catch (error) { throw calendarFailure('calendar.instances', error as Error); }
    for (const event of entries) {
      const from = event.instanceStartTime ?? event.startTime;
      const to = event.instanceEndTime ?? event.endTime;
      if (event.id === undefined || !Number.isFinite(from) || !Number.isFinite(to) || to < from) {
        throw new Error('日历返回的标识或时间无效，请稍后刷新');
      }
      if (from >= end.getTime() || to < start.getTime()) { continue; }
      const key = `${calendar.id}/${event.id}/${from}`;
      if (!events.some((item: CalendarEntry) => item.key === key)) {
        events.push({ key: key, title: event.title || '未命名日程', start: from, end: to, allDay: event.isAllDay ?? false });
      }
    }
  }
  return events.sort((a: CalendarEntry, b: CalendarEntry) => a.start - b.start);
}

function calendarFailure(operation: string, error: Error): Error {
  const code = platformCode(error);
  const advice = code === 201 ? '日历权限已拒绝或撤销，请在系统设置中允许读取；仍可使用手动计划' :
    code === 801 ? '此设备不支持日历读取，仍可使用手动计划' : '读取日历失败，请稍后刷新；仍可使用手动计划';
  return platformFailure(operation, error, advice);
}

export function calendarText(events: CalendarEntry[]): string {
  if (!events.length) { return '今日日历暂无日程'; }
  return events.map((event: CalendarEntry) =>
    `${event.allDay ? '全天' : new Date(event.start).toLocaleTimeString() + ' — ' + new Date(event.end).toLocaleTimeString()} ${event.title}`).join('\n');
}

export async function readCalendar(context: common.UIAbilityContext): Promise<string> {
  return calendarText(await readCalendarEntries(context));
}

export async function publishReminder(context: common.UIAbilityContext, title: string, time: string, weekdays: boolean): Promise<number> {
  const parts = parseTime(time);
  const content = cleanText(title, 100);
  try { await notificationManager.requestEnableNotification(context); }
  catch (error) {
    const code = platformCode(error as Error);
    const advice = code === 1600004 ? '通知权限未开启，请在系统设置中允许通知；提醒未注册' :
      code === 1600013 ? '已有通知授权窗口，请完成该窗口后再操作；提醒未注册' : '通知授权失败，提醒未注册';
    throw platformFailure('notification.enable', error as Error, advice);
  }
  const request: reminderAgentManager.ReminderRequestAlarm = {
    reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_ALARM,
    hour: parts[0], minute: parts[1], daysOfWeek: weekdays ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7],
    title: 'HermesEye · 学习与行动提醒', content: content,
    wantAgent: { pkgName: 'com.binn.hermeseye', abilityName: 'EntryAbility' },
    notificationId: Math.floor(Date.now() % 2000000000)
  };
  try { return await reminderAgentManager.publishReminder(request); }
  catch (error) {
    const code = platformCode(error as Error);
    const advice = code === 1700001 || code === 201 ? '提醒或通知权限未开启，请检查系统设置' :
      code === 1700002 ? '系统提醒数量已达上限，请清理旧提醒后重试' : '系统提醒注册失败，请检查系统提醒状态后再操作';
    throw platformFailure('reminder.publish', error as Error, advice);
  }
}

export async function cancelReminder(id: number): Promise<void> {
  try { await reminderAgentManager.cancelReminder(id); }
  catch (error) {
    if (platformCode(error as Error) === 1700003) { return; } // Already cancelled.
    throw platformFailure('reminder.cancel', error as Error, '系统提醒取消失败，请检查系统提醒状态');
  }
}
