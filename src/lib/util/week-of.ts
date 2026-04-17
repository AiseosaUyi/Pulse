// Returns the Saturday 00:00 UTC of the week containing `date`.
// Cron fires Saturday 23:00 UTC; a retry on Sunday AM must hash to the same week.
export function startOfWeekSaturday(date: Date): Date {
  const d = new Date(date);
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 6=Sat
  const daysBack = (dayOfWeek + 1) % 7;
  d.setUTCDate(d.getUTCDate() - daysBack);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function weekOfIso(date: Date): string {
  return startOfWeekSaturday(date).toISOString();
}
