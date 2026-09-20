/**
 * useRealtimeChannel.js — Hook genérico de suscripción Supabase Realtime
 */
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * @param {string}   channelName   - Nombre único del canal
 * @param {string}   table         - Tabla a escuchar
 * @param {string}   event         - 'INSERT' | 'UPDATE' | 'DELETE' | '*'
 * @param {string}   [filter]      - Filtro de columna ej: 'location_id=eq.xxxx'
 * @param {Function} onEvent       - Callback(payload) llamado en cada evento
 * @param {boolean}  [enabled]     - false para desactivar (por defecto true)
 */
export function useRealtimeChannel({
  channelName,
  table,
  event = 'INSERT',
  filter,
  onEvent,
  enabled = true
}) {
  const channelRef = useRef(null)
  const onEventRef = useRef(onEvent)

  // Mantener referencia al callback actualizada sin re-suscribir
  useEffect(() => { onEventRef.current = onEvent }, [onEvent])

  useEffect(() => {
    if (!enabled || !channelName) return

    const config = {
      event,
      schema: 'public',
      table,
      ...(filter ? { filter } : {})
    }

    channelRef.current = supabase
      .channel(channelName)
      .on('postgres_changes', config, (payload) => {
        onEventRef.current?.(payload)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] Canal "${channelName}" activo`)
        }
        if (status === 'CHANNEL_ERROR') {
          console.warn(`[Realtime] Error en canal "${channelName}"`)
        }
      })

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [channelName, table, event, filter, enabled])
}
