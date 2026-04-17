import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(value);
}

export function parseArgentineNumber(str: string): number {
  if (!str) return 0;
  
  // Detect negative before cleaning: check for either parentheses OR minus sign
  // Very important: OCR often misses one of the parentheses or splits them.
  const isNegative = str.includes('(') || str.includes(')') || str.includes('-');

  // Remove currency symbol, spaces, parentheses and signs
  let clean = str.replace(/[$\s()\-]/g, '');
  
  // If it has both , and . - check which one is the decimal separator
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  
  if (lastComma > lastDot) {
    // Argentine Standard: 1.234,56 (Comma is decimal)
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // US Standard or OCR'd Argentine with no thousands: 1,234.56 or 1234.56 or 1.234
    // If the part after the dot has exactly 2 digits, it's very likely a decimal
    const parts = clean.split('.');
    if (parts.length === 2 && parts[1].length === 2) {
      clean = clean.replace(/,/g, '');
    } else {
      // Otherwise assume dots are just thousand separators (common in some prints)
      clean = clean.replace(/[,.]/g, '');
    }
  } else {
    // Only one type of separator or none
    clean = clean.replace(/,/g, '.');
  }
  
  const val = parseFloat(clean);
  if (isNaN(val)) return 0;
  return isNegative ? -Math.abs(val) : val;
}
