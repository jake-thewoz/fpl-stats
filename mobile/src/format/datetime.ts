/** Deadline and kickoff formatting in the viewer's locale and timezone. */

/** e.g. "Fri, Oct 17, 6:30 PM". Unparseable input comes back as-is. */
export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** e.g. "Sat 3:00 PM"; "TBD" when FPL hasn't scheduled it. */
export function formatKickoff(iso: string | null): string {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
