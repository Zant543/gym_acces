/**
 * KioskPage — /kiosk
 * Módulo de control de acceso para tablet en puerta de laboratorio.
 *
 * Máquina de estados: idle → scanning → validating → granted|denied|intrusion → idle
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CameraOff, Wifi, WifiOff, RefreshCw, LogIn, LogOut,
  FlaskConical, Clock, ArrowLeft, Keyboard, ArrowRight,
  Scan, ShieldAlert, SlidersHorizontal, Camera, Bug, QrCode
} from 'lucide-react'

import StatusOverlay from '../components/ui/StatusOverlay'
import { useOfflineSync } from '../hooks/useOfflineSync'
import { useAuth } from '../hooks/useAuth'
import {
  initOCRWorker, extractMatricula, capturePhotoDataUrl,
  terminateOCRWorker, drawOverlay, captureCredentialSnapshot
} from '../lib/ocr'
import { scanBarcode, extractMatriculaFromBarcode } from '../lib/barcode'
import { supabase, insertAccessLog, uploadAccessPhoto, rpcValidateAccess } from '../lib/supabase'
import { checkAccessOffline, enqueueEvent } from '../lib/db'

const DEFAULT_FALLBACK_LOCATION_ID = import.meta.env.VITE_KIOSK_LOCATION_ID || import.meta.env.VITE_KIOSK_LAB_ID || '00000000-0000-0000-0000-000000000001'
const DEBUG                        = import.meta.env.VITE_DEBUG_MODE === 'true'

const STATES = {
  IDLE:        'idle',
  SCANNING:    'scanning',
  VALIDATING:  'validating',
  GRANTED:     'granted',
  DENIED:      'denied',
  INTRUSION:   'intrusion',
}


// Intervalo entre disparos automáticos de snapshot en modo auto (ms)
const AUTO_SNAPSHOT_INTERVAL = 2500

// ── LiveClock ────────────────────────────────────────────────────
function LiveClock() {
  const [t, setT] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="tabular-nums">
      {t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

export default function KioskPage() {
  const navigate     = useNavigate()
  const { signOut, isAdmin, profile } = useAuth()

  const videoRef         = useRef(null)
  const overlayRef       = useRef(null)
  const animFrameRef     = useRef(null)
  const streamRef        = useRef(null)
  const ocrReadyRef      = useRef(false)
  const isScanningRef    = useRef(false)
  const manualInputRef   = useRef(null)
  const barcodeBufferRef = useRef('')
  const lastKeyTimeRef   = useRef(0)
  const cooldownUntilRef = useRef(0)
  const lastScannedMatriculaRef = useRef({ code: '', time: 0 })

  const [activeLocationId, setActiveLocationId] = useState(profile?.location_id || profile?.lab_id || DEFAULT_FALLBACK_LOCATION_ID)
  const [kioskState,       setKioskState]       = useState(STATES.IDLE)
  const [cameraOk,         setCameraOk]         = useState(false)
  const [ocrReady,         setOcrReady]         = useState(false)
  const [resultData,       setResultData]       = useState(null)
  const [lastScan,         setLastScan]         = useState(null)
  const [movement,         setMovement]         = useState('entry') // 'entry' | 'exit'
  const [ocrProgress,      setOcrProgress]      = useState(0)
  const [pendingQueue,     setPendingQueue]     = useState(0)
  const [manualInput,      setManualInput]      = useState('')
  const [showDebugMenu,    setShowDebugMenu]    = useState(false)

  // ── Nuevos estados para snapshot, barcode y debug panel ──────────
  const [autoSnapshotEnabled, setAutoSnapshotEnabled] = useState(true)
  const [showDebugPanel,      setShowDebugPanel]      = useState(false)
  const [debugInfo,           setDebugInfo]           = useState(null)
  // debugInfo: { colorDataUrl, binarizedDataUrl, rawText, confidence, timeTaken, barcodeResult, timestamp }

  const { isOnline, pendingCount, downloadAccessRules } = useOfflineSync(activeLocationId)

  // ── 1. Ubicación fija de la unidad (Recepción / Gimnasio) ────────
  useEffect(() => {
    async function resolveDefaultLocation() {
      // Intentar primero con locations (esquema oficial)
      const { data: loc } = await supabase
        .from('locations')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (loc?.id) {
        setActiveLocationId(loc.id)
        return
      }

      // Fallback con labs si el esquema aún no fue migrado
      const { data: lab } = await supabase
        .from('labs')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (lab?.id) {
        setActiveLocationId(lab.id)
      }
    }

    resolveDefaultLocation().catch(() => {})
  }, [])

  // ── 2. Inicializar Cámara WebRTC (falla silenciosa → solo pad numérico) ─────
  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        console.warn('[Kiosk] getUserMedia no disponible. Modo solo teclado/USB activo.')
        setCameraOk(false)
        return
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }

      // Intentar cámara trasera primero (tablet/móvil), luego cualquier cámara
      let stream = null
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        })
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true })
        } catch (fallbackErr) {
          console.warn('[Kiosk] Sin cámara disponible o permisos denegados. Operando solo con teclado/USB:', fallbackErr?.message)
          setCameraOk(false)
          // ── Devolver el foco al input del pad numérico ──
          setTimeout(() => manualInputRef.current?.focus(), 200)
          return
        }
      }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraOk(true)
      }
    } catch (err) {
      // Captura final: ningún error de cámara debe romper la app
      console.error('[Kiosk] Error inesperado al iniciar cámara:', err?.message)
      setCameraOk(false)
    }
  }, [])

  // ── Detener cámara ───────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOk(false)
  }, [])

  // ── Inicializar OCR (con respaldo try/catch para operar 100% con teclado) ──
  useEffect(() => {
    try {
      initOCRWorker((pct) => setOcrProgress(pct))
        .then(() => {
          ocrReadyRef.current = true
          setOcrReady(true)
        })
        .catch(err => {
          console.warn('[Kiosk] OCR no disponible, operando 100% vía pad numérico:', err?.message)
          ocrReadyRef.current = false
          setOcrReady(false)
        })
    } catch (err) {
      console.warn('[Kiosk] Error inicializando OCR worker:', err?.message)
      ocrReadyRef.current = false
      setOcrReady(false)
    }
    return () => {
      try {
        terminateOCRWorker()
      } catch {}
      ocrReadyRef.current = false
    }
  }, [])

  // ── Inicializar cámara al montar ─────────────────────────────
  useEffect(() => {
    startCamera()
    return stopCamera
  }, [startCamera, stopCamera])

  // ── Loop de animación del overlay ────────────────────────────
  useEffect(() => {
    const loop = () => {
      if (overlayRef.current && videoRef.current) {
        const canvas = overlayRef.current
        const cw = canvas.clientWidth
        const ch = canvas.clientHeight
        if (cw && ch && (canvas.width !== cw || canvas.height !== ch)) {
          canvas.width = cw
          canvas.height = ch
        }
        drawOverlay(canvas, kioskState === STATES.SCANNING)
      }
      animFrameRef.current = requestAnimationFrame(loop)
    }
    animFrameRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [kioskState])

  // ── 5. Validación Directa contra Supabase (students) ─────────────
  const handleValidation = useCallback(async (rawMatricula) => {
    if (!rawMatricula) return
    const matricula = rawMatricula.toString().trim().toUpperCase()
    if (!matricula || kioskState === STATES.VALIDATING) return

    const now = Date.now()
    // Si la misma clave intenta validarse dentro del cooldown, ignorar
    if (
      matricula === lastScannedMatriculaRef.current.code &&
      now < cooldownUntilRef.current
    ) {
      console.log('[Kiosk] Clave en cooldown, ignorando:', matricula)
      setKioskState(STATES.IDLE)
      return
    }

    // Activar cooldown de 4s y guardar última clave
    cooldownUntilRef.current = now + 4000
    lastScannedMatriculaRef.current = { code: matricula, time: now }

    setKioskState(STATES.VALIDATING)
    setLastScan(matricula)

    let allowed     = false
    let studentId   = null
    let studentName = null
    let career      = null
    let photoUrl    = null
    let message     = null
    let finalStatus = 'denied'

    try {
      if (isOnline) {
        try {
          // 1. Usar la función centralizada de PostgreSQL validate_access
          const rpcRes = await rpcValidateAccess(matricula, activeLocationId)
          if (rpcRes) {
            allowed     = rpcRes.allowed ?? false
            studentId   = rpcRes.student_id || null
            studentName = rpcRes.full_name || (allowed ? 'Socio' : 'No Registrado')
            career      = rpcRes.career || null
            finalStatus = rpcRes.status || (allowed ? 'granted' : 'denied')
            message     = (rpcRes.message || (allowed ? 'ACCESO CONCEDIDO - ¡BIENVENIDO!' : 'MEMBRESÍA VENCIDA / NO REGISTRADO')).toUpperCase()
          }
        } catch (rpcErr) {
          console.warn('[Kiosk] Fallo RPC validate_access, ejecutando consulta directa de contingencia:', rpcErr?.message)
          const { data: socio, error: stuErr } = await supabase
            .from('students')
            .select('*')
            .eq('matricula', matricula)
            .maybeSingle()

          if (!stuErr && socio) {
            studentId   = socio.id
            studentName = socio.full_name
            career      = socio.career || null
            photoUrl    = socio.photo_url || null

            if (socio.is_active === true) {
              const expDate = socio.expiration_date ? new Date(socio.expiration_date) : null
              const isExpired = expDate ? expDate < new Date() : false
              if (!isExpired) {
                allowed     = true
                finalStatus = 'granted'
                message     = 'ACCESO CONCEDIDO - ¡BIENVENIDO!'
              } else {
                allowed     = false
                finalStatus = 'denied'
                message     = 'MEMBRESÍA VENCIDA / FECHA EXPIRADA'
              }
            } else {
              allowed     = false
              finalStatus = 'denied'
              message     = 'MEMBRESÍA INACTIVA O SUSPENDIDA'
            }
          } else {
            allowed     = false
            studentId   = null
            studentName = 'No Registrado'
            career      = null
            finalStatus = 'denied'
            message     = 'MEMBRESÍA VENCIDA / NO REGISTRADO'
          }
        }
      } else {
        // Modo sin conexión: verificar en IndexedDB local
        const offlineResult = await checkAccessOffline(matricula)
        if (offlineResult?.allowed) {
          allowed     = true
          studentName = offlineResult?.rule?.studentName || 'Socio'
          career      = offlineResult?.rule?.career || null
          finalStatus = 'granted'
          message     = 'ACCESO CONCEDIDO - ¡BIENVENIDO!'
        } else {
          allowed     = false
          studentName = offlineResult?.rule?.studentName || 'No Registrado'
          career      = offlineResult?.rule?.career || null
          finalStatus = 'denied'
          message     = 'MEMBRESÍA VENCIDA / NO REGISTRADO'
        }
      }
    } catch (err) {
      console.error('[Kiosk] Error de comunicación al validar:', err)
      allowed     = false
      finalStatus = 'denied'
      message     = 'MEMBRESÍA VENCIDA / NO REGISTRADO'
    }

    const finalMovement = movement === 'exit' ? 'exit' : 'entry'
    const photoDataUrl = (!allowed && videoRef.current)
      ? capturePhotoDataUrl(videoRef.current)
      : null

    let savedPhotoUrl = photoUrl

    // Si el acceso fue denegado y se capturó fotografía de evidencia, subirla a Supabase Storage
    if (!allowed && photoDataUrl && isOnline) {
      try {
        const uploadedUrl = await uploadAccessPhoto(photoDataUrl, matricula)
        if (uploadedUrl) {
          savedPhotoUrl = uploadedUrl
        }
      } catch (uploadError) {
        console.warn('[Kiosk] No se pudo subir foto de evidencia a storage:', uploadError?.message)
      }
    }

    // Actualizar estado visual de respuesta (Verde o Rojo durante 3 segundos)
    setResultData({
      status: finalStatus,
      studentName,
      career,
      photoUrl: savedPhotoUrl || photoUrl,
      matricula,
      message,
    })

    setKioskState(finalStatus === 'granted' ? STATES.GRANTED : STATES.DENIED)

    // ── Registro en la tabla 'access_logs': enum granted / denied ──
    try {
      if (isOnline) {
        await insertAccessLog({
          studentId:    studentId || null,
          locationId:   activeLocationId,
          labId:        activeLocationId,
          status:       finalStatus,
          movementType: finalMovement,
          photoUrl:     savedPhotoUrl,
          notes:        `${finalStatus === 'granted' ? 'Acceso concedido' : 'Acceso denegado'}: Socio ${matricula} - ${studentName || ''}`
        })
        console.log(`[Kiosk] Bitácora registrada: ${finalStatus} (${matricula})`)
      } else {
        await enqueueEvent({
          locationId:   activeLocationId,
          labId:        activeLocationId,
          studentId,
          matricula,
          status:       finalStatus,
          movementType: finalMovement,
          photoDataUrl,
        })
        setPendingQueue(p => p + 1)
      }
    } catch (err) {
      console.warn('[Kiosk] No se pudo escribir en access_logs:', err?.message)
    }
  }, [activeLocationId, isOnline, kioskState, movement])

  // ── 6. Captura de Snapshot: Barcode → OCR (Modo Disparo Estático) ─
  const runSnapshot = useCallback(async ({ isManual = false } = {}) => {
    if (!cameraOk || kioskState !== STATES.IDLE || isScanningRef.current) return
    if (!isManual && Date.now() < cooldownUntilRef.current) return
    if (!videoRef.current?.videoWidth) return

    isScanningRef.current = true
    setKioskState(STATES.SCANNING)

    try {
      const videoEl = videoRef.current

      // ── A. Intentar lectura de Código de Barras / QR (máxima prioridad) ──
      let barcodeResult = null
      try {
        barcodeResult = await scanBarcode(videoEl)
      } catch (bErr) {
        console.warn('[Kiosk] Barcode scan error:', bErr?.message)
      }

      if (barcodeResult?.code) {
        const matricula = extractMatriculaFromBarcode(barcodeResult.code) || barcodeResult.code.trim().toUpperCase()
        console.log(`[Kiosk] Barcode detectado (${barcodeResult.engine}):`, matricula)

        // Actualizar debug panel si está visible
        if (DEBUG || (isAdmin && showDebugPanel)) {
          const snapshot = captureCredentialSnapshot(videoEl)
          setDebugInfo({
            colorDataUrl: snapshot.colorDataUrl,
            binarizedDataUrl: snapshot.binarizedDataUrl,
            matricula,
            rawText: `[BARCODE] ${barcodeResult.code}`,
            confidence: 100,
            timeTaken: 0,
            barcodeResult,
            timestamp: Date.now()
          })
        }

        if (matricula && matricula.length >= 4) {
          const now = Date.now()
          if (!isManual && matricula === lastScannedMatriculaRef.current.code && now < cooldownUntilRef.current) {
            setKioskState(STATES.IDLE)
            return
          }
          await handleValidation(matricula)
          return
        }
      }

      // ── B. Fallback a OCR sobre snapshot congelado ──────────────────
      if (!ocrReadyRef.current) {
        setKioskState(STATES.IDLE)
        return
      }

      const snapshot = captureCredentialSnapshot(videoEl)

      // Actualizar panel de debug con la imagen capturada
      const partialDebugInfo = {
        colorDataUrl: snapshot.colorDataUrl,
        binarizedDataUrl: snapshot.binarizedDataUrl,
        matricula: null,
        rawText: '...procesando...',
        confidence: 0,
        timeTaken: 0,
        barcodeResult: null,
        timestamp: snapshot.timestamp
      }
      if (DEBUG || (isAdmin && showDebugPanel)) {
        setDebugInfo(partialDebugInfo)
      }

      // Ejecutar OCR sobre el canvas binarizado congelado
      const { matricula, rawText, confidence, timeTaken } = await extractMatricula(snapshot.binarizedCanvas)

      // Actualizar debug con resultado OCR
      if (DEBUG || (isAdmin && showDebugPanel)) {
        setDebugInfo(prev => ({
          ...prev,
          matricula,
          rawText: rawText || '(vacío)',
          confidence,
          timeTaken
        }))
      }

      if (matricula) {
        console.log(`[Kiosk] OCR detectó matrícula: ${matricula} (confianza: ${confidence}%)`)
        const now = Date.now()
        if (!isManual && matricula === lastScannedMatriculaRef.current.code && now < cooldownUntilRef.current) {
          setKioskState(STATES.IDLE)
          return
        }
        await handleValidation(matricula)
      } else {
        setKioskState(STATES.IDLE)
      }
    } catch (err) {
      console.error('[Kiosk] Error en snapshot:', err)
      setKioskState(STATES.IDLE)
    } finally {
      isScanningRef.current = false
    }
  }, [cameraOk, kioskState, handleValidation, isAdmin, showDebugPanel])

  // Auto-disparo de snapshot cada AUTO_SNAPSHOT_INTERVAL ms cuando está en idle
  useEffect(() => {
    if (!autoSnapshotEnabled || kioskState !== STATES.IDLE) return
    const timer = setInterval(() => runSnapshot({ isManual: false }), AUTO_SNAPSHOT_INTERVAL)
    return () => clearInterval(timer)
  }, [kioskState, runSnapshot, autoSnapshotEnabled])

  // ── 7. Lector de Código de Barras / QR USB (Dispositivo HID) ──────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Si el foco está en el input manual de texto, dejar que el submit del form lo maneje
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return
      }

      const now = Date.now()
      const diff = now - lastKeyTimeRef.current
      lastKeyTimeRef.current = now

      if (e.key === 'Enter') {
        const scanned = barcodeBufferRef.current.trim()
        barcodeBufferRef.current = ''
        if (scanned.length >= 4) {
          handleValidation(scanned)
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Los lectores USB envían las teclas en ráfaga rápida (<150ms entre caracteres)
        if (diff > 250) {
          barcodeBufferRef.current = ''
        }
        barcodeBufferRef.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleValidation])

  // ── 8. Descartar overlay de resultado → devolver foco al pad ──────
  const handleDismiss = useCallback(() => {
    setResultData(null)
    setKioskState(STATES.IDLE)
    // Cooldown de 2 segundos al cerrar resultado para evitar re-lectura inmediata
    cooldownUntilRef.current = Date.now() + 2000
    // Limpiar el input y devolver el foco al pad numérico
    setManualInput('')
    setTimeout(() => manualInputRef.current?.focus(), 100)
  }, [])

  // ── Autofocus permanente en el input del pad numérico ────────────
  // Se ejecuta al montar y reanuda el foco si el usuario hace clic en cualquier parte
  useEffect(() => {
    const refocusInput = () => {
      if (document.activeElement === manualInputRef.current) return
      // Solo refocalizar si el objetivo del clic no es un botón/input interactivo
      const tag = document.activeElement?.tagName
      if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return
      manualInputRef.current?.focus()
    }

    // Enfocar al montar
    const initialTimer = setTimeout(() => manualInputRef.current?.focus(), 400)

    // Refocalizar cuando la ventana recupere el foco
    window.addEventListener('click', refocusInput)
    window.addEventListener('focus', refocusInput)

    return () => {
      clearTimeout(initialTimer)
      window.removeEventListener('click', refocusInput)
      window.removeEventListener('focus', refocusInput)
    }
  }, [])

  // ── 9. Salida limpia del Kiosco hacia /login ─────────────────────
  const handleKioskLogout = useCallback(async () => {
    stopCamera()
    terminateOCRWorker()
    ocrReadyRef.current = false
    sessionStorage.removeItem('kiosk_manual_exit')
    try {
      await signOut()
    } catch (err) {
      console.warn('[Kiosk] Error cerrando sesión:', err?.message)
    }
    navigate('/login', { replace: true })
  }, [signOut, stopCamera, navigate])

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none">

      {/* Overlay de resultado (Verde: Concedido | Rojo: Intruso/Denegado) */}
      {(kioskState === STATES.GRANTED || kioskState === STATES.DENIED || kioskState === STATES.INTRUSION) && resultData && (
        <StatusOverlay
          status={resultData.status}
          studentName={resultData.studentName}
          subject={resultData.subject}
          career={resultData.career}
          photoUrl={resultData.photoUrl}
          matricula={resultData.matricula}
          message={resultData.message}
          onDismiss={handleDismiss}
          autoClose={3000}
        />
      )}


      {/* Video de la cámara WebRTC */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* Canvas overlay con guía de credencial */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        width={1280}
        height={720}
      />

      {/* Pantalla si la cámara no está lista o no tiene permisos */}
      {!cameraOk && (
        <div className="absolute inset-0 bg-[#141414] flex flex-col items-center justify-center gap-4 z-10 px-4">
          <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center shadow-lg border border-zinc-700">
            <CameraOff size={32} className="text-yellow-400" />
          </div>
          <p className="text-white font-bold text-lg">Cámara no conectada o sin permisos</p>
          <p className="text-zinc-500 text-xs text-center max-w-sm">
            El kiosco opera en <strong className="text-yellow-400">modo solo teclado/USB</strong>. Ingresa el ID de Socio en el campo inferior y presiona Enter.
          </p>
          <button
            onClick={startCamera}
            className="btn-secondary flex items-center gap-2 text-xs py-2 px-4 mt-1 border-zinc-600 hover:border-yellow-400"
          >
            <RefreshCw size={14} /> Reintentar cámara
          </button>
        </div>
      )}

      {/* HUD Superior */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between
                      px-4 py-3 bg-gradient-to-b from-black/85 via-black/40 to-transparent z-30 pointer-events-auto">
        <div className="flex items-center gap-3">
          {isAdmin ? (
            <button
              type="button"
              onClick={() => {
                stopCamera()
                terminateOCRWorker()
                navigate('/admin')
              }}
              className="flex items-center gap-2 bg-zinc-900/95 hover:bg-zinc-800 text-white border border-zinc-600 hover:border-yellow-400 rounded-lg px-3.5 py-2 text-xs font-semibold backdrop-blur-md shadow-2xl transition-all cursor-pointer pointer-events-auto z-50 active:scale-95"
              title="Volver al Panel Principal de Administración"
            >
              <ArrowLeft size={16} className="text-yellow-400 shrink-0" />
              <span>Volver al Panel</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleKioskLogout}
              className="flex items-center gap-2 bg-zinc-900/95 hover:bg-zinc-800 text-white border border-zinc-600 hover:border-red-400 rounded-lg px-3.5 py-2 text-xs font-semibold backdrop-blur-md shadow-2xl transition-all cursor-pointer pointer-events-auto z-50 active:scale-95"
              title="Cerrar sesión del Kiosco"
            >
              <LogOut size={16} className="text-red-400 shrink-0" />
              <span>Cerrar sesión</span>
            </button>
          )}

          <div className="flex items-center gap-2 border-l border-zinc-700/60 pl-3">
            <div className="w-7 h-7 bg-yellow-500 rounded-lg flex items-center justify-center shrink-0 shadow">
              <FlaskConical size={15} className="text-black" />
            </div>
            <div className="max-w-[160px] sm:max-w-[240px]">
              <p className="text-white text-xs font-bold leading-tight truncate">Gimnasio · Recepción</p>
              <p className="text-zinc-400 text-[10px] leading-tight">Control de Acceso</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Estado OCR */}
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border backdrop-blur-md ${
            ocrReady
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${ocrReady ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`}/>
            {ocrReady ? 'OCR Activo' : `OCR ${ocrProgress}%`}
          </div>

          {/* Conectividad */}
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border backdrop-blur-md ${
            isOnline
              ? 'bg-green-500/10 border-green-500/20 text-green-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {isOnline ? <Wifi size={11}/> : <WifiOff size={11}/>}
            {isOnline ? 'Online' : `Offline (${pendingCount || pendingQueue})`}
          </div>
        </div>
      </div>

      {/* Barra Central Inferior: Entrada Manual + Botón Escanear */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-20 pointer-events-auto w-full max-w-xl px-4">

        {/* Fila principal: input visible y estilizado para pad numérico / teclado */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const clean = manualInput.trim()
            if (clean) {
              handleValidation(clean)
              setManualInput('')
            }
          }}
          className="flex flex-col gap-1.5 bg-black/85 backdrop-blur-md border-2 border-yellow-400/70 focus-within:border-yellow-400 focus-within:ring-2 focus-within:ring-yellow-400/40 rounded-2xl p-2.5 shadow-2xl w-full transition-all"
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-yellow-400 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Keyboard size={14} className="text-yellow-400" />
              Teclea tu ID de Socio y presiona Enter
            </span>
            <span className="text-zinc-500 text-[10px] font-mono">Pad Numérico USB</span>
          </div>

          <div className="flex items-center gap-2 bg-zinc-900/90 rounded-xl px-3 py-2 border border-zinc-700/80">
            <input
              ref={manualInputRef}
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value.toUpperCase())}
              placeholder="Teclea tu ID de Socio y presiona Enter..."
              className="bg-transparent text-white text-sm sm:text-base font-bold placeholder-zinc-500 outline-none flex-1 font-mono tracking-wider"
              maxLength={20}
              autoFocus
            />
            <button
              type="submit"
              disabled={!manualInput.trim()}
              className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-30 disabled:cursor-not-allowed text-black text-xs font-black px-4 py-2 rounded-lg transition-all flex items-center gap-1.5 shrink-0 active:scale-95 shadow-md"
            >
              <span>ENTER</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </form>

        {/* Botón: Escanear Credencial (disparo manual de snapshot) */}
        <button
          onClick={() => runSnapshot({ isManual: true })}
          disabled={!cameraOk || kioskState === STATES.SCANNING || kioskState === STATES.VALIDATING}
          className={`flex items-center gap-2 w-full justify-center py-2.5 rounded-2xl border text-sm font-bold transition-all active:scale-95 shadow-lg ${
            kioskState === STATES.SCANNING
              ? 'bg-yellow-500/20 border-yellow-400/60 text-yellow-400 cursor-wait'
              : 'bg-white/10 hover:bg-yellow-500/20 border-white/20 hover:border-yellow-400/60 text-white hover:text-yellow-300 disabled:opacity-30 disabled:cursor-not-allowed backdrop-blur-md'
          }`}
        >
          {kioskState === STATES.SCANNING ? (
            <>
              <Scan size={16} className="animate-spin" />
              <span>Procesando imagen...</span>
            </>
          ) : (
            <>
              <Camera size={16} />
              <span>Escanear Credencial</span>
              <QrCode size={14} className="opacity-60" />
            </>
          )}
        </button>

        {/* Controles e indicadores secundarios */}
        <div className="flex items-center gap-3 w-full justify-between flex-wrap">
          {/* Toggle auto-escaneo */}
          <button
            onClick={() => setAutoSnapshotEnabled(v => !v)}
            className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border transition-all ${
              autoSnapshotEnabled
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-zinc-800/80 border-zinc-700 text-zinc-500'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoSnapshotEnabled ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'}`} />
            {autoSnapshotEnabled ? 'Auto-scan ON' : 'Auto-scan OFF'}
          </button>

          {/* Indicadores de modo */}
          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="flex items-center gap-1">
              <Scan size={9} className="text-cyan-400" /> Snapshot + Barcode + OCR
            </span>
            <span className="text-zinc-600">·</span>
            <span>USB listo</span>
          </div>

          {/* Botón Debug (admin o VITE_DEBUG_MODE=true) */}
          {(DEBUG || isAdmin) && (
            <button
              onClick={() => setShowDebugPanel(v => !v)}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${
                showDebugPanel
                  ? 'bg-orange-500/15 border-orange-500/40 text-orange-400'
                  : 'bg-black/40 border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Bug size={10} />
              <span>Debug OCR</span>
            </button>
          )}
        </div>

        {/* Pruebas rápidas (Modo Debug) */}
        {DEBUG && (
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => setShowDebugMenu(v => !v)}
              className="text-zinc-500 hover:text-zinc-300 text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-800 bg-black/40"
            >
              <SlidersHorizontal size={10} />
              <span>Pruebas rápidas</span>
            </button>
            {showDebugMenu && (
              <div className="flex gap-1.5 animate-fade-in">
                <button
                  onClick={() => handleValidation('L21120001')}
                  className="bg-green-700/80 hover:bg-green-600 text-white text-[10px] px-2 py-0.5 rounded border border-green-500/40"
                >
                  ✓ Probar L21120001 (OK)
                </button>
                <button
                  onClick={() => handleValidation('INTRUDER99')}
                  className="bg-red-800/80 hover:bg-red-700 text-white text-[10px] px-2 py-0.5 rounded border border-red-500/40"
                >
                  ⚠ Probar Intruso
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Panel de Depuración Visual OCR ────────────────────────── */}
      {(DEBUG || isAdmin) && showDebugPanel && (
        <div className="absolute top-20 right-4 z-40 w-72 bg-black/90 backdrop-blur-md border border-orange-500/40 rounded-2xl p-3 shadow-2xl pointer-events-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-orange-400 text-[11px] font-bold flex items-center gap-1">
              <Bug size={11} /> Debug OCR / Barcode
            </span>
            <button
              onClick={() => setShowDebugPanel(false)}
              className="text-zinc-500 hover:text-white text-xs px-1.5 py-0.5 rounded border border-zinc-700"
            >✕</button>
          </div>

          {debugInfo ? (
            <div className="flex flex-col gap-2">
              {/* Imágenes capturadas */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-zinc-500 text-[9px] mb-1 uppercase tracking-wide">Color (original)</p>
                  {debugInfo.colorDataUrl ? (
                    <img
                      src={debugInfo.colorDataUrl}
                      alt="ROI Color"
                      className="w-full rounded border border-zinc-700 bg-zinc-900 object-contain"
                      style={{ imageRendering: 'pixelated', maxHeight: 60 }}
                    />
                  ) : (
                    <div className="w-full h-14 bg-zinc-800 rounded border border-zinc-700 flex items-center justify-center text-zinc-600 text-[9px]">sin imagen</div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-zinc-500 text-[9px] mb-1 uppercase tracking-wide">Binarizado (OCR input)</p>
                  {debugInfo.binarizedDataUrl ? (
                    <img
                      src={debugInfo.binarizedDataUrl}
                      alt="ROI Binarizado"
                      className="w-full rounded border border-zinc-700 bg-white object-contain"
                      style={{ imageRendering: 'pixelated', maxHeight: 60 }}
                    />
                  ) : (
                    <div className="w-full h-14 bg-zinc-800 rounded border border-zinc-700 flex items-center justify-center text-zinc-600 text-[9px]">sin imagen</div>
                  )}
                </div>
              </div>

              {/* Matrícula extraída */}
              <div className="flex items-center justify-between bg-zinc-900 border border-zinc-700 rounded p-1.5">
                <span className="text-zinc-400 text-[9px] uppercase tracking-wide">Matrícula detectada:</span>
                <span className="font-mono font-bold text-[11px] text-yellow-400">
                  {debugInfo.matricula || <span className="text-zinc-600 font-normal italic">No detectada</span>}
                </span>
              </div>

              {/* Texto raw OCR */}
              <div>
                <p className="text-zinc-500 text-[9px] uppercase tracking-wide mb-0.5">Texto raw OCR</p>
                <div className="bg-zinc-900 border border-zinc-700 rounded p-1.5 font-mono text-[10px] text-green-300 break-all min-h-[24px] max-h-16 overflow-y-auto whitespace-pre-wrap">
                  {debugInfo.rawText || <span className="text-zinc-600 italic">sin texto</span>}
                </div>
              </div>

              {/* Métricas */}
              <div className="flex gap-2 text-[9px]">
                <span className="text-zinc-500">Confianza: <span className={`font-mono font-bold ${debugInfo.confidence > 50 ? 'text-green-400' : 'text-orange-400'}`}>{debugInfo.confidence}%</span></span>
                <span className="text-zinc-500">Tiempo: <span className="font-mono text-cyan-400">{debugInfo.timeTaken}ms</span></span>
                {debugInfo.barcodeResult && (
                  <span className="text-zinc-500">Engine: <span className="text-yellow-400">{debugInfo.barcodeResult.engine}</span></span>
                )}
              </div>

              {/* Timestamp */}
              <p className="text-zinc-700 text-[8px] text-right">
                {new Date(debugInfo.timestamp).toLocaleTimeString('es-MX')}
              </p>
            </div>
          ) : (
            <div className="text-zinc-600 text-[10px] text-center py-4 italic">
              Presiona "Escanear Credencial"<br />para ver el recorte del OCR
            </div>
          )}

          {/* Botón manual de disparo desde el panel */}
          <button
            onClick={() => runSnapshot({ isManual: true })}
            disabled={!cameraOk || kioskState === STATES.SCANNING || kioskState === STATES.VALIDATING}
            className="mt-2 w-full flex items-center justify-center gap-1.5 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-300 text-[10px] font-semibold py-1.5 rounded-xl transition-all disabled:opacity-30 active:scale-95"
          >
            <Camera size={11} /> Capturar ahora
          </button>
        </div>
      )}

      {/* HUD Inferior */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between
                      px-4 py-4 bg-gradient-to-t from-black/85 via-black/40 to-transparent z-20 pointer-events-auto">
        {/* Reloj */}
        <div className="text-white/80 text-xs sm:text-sm font-mono flex items-center gap-1.5">
          <Clock size={13} className="text-yellow-400/80" />
          <LiveClock />
        </div>


        {/* Estado actual del Kiosco */}
        <div className={`text-xs font-medium px-3 py-1.5 rounded-full border backdrop-blur-md ${
          kioskState === STATES.SCANNING
            ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400'
            : kioskState === STATES.VALIDATING
            ? 'bg-blue-500/20 border-blue-500/40 text-blue-400 animate-pulse'
            : 'bg-white/5 border-white/10 text-zinc-400'
        }`}>
          {{
            [STATES.IDLE]:       '● En espera',
            [STATES.SCANNING]:   '◌ Escaneando...',
            [STATES.VALIDATING]: '⟳ Validando...',
          }[kioskState] || '● En espera'}
        </div>
      </div>
    </div>
  )
}
