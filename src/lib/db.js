/**
 * db.js — IndexedDB (Dexie.js) para soporte Offline-First
 *
 * Stores:
 *   accessRules — reglas de acceso / padrón sincronizado al inicio del día
 *   syncQueue   — eventos pendientes de subir a Supabase
 */
import Dexie from 'dexie'

export const db = new Dexie('GymAccessDB')

db.version(1).stores({
  // Reglas de acceso / socios permitidos
  accessRules: '++id, matricula, locationId, labId, scheduleId, startTime, endTime, subjectName, studentName, syncDate',

  // Cola de sincronización: eventos capturados sin conexión
  syncQueue: '++id, locationId, labId, studentId, matricula, status, movementType, timestamp, photoDataUrl, synced',
})

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Sincroniza las reglas de acceso de HOY desde Supabase a IndexedDB.
 * Se llama al arrancar el kiosco o cuando vuelve la conexión.
 *
 * @param {Array} rules - Array de objetos {matricula, locationId, ...} desde Supabase
 */
export async function syncAccessRules(rules) {
  const today = new Date().toISOString().split('T')[0]

  // Limpiar reglas del día anterior
  await db.accessRules.where('syncDate').below(today).delete()

  // Insertar reglas nuevas (ignorar duplicados)
  const records = rules.map(r => ({
    ...r,
    locationId: r.locationId || r.labId || null,
    labId:      r.locationId || r.labId || null,
    syncDate:   today
  }))
  await db.accessRules.bulkPut(records)

  console.log(`[GymAccess DB] ${records.length} registros de socios sincronizados para ${today}`)
}

/**
 * Verifica si un socio tiene acceso vigente ahora mismo (offline).
 *
 * @param {string} matricula - ID / Clave de Socio
 * @returns {Promise<{allowed:boolean, rule?:object}>}
 */
export async function checkAccessOffline(matricula) {
  const rule = await db.accessRules
    .where('matricula').equals(matricula)
    .first()

  if (!rule) return { allowed: false, rule: null }

  const expDate = rule.expirationDate ? new Date(rule.expirationDate) : null
  const isExpired = expDate ? expDate < new Date() : false

  return (!isExpired && (rule.isActive ?? true))
    ? { allowed: true,  rule }
    : { allowed: false, rule }
}

/**
 * Agrega un evento a la cola de sincronización offline.
 */
export async function enqueueEvent({ locationId, labId, studentId, matricula, status, movementType, photoDataUrl }) {
  const locId = locationId || labId || null
  return db.syncQueue.add({
    locationId:   locId,
    labId:        locId,
    studentId:    studentId || null,
    matricula:    matricula || null,
    status,
    movementType,
    timestamp:    new Date().toISOString(),
    photoDataUrl: photoDataUrl || null,
    synced:       false
  })
}

/**
 * Retorna todos los eventos pendientes de sincronizar.
 */
export async function getPendingEvents() {
  return db.syncQueue.where('synced').equals(0).toArray()
}

/**
 * Marca un evento como sincronizado.
 */
export async function markEventSynced(id) {
  return db.syncQueue.update(id, { synced: true })
}

/**
 * Elimina eventos ya sincronizados (limpieza periódica).
 */
export async function cleanSyncedEvents() {
  return db.syncQueue.where('synced').equals(1).delete()
}

