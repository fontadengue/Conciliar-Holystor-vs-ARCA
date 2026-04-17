import { useState } from 'react';
import { 
  FileUp, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  ArrowRight,
  RefreshCw,
  Search,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from './lib/utils';
import { 
  extractTextFromPdf, 
  parseHolystor, 
  parseMisComprobantes, 
  type CpteData 
} from './services/pdfParser';

interface ComparisonResult {
  numero: string;
  holystor?: CpteData;
  afip?: CpteData;
  diffs: {
    neto: number;
    iva: number;
    tributos: number;
    total: number;
    noGravado: number;
    exento: number;
  };
  status: 'match' | 'mismatch' | 'missing_afip' | 'missing_holystor';
}

export default function App() {
  const [holystorFile, setHolystorFile] = useState<File | null>(null);
  const [afipFile, setAfipFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'mismatch' | 'missing'>('all');

  const handleFileUpload = (type: 'holystor' | 'afip', file: File) => {
    if (type === 'holystor') setHolystorFile(file);
    else setAfipFile(file);
    setError(null);
  };

  const processFiles = async () => {
    if (!holystorFile || !afipFile) {
      setError('Por favor, selecciona ambos archivos PDF.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const hText = await extractTextFromPdf(holystorFile);
      const aText = await extractTextFromPdf(afipFile);

      const hData = parseHolystor(hText);
      const aData = parseMisComprobantes(aText);

      if (hData.length === 0) throw new Error('No se detectaron comprobantes en el archivo de Holystor. Verifica el formato.');
      if (aData.length === 0) throw new Error('No se detectaron comprobantes en el archivo de Mis Comprobantes. Verifica el formato.');

      const comparison: ComparisonResult[] = [];
      const allNumbers = new Set([
        ...hData.map(d => d.numero),
        ...aData.map(d => d.numero)
      ]);

      allNumbers.forEach(num => {
        const h = hData.find(d => d.numero === num);
        const a = aData.find(d => d.numero === num);

        if (h && a) {
          const dNeto = Math.abs(h.neto - a.neto);
          const dIva = Math.abs(h.iva - a.iva);
          
          // Field mapping based on PDF layout: 
          // Holystor column 2 (h.noGravado) groups AFIP's "No Gravado" and "Otros Tributos"
          const afipAdjustments = a.noGravado + a.tributos;
          const dAdjustments = Math.abs(h.noGravado - afipAdjustments);
          
          const dExento = Math.abs(h.exento - a.exento);
          const dTotal = Math.abs(h.total - a.total);
          
          const isMatch = dNeto < 1 && dIva < 1 && dAdjustments < 1 && dTotal < 1 && dExento < 1;

          comparison.push({
            numero: num,
            holystor: h,
            afip: a,
            diffs: {
              neto: dNeto,
              iva: dIva,
              tributos: dAdjustments, // Representing the adjustment column diff
              total: dTotal,
              noGravado: dAdjustments, 
              exento: dExento
            },
            status: isMatch ? 'match' : 'mismatch'
          });
        } else if (h) {
          comparison.push({
            numero: num,
            holystor: h,
            diffs: { neto: 0, iva: 0, tributos: 0, total: 0, noGravado: 0, exento: 0 },
            status: 'missing_afip'
          });
        } else if (a) {
          comparison.push({
            numero: num,
            afip: a,
            diffs: { neto: 0, iva: 0, tributos: 0, total: 0, noGravado: 0, exento: 0 },
            status: 'missing_holystor'
          });
        }
      });

      comparison.sort((a, b) => {
        const dateA = a.holystor?.fecha || a.afip?.fecha || '';
        const dateB = b.holystor?.fecha || b.afip?.fecha || '';
        return dateB.localeCompare(dateA);
      });

      setResults(comparison);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Error desconocido al procesar los archivos.');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredResults = results.filter(r => {
    if (filter === 'mismatch') return r.status === 'mismatch';
    if (filter === 'missing') return r.status.startsWith('missing');
    return true;
  });

  const stats = {
    total: results.length,
    matches: results.filter(r => r.status === 'match').length,
    mismatches: results.filter(r => r.status === 'mismatch').length,
    missing: results.filter(r => r.status.startsWith('missing')).length,
    totalNeto: results.reduce((acc, curr) => acc + (curr.holystor?.neto || curr.afip?.neto || 0), 0)
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#333] font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-[#e1e4e8] pb-4">
          <h1 className="text-2xl font-bold text-[#1a3a5f]">
            Auditoría Holystor vs. AFIP
          </h1>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                setHolystorFile(null);
                setAfipFile(null);
                setResults([]);
                setError(null);
              }}
              className="text-xs font-semibold px-4 py-2 bg-white border border-[#d1d9e6] rounded text-[#5f6368] hover:bg-gray-50 transition-colors"
            >
              Reiniciar
            </button>
            <button
              disabled={!holystorFile || !afipFile || isProcessing}
              onClick={processFiles}
              className={cn(
                "bg-[#2b6cb0] text-white px-6 py-2 rounded font-semibold text-sm transition-all shadow-sm",
                (!holystorFile || !afipFile || isProcessing) ? "opacity-50 cursor-not-allowed" : "hover:bg-[#1e4e8c] active:translate-y-px"
              )}
            >
              {isProcessing ? "Procesando..." : "Iniciar Comparación"}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <UploadCard 
            id="holystor-upload"
            label="Reporte Holystor"
            subLabel="📄 Libro IVA Ventas"
            file={holystorFile}
            onFileSelect={(f) => handleFileUpload('holystor', f)}
          />

          <UploadCard 
            id="afip-upload"
            label="Mis Comprobantes (AFIP)"
            subLabel="🏛️ Portal AFIP"
            file={afipFile}
            onFileSelect={(f) => handleFileUpload('afip', f)}
          />
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="p-4 bg-[#fed7d7] border border-[#feb2b2] text-[#822727] rounded-md text-sm flex items-center gap-3"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="font-medium">{error}</p>
          </motion.div>
        )}

        <AnimatePresence>
          {results.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="bg-[#1a3a5f] text-white rounded-lg p-6 shadow-md flex flex-wrap justify-around items-center gap-8">
                <StatItem label="Analizados" value={stats.total} />
                <StatItem label="Coinciden" value={stats.matches} color="#c6f6d5" />
                <StatItem label="Discrepancias" value={stats.mismatches} color="#feb2b2" />
                <StatItem label="Total Neto" value={formatCurrency(stats.totalNeto)} />
              </div>

              <div className="bg-white border border-[#d1d9e6] rounded-lg shadow-sm overflow-hidden flex flex-col p-4 md:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold uppercase text-[#5f6368] flex items-center gap-2">
                    Resultados de Conciliación
                  </div>
                  <div className="flex gap-2">
                    <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>Todos</FilterButton>
                    <FilterButton active={filter === 'mismatch'} color="red" onClick={() => setFilter('mismatch')}>Errores</FilterButton>
                    <FilterButton active={filter === 'missing'} color="orange" onClick={() => setFilter('missing')}>Faltantes</FilterButton>
                  </div>
                </div>

                <div className="border border-[#e2e8f0] rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px] font-mono leading-tight">
                      <thead className="bg-[#f1f5f9] sticky top-0">
                        <tr className="text-[#4a5568]">
                          <th className="px-3 py-3 font-semibold border-b-2 border-[#e2e8f0]">Número</th>
                          <th className="px-3 py-3 font-semibold border-b-2 border-[#e2e8f0]">Estado</th>
                          <th className="px-3 py-3 font-semibold border-b-2 border-[#e2e8f0]">Neto (H/A)</th>
                          <th className="px-3 py-3 font-semibold border-b-2 border-[#e2e8f0]">IVA (H/A)</th>
                          <th className="px-3 py-3 font-semibold border-b-2 border-[#e2e8f0]">Otros/Trib (H/A)</th>
                          <th className="px-3 py-3 font-semibold border-b-2 border-[#e2e8f0]">Total (H/A)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredResults.map((res, i) => (
                          <tr key={res.numero} className="hover:bg-[#f8fafc] border-b border-[#edf2f7] transition-colors odd:bg-white even:bg-[#fafafa]">
                            <td className="px-3 py-3 font-medium text-[#1a3a5f]">{res.numero}</td>
                            <td className="px-3 py-3">
                              <StatusBadge status={res.status} />
                            </td>
                            <td className={cn("px-3 py-3", res.diffs.neto > 1 && "text-[#e53e3e] font-bold bg-red-50/50")}>
                              <div className="flex flex-col">
                                <span>H: {formatCurrency(res.holystor?.neto ?? 0)}</span>
                                <span>A: {formatCurrency(res.afip?.neto ?? 0)}</span>
                              </div>
                            </td>
                            <td className={cn("px-3 py-3", res.diffs.iva > 1 && "text-[#e53e3e] font-bold bg-red-50/50")}>
                              <div className="flex flex-col">
                                <span>H: {formatCurrency(res.holystor?.iva ?? 0)}</span>
                                <span>A: {formatCurrency(res.afip?.iva ?? 0)}</span>
                              </div>
                            </td>
                            <td className={cn("px-3 py-3", res.diffs.tributos > 1 && "text-[#e53e3e] font-bold bg-red-50/50")}>
                              <div className="flex flex-col">
                                <span>H: {formatCurrency(res.holystor?.noGravado ?? 0)}</span>
                                <span>A: {formatCurrency((res.afip?.noGravado ?? 0) + (res.afip?.tributos ?? 0))}</span>
                              </div>
                            </td>
                            <td className={cn("px-3 py-3", res.diffs.total > 1 && "text-[#e53e3e] font-bold bg-red-50/50 underline underline-offset-2")}>
                              <div className="flex flex-col text-[12px]">
                                <span>H: {formatCurrency(res.holystor?.total ?? 0)}</span>
                                <span>A: {formatCurrency(res.afip?.total ?? 0)}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {results.length === 0 && !isProcessing && (
          <div className="flex flex-col items-center justify-center py-20 bg-white border-2 border-dashed border-[#cbd5e0] rounded-lg">
            <FileText className="w-12 h-12 text-[#cbd5e0] mb-4" />
            <h3 className="text-lg font-bold text-[#1a3a5f]">Auditoría lista</h3>
            <p className="text-sm text-[#718096]">Sube los archivos PDF para comenzar el análisis.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadCard({ id, label, subLabel, file, onFileSelect }: any) {
  return (
    <div id={id} className={cn(
      "bg-white rounded-lg p-6 border shadow-sm flex flex-col transition-all",
      file ? "border-[#2b6cb0]" : "border-[#d1d9e6]"
    )}>
      <div className="text-[12px] font-bold uppercase text-[#5f6368] mb-3 flex items-center gap-2">
        {subLabel}
      </div>
      <h3 className="text-lg font-bold text-[#1a3a5f] mb-4">{label}</h3>
      
      {file ? (
        <div className="bg-[#f8fafc] border border-[#cbd5e0] rounded p-4 flex items-center gap-3">
          <div className="text-2xl">📁</div>
          <div className="flex flex-col truncate">
            <span className="text-sm font-semibold truncate text-[#1a3a5f]">{file.name}</span>
            <span className="text-[11px] text-[#718096]">{(file.size / 1024 / 1024).toFixed(2)} MB • Procesado</span>
          </div>
        </div>
      ) : (
        <label className="border-2 border-dashed border-[#cbd5e0] rounded-lg p-6 bg-[#f8fafc] cursor-pointer hover:bg-[#edf2f7] transition-all flex flex-col items-center gap-2">
          <input type="file" accept=".pdf" className="hidden" onChange={(e: any) => e.target.files?.[0] && onFileSelect(e.target.files[0])} />
          <FileUp className="w-8 h-8 text-[#718096]" />
          <span className="text-xs font-bold uppercase tracking-wider text-[#718096]">Seleccionar Archivo</span>
        </label>
      )}
    </div>
  );
}

function StatItem({ label, value, color }: any) {
  return (
    <div className="text-center">
      <span className="text-[11px] font-bold uppercase opacity-80 mb-1 block tracking-wider">{label}</span>
      <span className="text-2xl font-bold block" style={{ color: color || "white" }}>{value}</span>
    </div>
  );
}

function FilterButton({ children, active, color, onClick }: any) {
  const base = "text-[11px] font-bold uppercase px-3 py-1.5 rounded transition-all";
  if (active) {
    const bg = color === 'red' ? 'bg-[#e53e3e]' : color === 'orange' ? 'bg-[#f6993f]' : 'bg-[#1a3a5f]';
    return <button className={cn(base, bg, "text-white shadow-sm")}>{children}</button>;
  }
  return <button onClick={onClick} className={cn(base, "text-[#5f6368] hover:bg-[#edf2f7]")}>{children}</button>;
}

function StatusBadge({ status }: { status: string }) {
  const config: any = {
    match: { text: 'Coincide', className: 'bg-[#c6f6d5] text-[#22543d]' },
    mismatch: { text: 'Error', className: 'bg-[#fed7d7] text-[#822727]' },
    missing_afip: { text: 'No en AFIP', className: 'bg-[#feebc8] text-[#744210]' },
    missing_holystor: { text: 'No en Holy', className: 'bg-[#feebc8] text-[#744210]' }
  };
  const { text, className } = config[status] || { text: status, className: 'bg-gray-100' };
  return <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase", className)}>{text}</span>;
}

function getStatusText(status: string) {
  switch (status) {
    case 'match': return 'Ok';
    case 'mismatch': return 'Diferencia';
    case 'missing_afip': return 'Falta en AFIP';
    case 'missing_holystor': return 'Falta en Holystor';
    default: return '';
  }
}
