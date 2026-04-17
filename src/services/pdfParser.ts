import * as pdfjsLib from 'pdfjs-dist';
import { parseArgentineNumber } from '../lib/utils';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface CpteData {
  fecha: string;
  tipo: string;
  numero: string;
  neto: number;
  noGravado: number;
  exento: number;
  tributos: number;
  iva: number;
  total: number;
  raw: string;
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    
    // Sort items by transform[5] (Y coordinate, descending) and then transform[4] (X coordinate)
    const items = (content.items as any[]).sort((a, b) => {
      // Use a small tolerance for Y to group slightly offset items into the same line
      const diffY = Math.abs(a.transform[5] - b.transform[5]);
      if (diffY < 3) {
        return a.transform[4] - b.transform[4];
      }
      return b.transform[5] - a.transform[5];
    });

    let lastY = -1;
    let pageText = '';
    for (const item of items) {
      if (lastY !== -1 && Math.abs(item.transform[5] - lastY) >= 3) {
        pageText += '\n';
      }
      pageText += item.str + ' ';
      lastY = item.transform[5];
    }
    fullText += pageText + '\n';
  }

  return fullText;
}

export function parseHolystor(text: string): CpteData[] {
  const results: CpteData[] = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;

    // Detect basic structure: Date and Voucher Number
    const dateMatch = line.match(/(\d{2}[/\-]\d{2}[/\-]\d{4})/);
    const numMatch = line.match(/(\d{5})\s*-\s*(\d{8})/);
    
    if (dateMatch && numMatch) {
      const fecha = dateMatch[1];
      const numeroRaw = `${numMatch[1]}-${numMatch[2]}`;
      
      // Separate only the part where amounts usually reside (after voucher number)
      const idxOfNum = line.indexOf(numMatch[2]);
      if (idxOfNum === -1) continue;
      const searchRegion = line.substring(idxOfNum + numMatch[2].length);

      // Money regex: captures digits with dots/commas, optionally inside parentheses or leading minus
      // NO spaces inside the numeric part to avoid merging separate columns
      const moneyRegex = /[(\-]?\s*\d[\d.,]*\d\s*[)\-]?|[(\-]?\s*\d\s*[)\-]?/g;
      const allNumbers = searchRegion.match(moneyRegex)?.map(m => m.trim()) || [];
      
      if (allNumbers.length >= 5) {
        // Holystor layout ends with 5 numeric columns: Neto, Ret/NoGrav, IVA, Exento, Total
        const amounts = allNumbers.slice(-5);
        
        // Broaden NC detection
        const isNC = /N\/C|NOTA|CRED|NC|N\.C\./i.test(line);
        
        let neto = parseArgentineNumber(amounts[0]);
        let noGravado = parseArgentineNumber(amounts[1]);
        let iva = parseArgentineNumber(amounts[2]);
        let exento = parseArgentineNumber(amounts[3]);
        let total = parseArgentineNumber(amounts[4]);

        if (isNC) {
          neto = -Math.abs(neto);
          noGravado = -Math.abs(noGravado);
          iva = -Math.abs(iva);
          exento = -Math.abs(exento);
          total = -Math.abs(total);
        }

        results.push({
          fecha,
          tipo: isNC ? 'N/C' : 'FACTURA',
          numero: numeroRaw,
          neto,
          noGravado,
          exento,
          tributos: 0,
          iva,
          total,
          raw: line
        });
      }
    }
  }
  
  return results;
}

export function parseMisComprobantes(text: string): CpteData[] {
  const results: CpteData[] = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;

    const dateMatch = line.match(/(\d{2}[/\-]\d{2}[/\-]\d{4})/);
    const numMatch = line.match(/(\d{5})\s*-\s*(\d{8})/);
    
    if (dateMatch && numMatch) {
      const fecha = dateMatch[1];
      const numeroRaw = `${numMatch[1]}-${numMatch[2]}`;
      
      // AFIP amounts are always prefixed with $ or appear strictly as the last 6 columns
      // NO spaces inside the numeric part to avoid merging separate columns
      const moneyRegex = /[(\-]?\s*\$?\s*\d[\d.,]*\d\s*[)\-]?|[(\-]?\s*\$?\s*\d\s*[)\-]?/g;
      const allNumbers = line.match(moneyRegex)?.map(m => m.trim()) || [];
      
      if (allNumbers.length >= 6) {
        // Correct NC logic for AFIP (Mis Comprobantes)
        const isNC = /NOTA|CRED|N\/C|NC|N\.C\.|\b(3|8|13|103|106|112)\b/i.test(line);
        const amounts = allNumbers.slice(-6);

        let neto = parseArgentineNumber(amounts[0]);
        let noGravado = parseArgentineNumber(amounts[1]);
        let exento = parseArgentineNumber(amounts[2]);
        let tributos = parseArgentineNumber(amounts[3]);
        let iva = parseArgentineNumber(amounts[4]);
        let total = parseArgentineNumber(amounts[5]);
        
        // Ensure all numeric fields are negative for NC
        if (isNC) {
          neto = -Math.abs(neto);
          noGravado = -Math.abs(noGravado);
          exento = -Math.abs(exento);
          tributos = -Math.abs(tributos);
          iva = -Math.abs(iva);
          total = -Math.abs(total);
        }
        
        results.push({
          fecha,
          tipo: isNC ? 'N/C' : 'FACTURA',
          numero: numeroRaw,
          neto,
          noGravado,
          exento,
          tributos,
          iva,
          total,
          raw: line
        });
      }
    }
  }
  
  return results;
}
