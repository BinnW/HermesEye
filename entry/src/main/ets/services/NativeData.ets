import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { calendarManager } from '@kit.CalendarKit';
import { batteryInfo } from '@kit.BasicServicesKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { cleanText, parseTime } from '../core/Domain';

export function deviceSnapshot(): string {
  return `电量 ${batteryInfo.batterySOC}% · 本地时间 ${new Date().toLocaleString()}`;
}

export async function readCalendar(context: common.UIAbilityContext): Promise<string> {
  const result = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, ['ohos.permission.READ_CALENDAR']);
  if (!result.authResults.length || result.authResults[0] !== 0) { throw new Error('日历未授权；可继续使用记录与对话'); }
  const manager = calendarManager.getCalendarManager(context);
  const calendars = await manager.getAllCalendars();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  let events: calendarManager.Event[] = [];
  for (const calendar of calendars) {
    const entries = await calendar.getEvents(calendarManager.EventFilter.filterByTime(start.getTime(), end.getTime()),
      ['title', 'startTime', 'endTime']);
    events = events.concat(entries);
  }
  events.sort((a: calendarManager.Event, b: calendarManager.Event) => a.startTime - b.startTime);
  if (!events.length) { return '今日日历暂无日程'; }
  return events.slice(0, 30).map((event: calendarManager.Event) =>
    `${new Date(event.startTime).toLocaleTimeString()} — ${new Date(event.endTime).toLocaleTimeString()} ${event.title || '未命名日程'}`)
    .join('\n');
}

export async function publishReminder(context: common.UIAbilityContext, title: string, time: string, weekdays: boolean): Promise<number> {
  const parts = parseTime(time);
  const content = cleanText(title, 100);
  await notificationManager.requestEnableNotification(context);
  const request: reminderAgentManager.ReminderRequestAlarm = {
    reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_ALARM,
    hour: parts[0], minute: parts[1], daysOfWeek: weekdays ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7],
    title: 'HermesEye · 秘书提醒', content: content,
    wantAgent: { pkgName: 'com.binn.hermeseye', abilityName: 'EntryAbility' },
    notificationId: Math.floor(Date.now() % 2000000000)
  };
  return reminderAgentManager.publishReminder(request);
}

export async function cancelReminder(id: number): Promise<void> {
  await reminderAgentManager.cancelReminder(id);
}
