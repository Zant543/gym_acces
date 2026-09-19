/**
 * TeacherDashboard — /docente
 * Monitoreo en tiempo real de socios presentes en las últimas 2 horas.
 * Vista directa y fija para Recepción / Gimnasio.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Users, CheckCircle2, Clock3, RefreshCw, Wifi, WifiOff,
  LogOut, ArrowLeft, FlaskConical, UserCheck, Clock
} from 'lucide-react'
import Header from '../components/layout/Header'
import { useAuth } from '../hooks/useAuth'
import { useRealtimeChannel } from '../hooks/useRealtimeChannel'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

function formatTime(ts) {
  if (!ts) return '--'
  try {
    return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '--'
  }
}

function formatDuration(ts) {
  if (!ts) return ''
  const diffMs = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`
}

export default function TeacherDashboard() {
  const { isAdmin, loading: authLoading, signOut } = useAuth()
  const navigate = useNavigate()

  const [presentSocios, setPresentSocios] = useState([])
  const [loading,       setLoading]       = useState(false)
  const [lastUpdate,    setLastUpdate]    = useState(null)
  const [isOnline]                        = useState(navigator.onLine)

  const expiryTimerRef = useRef(null)

  // ── 1. Cargar socios presentes en las últimas 2 horas ─────────
  const loadPresentSocios = useCallback(async () => {
    setLoading(true)
    try {
      const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString()
      const { data: logs, error: logsErr } = await supabase
        .from('access_logs')
        .select('student_id, status, timestamp')
        .in('status', ['PERMITIDO', 'granted'])
        .gte('timestamp', twoHoursAgo)
        .order('timestamp', { ascending: false })

      if (logsErr) console.warn('[Dashboard] Error consultando logs:', logsErr.message)

      const seenIds = new Set()
      const recentLogs = (logs || []).filter(l => {
        if (!l.student_id || seenIds.has(l.student_id)) return false
        seenIds.add(l.student_id)
        return true
      })

      if (recentLogs.length === 0) {
        setPresentSocios([])
        setLastUpdate(new Date().toISOString())
        setLoading(false)
        return
      }

      const studentIds = recentLogs.map(l => l.student_id)
      const { data: studentsData } = await supabase
        .from('students')
        .select('id, matricula, full_name, career')
        .in('id', studentIds)

      const studentsMap = {}
      ;(studentsData || []).forEach(s => { studentsMap[s.id] = s })

      const sociosList = recentLogs.map(log => {
        const s = studentsMap[log.student_id] || {}
        return {
          studentId: log.student_id,
          fullName:  s.full_name  || 'Socio Desconocido',
          matricula: s.matricula  || '-',
          career:    s.career     || '-',
          enteredAt: log.timestamp,
        }
      })

      setPresentSocios(sociosList)
      setLastUpdate(new Date().toISOString())
    } catch (err) {
      console.error('[Dashboard] Error cargando socios presentes:', err)
      setPresentSocios([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPresentSocios()
  }, [loadPresentSocios])

  // ── 2. Timer cada 60s para remover socios expirados (> 2h) ────
  useEffect(() => {
    expiryTimerRef.current = setInterval(() => {
      const cutoff = Date.now() - TWO_HOURS_MS
      setPresentSocios(prev => prev.filter(s => new Date(s.enteredAt).getTime() >= cutoff))
    }, 60_000)
    return () => clearInterval(expiryTimerRef.current)
  }, [])

  // ── 3. Realtime: agregar nuevos accesos permitidos en vivo ────
  useRealtimeChannel({
    channelName: 'teacher_gym_presence',
    table:       'access_logs',
    event:       'INSERT',
    enabled:     true,
    onEvent:     useCallback(async (payload) => {
      const log = payload?.new
      if (!log?.student_id) return
      if (!['PERMITIDO', 'granted'].includes(log.status)) return
      const enteredAt = log.timestamp || new Date().toISOString()
      if (Date.now() - new Date(enteredAt).getTime() > TWO_HOURS_MS) return

      const { data: stuData } = await supabase
        .from('students')
        .select('id, matricula, full_name, career')
        .eq('id', log.student_id)
        .single()

      setPresentSocios(prev => {
        const newEntry = {
          studentId: log.student_id,
          fullName:  stuData?.full_name  || 'Socio Desconocido',
          matricula: stuData?.matricula  || '-',
          career:    stuData?.career     || '-',
          enteredAt,
        }
        const exists = prev.find(s => s.studentId === log.student_id)
        if (exists) return prev.map(s => s.studentId === log.student_id ? newEntry : s)
        return [newEntry, ...prev]
      })
      setLastUpdate(new Date().toISOString())
    }, [])
  })

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#181818] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm">Cargando dashboard...</p>
        </div>
      </div>
    )
  }

  const totalPresentes = presentSocios.length

  return (
    <div className="min-h-screen bg-[#181818]">
      <Header isOnline={isOnline} title="Dashboard Instructor" />

      <main className="pt-14 px-4 pb-8 max-w-screen-lg mx-auto">
        {/* Encabezado */}
        <div className="py-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-white font-extrabold text-xl sm:text-2xl flex items-center gap-2.5">
              <FlaskConical size={22} className="text-yellow-400 shrink-0" />
              <span>Presencia en Tiempo Real</span>
            </h1>
            <div className="text-zinc-400 text-xs sm:text-sm mt-1.5 flex items-center gap-2 flex-wrap">
              <span className="bg-yellow-500/20 text-yellow-300 text-xs font-bold px-2 py-0.5 rounded border border-yellow-400/30 font-mono">
                GIMNASIO
              </span>
              <span className="text-white font-semibold">Recepción</span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-500 text-xs flex items-center gap-1">
                <Clock size={10} /> Ventana: últimas 2 horas
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border ${isOnline ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
              {isOnline ? <Wifi size={11}/> : <WifiOff size={11}/>}
              {isOnline ? 'En línea' : 'Offline'}
            </div>

            {isAdmin && (
              <button onClick={() => navigate('/admin/sync')} className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 hover:border-zinc-500 text-zinc-300" title="Volver al Panel de Sincronización">
                <ArrowLeft size={12} /> Panel Admin
              </button>
            )}

            <button onClick={loadPresentSocios} className="btn-secondary flex items-center gap-1.5 text-xs py-1.5" disabled={loading}>
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
            </button>

            <button onClick={handleSignOut} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-400 transition-colors" title="Cerrar sesión">
              <LogOut size={12} /> Salir
            </button>
          </div>
        </div>

        {/* Contadores */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <div className="bg-[#282828] border border-green-500/20 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-xs mb-1 text-green-400"><UserCheck size={16} /><span>Socios Presentes</span></div>
            <p className="text-3xl font-extrabold text-green-400">{totalPresentes}</p>
          </div>
          <div className="bg-[#282828] border border-yellow-500/20 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-xs mb-1 text-yellow-400"><Clock3 size={16} /><span>Ventana activa</span></div>
            <p className="text-3xl font-extrabold text-yellow-400">2h</p>
          </div>
          <div className="bg-[#282828] border border-zinc-700 rounded-xl p-4 col-span-2 md:col-span-1">
            <div className="flex items-center gap-1.5 text-xs mb-1 text-zinc-400"><Users size={16} /><span>Ubicación</span></div>
            <p className="text-sm font-bold text-white truncate">Recepción Principal</p>
          </div>
        </div>

        {/* Resumen rápido */}
        <div className="bg-[#282828] border border-zinc-700 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-yellow-400" />
            <span className="text-white text-sm font-semibold">
              <span className="text-yellow-400">{totalPresentes}</span>
              <span className="text-zinc-400"> {totalPresentes === 1 ? 'socio presente' : 'socios presentes'} (últimas 2 horas)</span>
            </span>
          </div>
          {lastUpdate && <span className="text-zinc-600 text-xs">Actualizado {formatTime(lastUpdate)}</span>}
        </div>

        {/* Lista de socios presentes */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : presentSocios.length === 0 ? (
          <div className="bg-[#282828] border border-zinc-700 rounded-xl p-8 text-center">
            <UserCheck size={40} className="mx-auto mb-3 text-zinc-600" />
            <p className="font-semibold text-white">Sin socios presentes</p>
            <p className="text-sm text-zinc-400 mt-1">
              Aún no hay accesos registrados en las últimas 2 horas en la recepción.
            </p>
          </div>
        ) : (
          <div className="bg-[#282828] border border-zinc-700 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2.5 border-b border-zinc-700 text-zinc-500 text-xs uppercase tracking-wider font-medium">
              <span>Socio</span>
              <span className="hidden sm:block">ID de Socio</span>
              <span>Entrada</span>
            </div>
            <div className="divide-y divide-zinc-800">
              {presentSocios.map((socio, idx) => (
                <div key={socio.studentId || idx} className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 items-center transition-colors hover:bg-zinc-800/50 bg-green-500/5">
                  <div>
                    <p className="text-white text-sm font-medium leading-tight">{socio.fullName}</p>
                    <p className="text-zinc-500 text-xs">{socio.career}</p>
                  </div>
                  <span className="hidden sm:block text-zinc-500 text-xs font-mono">{socio.matricula}</span>
                  <div className="text-right">
                    <span className="text-green-400 text-xs font-mono font-semibold whitespace-nowrap block">{formatTime(socio.enteredAt)}</span>
                    <span className="text-zinc-600 text-[10px] whitespace-nowrap block">{formatDuration(socio.enteredAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
