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
  // 1. Intentar con p_location_id (esquema oficial renombrado)
  if (locationId) {
    const resLoc = await supabase
      .rpc('validate_access', { p_matricula: matricula, p_location_id: locationId })
    if (!resLoc.error) return resLoc.data

    // 2. Si falla porque la base de datos conserva el parámetro previo, intentar con p_lab_id
    const resLab = await supabase
      .rpc('validate_access', { p_matricula: matricula, p_lab_id: locationId })
    if (!resLab.error) return resLab.data
  }

  // 3. Fallback en caso de función de parámetro único
  const resMat = await supabase
    .rpc('validate_access', { p_matricula: matricula })
  if (!resMat.error) return resMat.data

  throw resMat.error
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
    const { data: signedData } = await supabase.storage
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

let cachedDefaultLocationId = null

/**
 * Obtiene un ID de ubicación válido existente en la base de datos.
 */
export async function getDefaultLocationId() {
  if (cachedDefaultLocationId) return cachedDefaultLocationId
  try {
    const { data: loc } = await supabase.from('locations').select('id').limit(1).maybeSingle()
    if (loc?.id) {
      cachedDefaultLocationId = loc.id
      return loc.id
    }
  } catch {}
  try {
    const { data: lab } = await supabase.from('labs').select('id').limit(1).maybeSingle()
    if (lab?.id) {
      cachedDefaultLocationId = lab.id
      return lab.id
    }
  } catch {}
  return '00000000-0000-0000-0000-000000000001'
}

/**
 * Inserta un evento de acceso en access_logs.
 * Soporta de forma transparente tanto location_id (esquema actual) como lab_id (esquema anterior).
 */
export async function insertAccessLog({
  studentId, labId, locationId, status, movementType, photoUrl = null, notes = null
}) {
  let locId = locationId || labId || null
  if (!locId) {
    locId = await getDefaultLocationId()
  }

  const normalizedStatus =
    (status === 'PERMITIDO' || status === 'granted') ? 'granted' :
    (status === 'INTRUSO' || status === 'intrusion') ? 'intrusion' :
    'denied'

  // 1. Intentar con location_id (esquema oficial)
  const payloadLocation = {
    student_id:    studentId || null,
    location_id:   locId,
    status:        normalizedStatus,
    movement_type: movementType || 'entry',
    photo_url:     photoUrl,
    notes,
    synced_at:     new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('access_logs')
    .insert(payloadLocation)
    .select()
    .maybeSingle()

  if (!error) return data || payloadLocation
  if (error.code === 'PGRST116') return payloadLocation

  // 2. Si la columna location_id no existe en la base de datos aún (error 42703), usar lab_id
  if (error.code === '42703' || error.message?.includes('location_id')) {
    const payloadLab = {
      student_id:    studentId || null,
      lab_id:        locId,
      status:        normalizedStatus,
      movement_type: movementType || 'entry',
      photo_url:     photoUrl,
      notes,
      synced_at:     new Date().toISOString()
    }

    const { data: dataLab, error: errLab } = await supabase
      .from('access_logs')
      .insert(payloadLab)
      .select()
      .maybeSingle()

    if (!errLab || errLab.code === 'PGRST116') return dataLab || payloadLab
    throw errLab
  }

  // 3. Si falló por clave foránea (el ID de ubicación no existe en la BD), resolver primer ID real
  if (error.code === '23503' || error.message?.includes('foreign key')) {
    const fallbackId = await getDefaultLocationId()
    if (fallbackId && fallbackId !== locId) {
      payloadLocation.location_id = fallbackId
      const { data: retryData, error: retryErr } = await supabase
        .from('access_logs')
        .insert(payloadLocation)
        .select()
        .maybeSingle()
      if (!retryErr || retryErr.code === 'PGRST116') return retryData || payloadLocation
    }
  }

  throw error
}

/**
 * Suscripción Realtime al canal de una ubicación específica.
 */
export function subscribeToLocationLogs(locationId, onInsert) {
  return supabase
    .channel(`location_logs:${locationId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'access_logs',
        filter: `location_id=eq.${locationId}`
      },
      (payload) => onInsert(payload.new)
    )
    .subscribe()
}

export const subscribeToLabLogs = subscribeToLocationLogs

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
