/**
 * SyncPage — /admin/sync
 * Módulo de administración: Alta manual de socios y carga masiva CSV/Excel.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Upload, Users, CheckCircle2, AlertCircle, Loader2, X, Database,
  RefreshCw, ChevronRight, ArrowLeft, UserPlus, FileSpreadsheet,
  Check, ShieldCheck
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import Header from '../../components/layout/Header'
import SiitecCard from '../../components/layout/SiitecCard'
import { supabase } from '../../lib/supabase'

// ── Configuración de importación exclusivamente para Socios ──────
const IMPORT_TYPES = {
  students: {
    label:       'Socios',
    icon:        <Users size={20}/>,
    table:       'students',
    fields:      ['matricula', 'full_name', 'career'],
    required:    ['matricula', 'full_name'],
    conflictKey: 'matricula',
    example:     'matricula,full_name,career\nSOC-001,García López Juan,Membresía Black\nSOC-002,Martínez Ana,Membresía Básica',
  },
}

const DEFAULT_MEMBERSHIPS = [
  'Membresía Mensual',
  'Pase Libre',
  'Membresía VIP',
  'Membresía Anual',
  'Membresía Básica',
  'Estudiante / Convenio',
]

// ── Parsear archivo CSV o Excel ──────────────────────────────────
async function parseFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase()

    if (ext === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_'),
        complete: (result) => resolve(result.data),
        error:    (err)    => reject(err),
      })
    } else if (['xlsx', 'xls', 'ods'].includes(ext)) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const wb      = XLSX.read(e.target.result, { type: 'array' })
          const ws      = wb.Sheets[wb.SheetNames[0]]
          const data    = XLSX.utils.sheet_to_json(ws, { defval: '' })
          const cleaned = data.map(row => {
            const out = {}
            Object.entries(row).forEach(([k, v]) => {
              out[k.trim().toLowerCase().replace(/\s+/g, '_')] = v
            })
            return out
          })
          resolve(cleaned)
        } catch (err) {
          reject(err)
        }
      }
      reader.readAsArrayBuffer(file)
    } else {
      reject(new Error(`Formato no soportado: .${ext}. Usa CSV, XLSX o XLS.`))
    }
  })
}

// ── Componente DropZone ──────────────────────────────────────────
function DropZone({ onFile, accept, disabled }) {
  const inputRef  = useRef(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }, [onFile])

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`
        border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
        transition-all duration-200
        ${dragging
          ? 'border-yellow-400 bg-yellow-500/10'
          : 'border-zinc-700 hover:border-yellow-500/50 hover:bg-zinc-800/50'}
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <Upload size={32} className={`mx-auto mb-3 ${dragging ? 'text-yellow-400' : 'text-zinc-600'}`} />
      <p className="text-zinc-400 text-sm font-medium">
        {dragging ? 'Suelta el archivo aquí' : 'Arrastra un archivo CSV o Excel'}
      </p>
      <p className="text-zinc-600 text-xs mt-1">o haz clic para seleccionar</p>
      <p className="text-zinc-700 text-xs mt-3">.csv · .xlsx · .xls</p>
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────────
export default function SyncPage() {
  const navigate = useNavigate()

  // ── Modo de operación: 'manual' (Alta Manual) o 'bulk' (Carga Masiva) ──
  const [activeTab, setActiveTab] = useState('manual')

  // ── Estados para Alta Manual ──
  const [manualClave,      setManualClave]      = useState('')
  const [manualNombre,     setManualNombre]     = useState('')
  const [manualMembresia,  setManualMembresia]  = useState('Membresía Mensual')
  const [customMembresia,  setCustomMembresia]  = useState('')
  const [manualExpiration, setManualExpiration] = useState('')
  const [manualIsActive,   setManualIsActive]   = useState(true)
  const [manualSaving,     setManualSaving]     = useState(false)
  const [manualFeedback,   setManualFeedback]   = useState(null) // { success: boolean, message: string }

  // ── Estados para Carga Masiva ──
  const [selectedType, setSelectedType] = useState('students')
  const [file,         setFile]         = useState(null)
  const [allData,      setAllData]      = useState(null)
  const [preview,      setPreview]      = useState(null)
  const [parseError,   setParseError]   = useState(null)
  const [importing,    setImporting]    = useState(false)
  const [result,       setResult]       = useState(null)

  // ── Métrica global ──
  const [dbStats,      setDbStats]      = useState(null)
  const [isOnline]                      = useState(navigator.onLine)

  // ── Cargar únicamente métricas de Socios ─────────────────────
  const loadStats = useCallback(async () => {
    try {
      const { count: stu } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })

      setDbStats({ students: stu })
    } catch { /* stats opcionales */ }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  // ── Manejador de Alta Manual de Socio ────────────────────────
  const handleManualSubmit = async (e) => {
    e.preventDefault()
    setManualFeedback(null)

    const clave = manualClave.trim().toUpperCase()
    const nombre = manualNombre.trim()
    const membresiaFinal = (manualMembresia === '__custom__' ? customMembresia.trim() : manualMembresia) || 'Membresía General'

    if (!clave || !nombre) {
      setManualFeedback({
        success: false,
        message: 'El ID / Clave de Socio y el Nombre Completo son obligatorios.'
      })
      return
    }

    setManualSaving(true)
    try {
      // 1. Validar que la clave no exista previamente en la tabla students
      const { data: existing, error: checkError } = await supabase
        .from('students')
        .select('id, matricula')
        .eq('matricula', clave)
        .maybeSingle()

      if (checkError) {
        throw new Error(`Error al validar clave: ${checkError.message}`)
      }

      if (existing) {
        throw new Error(`Ya existe un socio registrado con el ID / Clave "${clave}".`)
      }

      // 2. Insertar directamente el nuevo registro en Supabase
      const insertPayload = {
        matricula: clave,
        full_name: nombre,
        career:    membresiaFinal,
        is_active: manualIsActive
      }

      if (manualExpiration) {
        insertPayload.expiration_date = new Date(`${manualExpiration}T23:59:59`).toISOString()
      }

      const { error: insertError } = await supabase
        .from('students')
        .insert([insertPayload])

      if (insertError) {
        throw new Error(insertError.message || 'Error al guardar el socio en la base de datos.')
      }

      // 3. Confirmación exitosa y limpieza del formulario
      setManualFeedback({
        success: true,
        message: `Socio "${nombre}" (${clave}) registrado con éxito.`
      })
      setManualClave('')
      setManualNombre('')
      setManualMembresia('Membresía Mensual')
      setCustomMembresia('')
      setManualExpiration('')
      setManualIsActive(true)

      // Actualizar contador
      await loadStats()
    } catch (err) {
      setManualFeedback({
        success: false,
        message: err.message || 'Error desconocido al registrar el socio.'
      })
    } finally {
      setManualSaving(false)
    }
  }

  // ── Manejador de Archivos para Carga Masiva ───────────────────
  const handleFile = useCallback(async (f) => {
    setFile(f)
    setPreview(null)
    setAllData(null)
    setParseError(null)
    setResult(null)
    try {
      const data = await parseFile(f)
      setAllData(data)
      setPreview(data.slice(0, 50))
    } catch (err) {
      setParseError(err.message)
    }
  }, [])

  // ── Ejecutar importación masiva de Socios ─────────────────────
  const handleImport = useCallback(async () => {
    const records = allData || preview
    if (!records || records.length === 0) return
    setImporting(true)
    setResult(null)

    const cfg = IMPORT_TYPES.students
    const errors = []
    let successCount = 0

    try {
      const BATCH = 20
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH).map((row) => {
          const out = {}

          cfg.fields.forEach(f => {
            const val = row[f]
            if (val === undefined || val === '') return
            out[f] = val
          })

          delete out.id
          const rawActive = row['is_active'] ?? row['activo'] ?? row['active']
          out.is_active = (rawActive === false || rawActive === 'false' || rawActive === 0 || rawActive === '0') ? false : true

          // Encabezados alternativos
          if (!out.matricula) {
            out.matricula = (row['id_socio'] || row['clave_socio'] || row['clave'] || row['id'] || '').toString().trim()
          }
          if (!out.full_name) {
            out.full_name = (row['nombre'] || row['nombre_completo'] || row['socio'] || '').toString().trim()
          }
          if (!out.career) {
            out.career = (row['membresia'] || row['tipo_membresia'] || row['tipo_de_membresia'] || row['plan'] || '').toString().trim()
          }
          if (row['expiration_date'] || row['fecha_vencimiento'] || row['vencimiento']) {
            out.expiration_date = row['expiration_date'] || row['fecha_vencimiento'] || row['vencimiento']
          }

          return out
        })

        const invalidRows = batch
          .map((row, idx) => {
            const missing = cfg.required.filter(req =>
              row[req] === undefined || row[req] === null || row[req] === ''
            )
            return missing.length > 0
              ? `Fila ${i + idx + 2}: faltan campos (${missing.join(', ')})`
              : null
          })
          .filter(Boolean)

        if (invalidRows.length > 0) {
          invalidRows.forEach(e => errors.push(e))
          continue
        }

        const { data, error } = await supabase
          .from(cfg.table)
          .upsert(batch, { onConflict: cfg.conflictKey, ignoreDuplicates: false })
          .select()

        if (error) {
          errors.push(`Lote ${Math.floor(i/BATCH)+1}: ${error.message}`)
        } else {
          successCount += data?.length || batch.length
        }
      }

      setResult({ success: errors.length === 0, errors, count: successCount })
      await loadStats()
    } catch (err) {
      setResult({ success: false, errors: [err.message], count: 0 })
    } finally {
      setImporting(false)
    }
  }, [allData, preview, loadStats])

  const resetBulk = () => {
    setFile(null)
    setPreview(null)
    setAllData(null)
    setParseError(null)
    setResult(null)
  }

  return (
    <div className="min-h-screen bg-[#181818]">
      <Header isOnline={isOnline} title="Administración de Socios" />

      <main className="pt-14 px-4 pb-8 max-w-screen-lg mx-auto">
        <div className="py-6">
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => navigate('/admin/sync')}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Panel de Administración"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-white font-extrabold text-xl sm:text-2xl flex items-center gap-2">
              <Database size={22} className="text-yellow-400" />
              Administración de Socios
            </h1>
          </div>
          <p className="text-zinc-400 text-sm ml-7">
            Gestiona el padrón de socios del gimnasio: registro manual individual o importación en lote
          </p>
        </div>

        {/* Métrica de Socios Activos */}
        {dbStats && (
          <div className="mb-6 max-w-xs">
            <div className="bg-[#282828] border border-zinc-700 rounded-xl p-4 flex items-center justify-between shadow-md">
              <div>
                <div className="flex items-center gap-1.5 text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  <Users size={14} className="text-yellow-400" />
                  <span>Socios Registrados</span>
                </div>
                <p className="text-white font-black text-3xl">{dbStats.students ?? '—'}</p>
              </div>
              <div className="w-11 h-11 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center justify-center text-yellow-400">
                <Users size={22} />
              </div>
            </div>
          </div>
        )}

        {/* ── 1. Selector de Modo: Tabs / Toggle Buttons ── */}
        <div className="flex items-center gap-2 mb-6 border-b border-zinc-800 pb-3">
          <button
            type="button"
            onClick={() => { setActiveTab('manual'); setManualFeedback(null) }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
              activeTab === 'manual'
                ? 'bg-yellow-400 text-black shadow-lg shadow-yellow-400/10'
                : 'bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-700'
            }`}
          >
            <UserPlus size={16} />
            <span>Alta Manual de Socio</span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('bulk'); resetBulk() }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
              activeTab === 'bulk'
                ? 'bg-yellow-400 text-black shadow-lg shadow-yellow-400/10'
                : 'bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-700'
            }`}
          >
            <FileSpreadsheet size={16} />
            <span>Carga Masiva (CSV/Excel)</span>
          </button>
        </div>

        {/* ── 2. PESTAÑA: ALTA MANUAL DE SOCIO ── */}
        {activeTab === 'manual' && (
          <div className="max-w-xl animate-fade-in">
            <div className="bg-[#242424] border border-zinc-700 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-3 pb-4 mb-5 border-b border-zinc-700/80">
                <div className="w-10 h-10 rounded-xl bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center text-yellow-400">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h2 className="text-white font-bold text-base">Registrar Nuevo Socio</h2>
                  <p className="text-zinc-400 text-xs">Captura los datos del socio para habilitar su acceso inmediato en el kiosco</p>
                </div>
              </div>

              {/* Feedback Alert */}
              {manualFeedback && (
                <div className={`mb-5 p-4 rounded-xl border flex items-start gap-3 animate-fade-in ${
                  manualFeedback.success
                    ? 'bg-green-500/10 border-green-500/30 text-green-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}>
                  {manualFeedback.success ? (
                    <CheckCircle2 size={18} className="text-green-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
                  )}
                  <p className="text-xs sm:text-sm leading-snug">{manualFeedback.message}</p>
                </div>
              )}

              <form onSubmit={handleManualSubmit} className="space-y-4">
                {/* ID / Clave de Socio */}
                <div>
                  <label className="block text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-1.5">
                    ID / Clave de Socio <span className="text-yellow-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={manualClave}
                    onChange={(e) => setManualClave(e.target.value.toUpperCase())}
                    placeholder="Ej. SOC-001 o 2024001"
                    className="w-full bg-[#181818] border border-zinc-700 rounded-xl px-3.5 py-2.5 text-white text-sm font-mono placeholder-zinc-500 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400/50"
                  />
                  <p className="text-zinc-500 text-[11px] mt-1">Este identificador único se usará en el Pad Numérico o lector del kiosco.</p>
                </div>

                {/* Nombre Completo */}
                <div>
                  <label className="block text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-1.5">
                    Nombre Completo <span className="text-yellow-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={manualNombre}
                    onChange={(e) => setManualNombre(e.target.value)}
                    placeholder="Ej. Juan Carlos López Pérez"
                    className="w-full bg-[#181818] border border-zinc-700 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400/50"
                  />
                </div>

                {/* Tipo de Membresía */}
                <div>
                  <label className="block text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-1.5">
                    Tipo de Membresía
                  </label>
                  <select
                    value={manualMembresia}
                    onChange={(e) => setManualMembresia(e.target.value)}
                    className="w-full bg-[#181818] border border-zinc-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400/50 cursor-pointer mb-2"
                  >
                    {DEFAULT_MEMBERSHIPS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value="__custom__">Otro (especificar personalizado)...</option>
                  </select>

                  {manualMembresia === '__custom__' && (
                    <input
                      type="text"
                      required
                      value={customMembresia}
                      onChange={(e) => setCustomMembresia(e.target.value)}
                      placeholder="Escribe el tipo de membresía personalizada..."
                      className="w-full bg-[#181818] border border-yellow-400/50 rounded-xl px-3.5 py-2 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-yellow-400"
                    />
                  )}
                </div>

                {/* Fecha de Expiración / Vencimiento de Membresía */}
                <div>
                  <label className="block text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-1.5 flex items-center justify-between">
                    <span>Fecha de Vencimiento</span>
                    <span className="text-zinc-500 font-normal lowercase">(opcional)</span>
                  </label>
                  <input
                    type="date"
                    value={manualExpiration}
                    onChange={(e) => setManualExpiration(e.target.value)}
                    className="w-full bg-[#181818] border border-zinc-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400/50 [color-scheme:dark]"
                  />
                  <p className="text-zinc-500 text-[11px] mt-1">
                    Si se deja vacía, la membresía permanece activa de forma permanente o hasta desactivación manual.
                  </p>
                </div>

                {/* Estatus Inicial (Interruptor Toggle) */}
                <div className="pt-2">
                  <div className="flex items-center justify-between bg-[#1e1e1e] border border-zinc-700/80 rounded-xl p-3.5">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck size={18} className={manualIsActive ? 'text-green-400' : 'text-zinc-500'} />
                      <div>
                        <p className="text-white text-xs font-bold leading-tight">Estatus Inicial</p>
                        <p className="text-zinc-400 text-[11px]">
                          {manualIsActive ? 'Membresía Activa (Permite el acceso en el Kiosco)' : 'Membresía Inactiva / Bloqueada'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setManualIsActive(!manualIsActive)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        manualIsActive ? 'bg-yellow-400' : 'bg-zinc-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-black shadow-lg ring-0 transition duration-200 ease-in-out ${
                          manualIsActive ? 'translate-x-5' : 'translate-x-0 bg-zinc-300'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Botón Guardar Socio */}
                <div className="pt-3">
                  <button
                    type="submit"
                    disabled={manualSaving || !manualClave.trim() || !manualNombre.trim()}
                    className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
                  >
                    {manualSaving ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Guardando en base de datos...</span>
                      </>
                    ) : (
                      <>
                        <Check size={16} />
                        <span>Guardar Socio</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── 3. PESTAÑA: CARGA MASIVA (CSV/EXCEL) ── */}
        {activeTab === 'bulk' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
            {/* Columna izquierda: upload */}
            <div className="space-y-4">
              <div>
                <h2 className="text-zinc-400 text-xs uppercase tracking-wider font-semibold mb-3">
                  1. Formato de datos
                </h2>
                <SiitecCard
                  icon={IMPORT_TYPES.students.icon}
                  title={IMPORT_TYPES.students.label}
                  description={`Campos: ${IMPORT_TYPES.students.fields.join(', ')}`}
                  active={true}
                  onClick={() => {}}
                  rightContent={<ChevronRight size={14} className="text-zinc-600"/>}
                />
              </div>

              <div>
                <h2 className="text-zinc-400 text-xs uppercase tracking-wider font-semibold mb-3">
                  2. Sube el archivo
                </h2>
                <DropZone
                  onFile={handleFile}
                  accept=".csv,.xlsx,.xls,.ods"
                  disabled={importing}
                />
                <div className="mt-3 bg-[#1e1e1e] border border-zinc-800 rounded-lg p-3">
                  <p className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1.5 font-medium">
                    Formato esperado (primera fila = encabezados):
                  </p>
                  <pre className="text-zinc-500 text-[10px] font-mono whitespace-pre-wrap leading-relaxed">
                    {IMPORT_TYPES.students.example}
                  </pre>
                </div>
              </div>

              {parseError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5"/>
                  <p className="text-red-400 text-xs">{parseError}</p>
                </div>
              )}
            </div>

            {/* Columna derecha: preview + resultado + simulador API */}
            <div className="space-y-4">
              {preview && preview.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-zinc-400 text-xs uppercase tracking-wider font-semibold">
                      3. Vista previa ({preview.length} {allData && allData.length > preview.length ? `de ${allData.length}` : ''} filas)
                    </h2>
                    <button onClick={resetBulk} className="text-zinc-600 hover:text-zinc-400">
                      <X size={14}/>
                    </button>
                  </div>

                  <div className="bg-[#282828] border border-zinc-700 rounded-xl overflow-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-700">
                          {Object.keys(preview[0]).slice(0, 6).map(col => (
                            <th key={col} className="text-left text-zinc-500 px-3 py-2 whitespace-nowrap font-medium">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {preview.slice(0, 10).map((row, i) => (
                          <tr key={i} className="hover:bg-zinc-800/50">
                            {Object.values(row).slice(0, 6).map((val, j) => (
                              <td key={j} className="px-3 py-2 text-zinc-300 truncate max-w-[120px]">
                                {String(val)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(allData?.length || preview.length) > 10 && (
                      <p className="text-zinc-600 text-center text-xs py-2">
                        ... mostrando las primeras 10 de {allData?.length || preview.length} filas
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="btn-primary w-full flex items-center justify-center gap-2 mt-3"
                  >
                    {importing
                      ? <><Loader2 size={15} className="animate-spin"/> Importando...</>
                      : <><Upload size={15}/> Importar {allData?.length || preview.length} socios</>}
                  </button>
                </div>
              )}

              {result && (
                <div className={`rounded-xl border p-4 animate-fade-in ${
                  result.success
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}>
                  <div className="flex items-start gap-2.5">
                    {result.success
                      ? <CheckCircle2 size={18} className="text-green-400 shrink-0 mt-0.5"/>
                      : <AlertCircle  size={18} className="text-red-400 shrink-0 mt-0.5"/>}
                    <div>
                      <p className={`font-semibold text-sm ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                        {result.success
                          ? `${result.count} socios importados correctamente`
                          : `Importación con ${result.errors.length} error(es)`}
                      </p>
                      {result.errors.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {result.errors.map((e, i) => (
                            <li key={i} className="text-red-300 text-xs">• {e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Simulador de API del Gimnasio (Solo visible en modo depuración/desarrollo) */}
              {import.meta.env.VITE_DEBUG_MODE === 'true' && (
                <div className="bg-[#202020] border border-dashed border-zinc-700 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-400/30">
                      Herramienta de Desarrollo
                    </span>
                    <h3 className="text-zinc-400 text-xs font-semibold">
                      Simulador de Integración API
                    </h3>
                  </div>
                  <div className="bg-[#282828] border border-zinc-700 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <code className="text-yellow-400 text-xs font-mono">GET /api/students</code>
                      <p className="text-zinc-500 text-xs mt-0.5">Simular sincronización externa de socios</p>
                    </div>
                    <button
                      onClick={() => window.alert('[Modo Desarrollo] Simulando llamada al endpoint externo del gimnasio. En producción, configurar webhook o tarea programada.')}
                      className="btn-secondary text-xs py-1.5 px-3 shrink-0 flex items-center gap-1"
                    >
                      <RefreshCw size={11}/> Sync
                    </button>
                  </div>
                  <p className="text-zinc-600 text-[11px] mt-2">
                    Esta sección solo es visible para administradores cuando <code className="text-zinc-400">VITE_DEBUG_MODE=true</code>.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
