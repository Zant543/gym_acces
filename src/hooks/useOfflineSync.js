/**
 * useOfflineSync.js — Hook de sincronización offline
 *
 * - Al montar: sincroniza reglas de acceso del día desde Supabase → IndexedDB
 * - Escucha window 'online'/'offline'
 * - Al reconectar: vacía la syncQueue hacia Supabase en batch
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, uploadAccessPhoto } from '../lib/supabase'
import {
  syncAccessRules,
  getPendingEvents,
  markEventSynced,
  cleanSyncedEvents
} from '../lib/db'

export function useOfflineSync(labId) {
  const [isOnline,      setIsOnline]      = useState(navigator.onLine)
  const [isSyncing,     setIsSyncing]     = useState(false)
  const [lastSyncTime,  setLastSyncTime]  = useState(null)
  const [pendingCount,  setPendingCount]  = useState(0)
  const syncLockRef = useRef(false)

  // ── Descarga catálogo de socios activos desde Supabase ─────────
  const downloadAccessRules = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('students')
        .select('id, matricula, full_name, career, is_active, expiration_date')
        .eq('is_active', true)

      if (error) throw error

      const rules = (data || []).map(row => ({
        matricula:      row?.matricula || '',
        studentName:    row?.full_name || 'Desconocido',
        studentId:      row?.id,
        career:         row?.career || '',
        expirationDate: row?.expiration_date || null,
        isActive:       row?.is_active ?? true,
      }))

      await syncAccessRules(rules)
      setLastSyncTime(new Date().toISOString())
      console.log(`[OfflineSync] ${rules.length} socios sincronizados para modo sin conexión`)
    } catch (err) {
      console.warn('[OfflineSync] No se pudieron descargar socios:', err.message)
    }
  }, [])

  // ── Sube eventos pendientes de la cola de forma resiliente ──
  const flushSyncQueue = useCallback(async () => {
    if (syncLockRef.current || !navigator.onLine) return
    syncLockRef.current = true
    setIsSyncing(true)

    try {
      const pending = await getPendingEvents()
      setPendingCount(pending.length)
      if (pending.length === 0) return

      console.log(`[OfflineSync] Procesando ${pending.length} eventos pendientes de sincronizar...`)
      let syncedSuccessCount = 0

      for (const event of pending) {
        try {
          const normalizedStatus =
            (event.status === 'PERMITIDO' || event.status === 'granted') ? 'granted' :
            (event.status === 'INTRUSO' || event.status === 'intrusion') ? 'intrusion' : 'denied'

          let photoUrl = null
          if (event.photoDataUrl) {
            try {
              photoUrl = await uploadAccessPhoto(event.photoDataUrl, event.matricula || 'OFFLINE')
            } catch (pErr) {
              console.warn('[OfflineSync] No se pudo subir foto de evento offline:', pErr.message)
            }
          }

          const locId = event.locationId || event.labId || null
          const payloadLocation = {
            student_id:    event.studentId || null,
            location_id:   locId,
            status:        normalizedStatus,
            movement_type: event.movementType || 'entry',
            photo_url:     photoUrl,
            timestamp:     event.timestamp,
            notes:         'Evento offline sincronizado al reconectar',
            synced_at:     new Date().toISOString()
          }

          let { error: insErr } = await supabase.from('access_logs').insert(payloadLocation)
          if (insErr) {
            // Fallback si la base de datos aún tiene la columna lab_id
            const payloadLab = { ...payloadLocation, lab_id: locId }
            delete payloadLab.location_id
            const resLab = await supabase.from('access_logs').insert(payloadLab)
            insErr = resLab.error
          }

          if (!insErr) {
            await markEventSynced(event.id)
            syncedSuccessCount++
          } else {
            console.warn('[OfflineSync] Error en Supabase al insertar evento offline:', insErr.message)
            // CRÍTICO: NO marcar como sincronizado para permitir reintento y evitar pérdida de datos
          }
        } catch (err) {
          console.warn('[OfflineSync] Excepción al sincronizar evento offline:', event.id, err.message)
        }
      }

      await cleanSyncedEvents()
      const remaining = await getPendingEvents()
      setPendingCount(remaining.length)

      if (syncedSuccessCount > 0) {
        setLastSyncTime(new Date().toISOString())
        console.log(`[OfflineSync] ${syncedSuccessCount} de ${pending.length} eventos sincronizados exitosamente`)
      }
    } finally {
      setIsSyncing(false)
      syncLockRef.current = false
    }
  }, [])

  // ── Listeners de conectividad ────────────────────────────────
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true)
      console.log('[OfflineSync] Conexión restaurada → sincronizando...')
      await flushSyncQueue()
      await downloadAccessRules()
    }
    const handleOffline = () => {
      setIsOnline(false)
      console.warn('[OfflineSync] Sin conexión. Usando caché local.')
    }

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [flushSyncQueue, downloadAccessRules])

  // ── Sincronización inicial al montar ─────────────────────────
  useEffect(() => {
    if (isOnline && labId) {
      downloadAccessRules()
    }
    // Actualizar contador de pendientes al montar
    getPendingEvents().then(p => setPendingCount(p.length))
  }, [labId]) // eslint-disable-line

  return {
    isOnline,
    isSyncing,
    lastSyncTime,
    pendingCount,
    flushSyncQueue,
    downloadAccessRules
  }
}
