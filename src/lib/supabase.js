import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[GimnasioAccess] Variables de entorno de Supabase no configuradas.\n' +
    'Copia .env.example a .env y rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.'
  )
}

export const supabase = createClient(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseKey  || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession:   true,
      detectSessionInUrl: true
    },
    realtime: {
      params: { eventsPerSecond: 10 }
    }
  }
)

// ── Helpers tipados ──────────────────────────────────────────────

/**
 * Llama al RPC validate_access en Supabase.
 * @param {string} matricula   - ID / Matrícula del socio
 * @param {string} locationId  - UUID de la ubicación (recepción)
 * @returns {Promise<{allowed:boolean, reason:string, message:string, student_id?:string, full_name?:string, career?:string}>}
 */
export async function rpcValidateAccess(matricula, locationId) {
  try {
    const { data, error } = await supabase
      .rpc('validate_access', { p_matricula: matricula, p_lab_id: locationId, p_location_id: locationId })

    if (!error) return data
  } catch {
    // Intento con parámetro único si la versión del esquema no acepta ambos
  }

  const { data, error } = await supabase
    .rpc('validate_access', { p_matricula: matricula })

  if (error) throw error
  return data
}

/**
 * Sube una fotografía de evidencia (base64 dataUrl) al bucket privado 'access-photos' en Supabase Storage.
 * @param {string} dataUrl
 * @param {string} matricula
 * @returns {Promise<string|null>} URL firmada de la foto o null si falla
 */
export async function uploadAccessPhoto(dataUrl, matricula = 'DESCONOCIDO') {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    return null
  }
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const cleanId = String(matricula).replace(/[^a-zA-Z0-9_-]/g, '') || 'DESCONOCIDO'
    const filePath = `evidence/${Date.now()}_${cleanId}.jpg`

    const { error: uploadErr } = await supabase.storage
      .from('access-photos')
      .upload(filePath, blob, {
        contentType: 'image/jpeg',
        upsert: false
      })

    if (uploadErr) {
      console.warn('[Storage] Error al subir foto de evidencia:', uploadErr.message)
      return null
    }

    // Para buckets privados, generar Signed URL temporal (7 días)
    const { data: signedData, error: signErr } = await supabase.storage
      .from('access-photos')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7)

    if (signedData?.signedUrl) {
      return signedData.signedUrl
    }

    const { data } = supabase.storage
      .from('access-photos')
      .getPublicUrl(filePath)

    return data?.publicUrl || filePath
  } catch (err) {
    console.warn('[Storage] Fallo al procesar foto para almacenamiento:', err?.message)
    return null
  }
}

/**
 * Inserta un evento de acceso en access_logs.
 */
export async function insertAccessLog({
  studentId, labId, locationId, status, movementType, photoUrl = null, notes = null
}) {
  const locId = locationId || labId || null
  // Normalizar estatus para respetar el enum access_status ('granted', 'denied', 'intrusion')
  const normalizedStatus =
    (status === 'PERMITIDO' || status === 'granted') ? 'granted' :
    (status === 'INTRUSO' || status === 'intrusion') ? 'intrusion' :
    'denied'

  const { data, error } = await supabase
    .from('access_logs')
    .insert({
      student_id:    studentId || null,
      lab_id:        locId,
      status:        normalizedStatus,
      movement_type: movementType || 'entry',
      photo_url:     photoUrl,
      notes,
      synced_at:     new Date().toISOString()
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Suscripción Realtime al canal de un laboratorio específico.
 * Retorna un objeto canal de Supabase.
 */
export function subscribeToLabLogs(labId, onInsert) {
  return supabase
    .channel(`lab_logs:${labId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'access_logs',
        filter: `lab_id=eq.${labId}`
      },
      (payload) => onInsert(payload.new)
    )
    .subscribe()
}

/**
 * Suscripción Realtime a alertas de seguridad (denied + intrusion globales).
 */
export function subscribeToSecurityAlerts(onAlert) {
  return supabase
    .channel('security_alerts')
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'access_logs',
        filter: `status=in.(denied,intrusion)`
      },
      (payload) => onAlert(payload.new)
    )
    .subscribe()
}
