import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { calendarManager } from '@kit.CalendarKit';
import { batteryInfo } from '@kit.BasicServicesKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { CalendarEntry, dayKey, validDate } from '../core/Workspace';
import { cleanText, parseTime } from '../core/Domain';

export function deviceSnapshot(): string {
  return `电量 ${batteryInfo.batterySOC}% · 本地时间 ${new Date().toLocaleString()}`;
}

export async function readCalendarEntries(context: common.UIAbilityContext, date: string = dayKey(new Date())): Promise<CalendarEntry[]> {
  if (!validDate(date)) { throw new Error('请输入有效日期 YYYY-MM-DD'); }
  // Reading phone calendar events requires whole-calendar access, not just this app's events.
  const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, ['ohos.permission.READ_WHOLE_CALENDAR']);
  if (!result.authResults.length || result.authResults[0] !== 0) {
    throw new Error('未获得读取手机日历的权限。请在系统设置的 HermesEye 权限中允许读取日历，再刷新；仍可使用手动计划。');
  }
  const manager = calendarManager.getCalendarManager(context);
  const calendars = await manager.getAllCalendars();
  const start = new Date(date + 'T00:00:00');
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  const events: CalendarEntry[] = [];
  for (const calendar of calendars) {
    const entries = await calendar.queryEventInstances(start.getTime(), end.getTime(), undefined,
      ['id', 'title', 'startTime', 'endTime', 'instanceStartTime', 'instanceEndTime', 'isAllDay']);
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
  await notificationManager.requestEnableNotification(context);
  const request: reminderAgentManager.ReminderRequestAlarm = {
    reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_ALARM,
    hour: parts[0], minute: parts[1], daysOfWeek: weekdays ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7],
    title: 'HermesEye · 学习与行动提醒', content: content,
    wantAgent: { pkgName: 'com.binn.hermeseye', abilityName: 'EntryAbility' },
    notificationId: Math.floor(Date.now() % 2000000000)
  };
  return reminderAgentManager.publishReminder(request);
}

export async function cancelReminder(id: number): Promise<void> {
  await reminderAgentManager.cancelReminder(id);
}
