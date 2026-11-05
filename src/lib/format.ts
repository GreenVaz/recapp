import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { diffDays, parts, type DateISO } from '@core/dates.js';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const MONTHS_GENITIVE = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];

const MONTHS_NOMINATIVE = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];

export const MONTHS_SHORT = [
  'січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру',
];

export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];

/** «5 листопада» або «5 листопада 2027», якщо рік не поточний. */
export function formatDate(iso: DateISO, today?: DateISO): string {
  const { year, month, day } = parts(iso);
  const sameYear = today ? parts(today).year === year : true;
  return sameYear ? `${day} ${MONTHS_GENITIVE[month - 1]}` : `${day} ${MONTHS_GENITIVE[month - 1]} ${year}`;
}

export function formatMonthTitle(iso: DateISO): string {
  const { year, month } = parts(iso);
  return `${MONTHS_NOMINATIVE[month - 1]} ${year}`;
}

export function formatShortDate(iso: DateISO): string {
  const { month, day } = parts(iso);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

/** «сьогодні», «завтра», «через 8 днів», «прострочено на 3 дні». */
export function formatRelativeDay(iso: DateISO, today: DateISO): string {
  const delta = diffDays(today, iso);
  if (delta === 0) return 'сьогодні';
  if (delta === 1) return 'завтра';
  if (delta === -1) return 'учора';
  if (delta < 0) return `прострочено на ${plural(-delta, 'день', 'дні', 'днів')}`;
  return `через ${plural(delta, 'день', 'дні', 'днів')}`;
}

/** Українські форми числівника: 1 день, 2 дні, 5 днів. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${few}`;
  return `${count} ${many}`;
}

export function pluralWord(count: number, one: string, few: string, many: string): string {
  return plural(count, one, few, many).split(' ').slice(1).join(' ');
}

/**
 * Дуже короткий запис суми для клітинки календаря.
 *
 * На екрані 320px клітинка має близько 40px ширини — туди не влазить навіть
 * «78,5 тис.», і текст обрізається трикрапкою. Тут тисячі позначаються
 * однією літерою, а мільйони — «млн».
 */
export function formatCellAmount(minor: number): string {
  const value = Math.round(minor / 100);
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';

  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')}млн`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1000)}к`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1).replace('.', ',')}к`;
  return `${sign}${abs}`;
}
