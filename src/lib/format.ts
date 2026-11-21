export function formatPaise(paise: number, showDecimals = true): string {
  const absVal = Math.abs(paise) / 100;
  const formatted = absVal.toLocaleString('en-IN', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });
  return `${paise < 0 ? '-' : ''}₹${formatted}`;
}

export function formatPaiseCompact(paise: number): string {
  const rs = paise / 100;
  if (Math.abs(rs) >= 100000) {
    return `₹${(rs / 100000).toFixed(2)}L`;
  }
  return `₹${rs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
