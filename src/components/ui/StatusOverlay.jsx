/**
 * StatusOverlay — Pantalla de estado del kiosco (Verde/Rojo)
 *
 * Props:
 *   status      'granted' | 'denied' | 'intrusion' | null
 *   studentName string
 *   subject     string
 *   message     string
 *   onDismiss   () => void  (se llama automáticamente después de autoClose ms)
 *   autoClose   number (ms, default 3500)
 */
import { useEffect, useRef } from 'react'
import { CheckCircle2, XCircle, ShieldAlert, User } from 'lucide-react'

// ── Generación de audio con Web Audio API ────────────────────────
function playBeep(type = 'granted') {
  try {
    const ctx     = new (window.AudioContext || window.webkitAudioContext)()
    const osc     = ctx.createOscillator()
    const gainNode = ctx.createGain()
    osc.connect(gainNode)
    gainNode.connect(ctx.destination)

    if (type === 'granted') {
      // Beep corto ascendente: confirmación
      osc.type = 'sine'
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1)
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start()
      osc.stop(ctx.currentTime + 0.4)
    } else {
      // Alarma: dos notas bajas descendentes
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(330, ctx.currentTime)
      osc.frequency.setValueAtTime(220, ctx.currentTime + 0.2)
      osc.frequency.setValueAtTime(330, ctx.currentTime + 0.4)
      osc.frequency.setValueAtTime(220, ctx.currentTime + 0.6)
      gainNode.gain.setValueAtTime(0.25, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9)
      osc.start()
      osc.stop(ctx.currentTime + 0.9)
    }
  } catch { /* Silencioso si WebAudio no disponible */ }
}

export default function StatusOverlay({
  status,
  studentName,
  subject,
  career,
  photoUrl,
  matricula,
  message,
  onDismiss,
  autoClose = 3000
}) {
  const timerRef = useRef(null)

  useEffect(() => {
    if (!status) return
    playBeep(status === 'granted' ? 'granted' : 'denied')
    timerRef.current = setTimeout(() => onDismiss?.(), autoClose)
    return () => clearTimeout(timerRef.current)
  }, [status, autoClose, onDismiss])

  if (!status) return null

  const isGranted   = status === 'granted'
  const isIntrusion = status === 'intrusion'

  const config = {
    granted: {
      bg:      'bg-green-600',
      glow:    'animate-glow-green',
      border:  'border-green-400',
      icon:    <CheckCircle2 size={80} className="text-white drop-shadow-lg" />,
      title:   'ACCESO CONCEDIDO - ¡BIENVENIDO!',
      textCol: 'text-white',
    },
    denied: {
      bg:      'bg-red-700',
      glow:    'animate-glow-red',
      border:  'border-red-400',
      icon:    <XCircle size={80} className="text-white drop-shadow-lg" />,
      title:   'MEMBRESÍA VENCIDA / NO REGISTRADO',
      textCol: 'text-white',
    },
    intrusion: {
      bg:      'bg-red-900',
      glow:    'animate-glow-red',
      border:  'border-red-500',
      icon:    <ShieldAlert size={80} className="text-white drop-shadow-lg animate-pulse" />,
      title:   'MEMBRESÍA VENCIDA / NO REGISTRADO',
      textCol: 'text-white',
    },
  }[status]

  return (
    <div
      className={`kiosk-overlay kiosk-mode ${config.bg} ${config.glow}`}
      onClick={() => onDismiss?.()}
    >
      {/* Partículas decorativas (CSS only) */}
      <div className={`absolute inset-0 opacity-10 ${isGranted ? 'bg-[radial-gradient(circle,white_1px,transparent_1px)] bg-[size:30px_30px]' : ''}`} />

      <div className={`relative z-10 flex flex-col items-center gap-6 text-center px-8 max-w-md`}>
        {/* Ícono */}
        <div className={`p-6 rounded-full border-2 ${config.border} bg-white/10 backdrop-blur-sm`}>
          {config.icon}
        </div>

        {/* Título */}
        <h1 className={`text-2xl sm:text-4xl md:text-5xl font-extrabold ${config.textCol} tracking-tight leading-tight uppercase`}>
          {config.title}
        </h1>

        {/* Datos del socio */}
        {studentName && studentName !== 'No Registrado' && (
          <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md rounded-2xl px-6 py-4 border border-white/20 shadow-2xl max-w-sm w-full">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={studentName}
                className="w-16 h-16 rounded-full object-cover border-2 border-white/60 shrink-0 shadow-md"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center shrink-0 border border-white/30">
                <User size={28} className="text-white/90" />
              </div>
            )}
            <div className="text-left min-w-0">
              <p className="text-white font-extrabold text-base md:text-lg leading-tight truncate">{studentName}</p>
              {matricula && <p className="text-yellow-300 font-mono text-xs font-semibold mt-0.5">ID: {matricula}</p>}
              {career && <p className="text-white/90 font-medium text-xs mt-0.5 line-clamp-2">Membresía: {career}</p>}
              {subject && <p className="text-white/60 text-[11px] mt-1 italic truncate">{subject}</p>}
            </div>
          </div>
        )}

        {/* Mensaje adicional */}
        {message && (
          <p className="text-white/80 text-sm sm:text-base font-semibold">{message}</p>
        )}

        {/* Indicador de cierre automático */}
        <p className="text-white/40 text-sm mt-2">
          {isIntrusion ? 'Toca para continuar · Alerta enviada a seguridad' : 'Toca para continuar'}
        </p>

        {/* Barra de progreso */}
        <div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-white/60 rounded-full"
            style={{ animation: `shrink ${autoClose}ms linear forwards` }}
          />
        </div>
      </div>

      <style>{`
        @keyframes shrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>
  )
}
