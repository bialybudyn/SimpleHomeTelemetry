/**
 * Europejski format daty (DD.MM.YYYY) i zegar 24-godzinny (HH:mm / HH:mm:ss)
 * Gwarantuje spójność niezależnie od lokalnych ustawień przeglądarki użytkownika.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formatuje datę i czas w standardzie europejskim 24h: DD.MM.YYYY HH:mm:ss (lub bez sekund)
 */
export function formatEuropeanDateTime(
  value: string | number | Date | null | undefined,
  includeSeconds = true,
): string {
  if (!value) return '';
  const d = typeof value === 'object' && value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);

  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  if (includeSeconds) {
    const seconds = pad(d.getSeconds());
    return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
  }
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Formatuje tylko datę w standardzie europejskim: DD.MM.YYYY
 */
export function formatEuropeanDate(value: string | number | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'object' && value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);

  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Formatuje tylko czas w formacie 24h: HH:mm lub HH:mm:ss
 */
export function format24hTime(
  value: string | number | Date | null | undefined,
  includeSeconds = false,
): string {
  if (!value) return '';
  const d = typeof value === 'object' && value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);

  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  if (includeSeconds) {
    const seconds = pad(d.getSeconds());
    return `${hours}:${minutes}:${seconds}`;
  }
  return `${hours}:${minutes}`;
}

/**
 * Formatuje etykietę osi wykresów: dla krótkich zakresów HH:mm, dla dłuższych DD.MM HH:mm
 */
export function formatChartTimeLabel(timestamp: string, range: string): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return timestamp;

  const time24 = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (range === '6h' || range === '24h') {
    return time24;
  }
  const dateShort = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  return `${dateShort} ${time24}`;
}
