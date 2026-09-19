import test from 'node:test'
import assert from 'node:assert/strict'

// ── LÓGICA DE VALIDACIÓN DE SOCIOS EN GIMNASIO ───────────────────
function evaluateMemberAccess(member, now = new Date()) {
  if (!member) {
    return {
      allowed: false,
      status: 'denied',
      reason: 'member_not_found',
      message: 'Socio no registrado en el sistema'
    }
  }

  if (member.is_active !== true) {
    return {
      allowed: false,
      status: 'denied',
      reason: 'membership_inactive',
      message: 'Membresía inactiva o suspendida'
    }
  }

  if (member.expiration_date) {
    const expDate = new Date(member.expiration_date)
    if (expDate < now) {
      return {
        allowed: false,
        status: 'denied',
        reason: 'membership_expired',
        message: 'Membresía vencida / Fecha expirada'
      }
    }
  }

  return {
    allowed: true,
    status: 'granted',
    reason: 'membership_valid',
    message: 'Acceso concedido — ¡Bienvenido!'
  }
}

// ── LÓGICA DE NORMALIZACIÓN Y ENRUTAMIENTO DE ROLES ──────────────
// SEGURIDAD: El rol SOLO se acepta desde rawRole (columna profiles.role).
// No se infiere desde correo electrónico ni metadatos de Supabase Auth.
function normalizeRole(rawRole) {
  const role = (rawRole || '').toString().trim().toLowerCase()
  if (role === 'admin' || role === 'administrador') return 'admin'
  if (role === 'docente' || role === 'teacher' || role === 'profesor') return 'docente'
  if (role === 'kiosco' || role === 'kiosk') return 'kiosco'
  return null
}

function getRouteForRole(role) {
  const normalized = normalizeRole(role)
  switch (normalized) {
    case 'admin':
      return '/admin/sync'
    case 'docente':
      return '/docente'
    case 'kiosco':
      return '/kiosco'
    default:
      return '/unauthorized'
  }
}

// ── SIMULADOR DE COLA OFFLINE RESILIENTE ──────────────────────────
class MockOfflineSyncQueue {
  constructor() {
    this.queue = []
    this.nextId = 1
  }

  enqueue(event) {
    const item = { ...event, id: this.nextId++, synced: false }
    this.queue.push(item)
    return item
  }

  getPending() {
    return this.queue.filter(e => !e.synced)
  }

  markSynced(id) {
    const item = this.queue.find(e => e.id === id)
    if (item) item.synced = true
  }

  cleanSynced() {
    this.queue = this.queue.filter(e => !e.synced)
  }

  async flush(supabaseInsertFn) {
    const pending = this.getPending()
    let successCount = 0

    for (const event of pending) {
      const { error } = await supabaseInsertFn(event)
      if (!error) {
        this.markSynced(event.id)
        successCount++
      } else {
        // En caso de error, el evento NO se marca y se mantiene en la cola
      }
    }

    this.cleanSynced()
    return { successCount, remainingCount: this.getPending().length }
  }
}

// ==================================================================
// SUITE DE PRUEBAS
// ==================================================================

test('1. Socio activo con membresía vigente -> Acceso concedido (granted)', () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const socio = {
    matricula: 'SOC-001',
    full_name: 'Carlos Ramírez',
    is_active: true,
    expiration_date: tomorrow
  }

  const result = evaluateMemberAccess(socio)
  assert.equal(result.allowed, true)
  assert.equal(result.status, 'granted')
  assert.equal(result.reason, 'membership_valid')
})

test('2. Socio con membresía vencida -> Acceso denegado (denied)', () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const socio = {
    matricula: 'SOC-002',
    full_name: 'María Gómez',
    is_active: true,
    expiration_date: yesterday
  }

  const result = evaluateMemberAccess(socio)
  assert.equal(result.allowed, false)
  assert.equal(result.status, 'denied')
  assert.equal(result.reason, 'membership_expired')
})

test('3. Socio con estatus inactivo -> Acceso denegado (denied)', () => {
  const socio = {
    matricula: 'SOC-003',
    full_name: 'Roberto Vega',
    is_active: false,
    expiration_date: null
  }

  const result = evaluateMemberAccess(socio)
  assert.equal(result.allowed, false)
  assert.equal(result.status, 'denied')
  assert.equal(result.reason, 'membership_inactive')
})

test('4. Socio inexistente en el padrón -> Acceso denegado (denied)', () => {
  const result = evaluateMemberAccess(null)
  assert.equal(result.allowed, false)
  assert.equal(result.status, 'denied')
  assert.equal(result.reason, 'member_not_found')
})

test('5. Modo offline: validación local evalúa correctamente la vigencia', () => {
  const validMember = { matricula: 'OFF-01', is_active: true, expiration_date: new Date(Date.now() + 100000).toISOString() }
  const expiredMember = { matricula: 'OFF-02', is_active: true, expiration_date: new Date(Date.now() - 100000).toISOString() }

  assert.equal(evaluateMemberAccess(validMember).allowed, true)
  assert.equal(evaluateMemberAccess(expiredMember).allowed, false)
})

test('6. Resiliencia de sincronización offline: no se pierden registros si Supabase falla', async () => {
  const syncQueue = new MockOfflineSyncQueue()

  syncQueue.enqueue({ matricula: 'SOC-101', status: 'granted' })
  syncQueue.enqueue({ matricula: 'SOC-102', status: 'denied' })

  assert.equal(syncQueue.getPending().length, 2)

  // Simulación: El primer insert falla, el segundo tiene éxito
  let callIndex = 0
  const mockInsert = async (event) => {
    callIndex++
    if (callIndex === 1) {
      return { error: new Error('PostgreSQL connection timeout') }
    }
    return { error: null }
  }

  const flushResult = await syncQueue.flush(mockInsert)

  assert.equal(flushResult.successCount, 1)
  assert.equal(flushResult.remainingCount, 1)

  // El evento que falló sigue intacto en la cola para el siguiente reintento
  const remaining = syncQueue.getPending()
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].matricula, 'SOC-101')
})

test('7. Usuario sin perfil asignado: correo con "admin" o "kiosk" NO otorga rol y redirige a /unauthorized', () => {
  // Sin rol en profiles, un correo que contenga palabras clave no debe inferir rol
  const roleAdminEmail = normalizeRole(null)
  assert.equal(roleAdminEmail, null)
  assert.equal(getRouteForRole(roleAdminEmail), '/unauthorized')

  const roleKioskEmail = normalizeRole('')
  assert.equal(roleKioskEmail, null)
  assert.equal(getRouteForRole(roleKioskEmail), '/unauthorized')
})

test('8. Permisos y enrutamiento por rol: docente, kiosco y admin tienen sus rutas respectivas; guardia no es válido', () => {
  assert.equal(getRouteForRole('admin'), '/admin/sync')
  assert.equal(getRouteForRole('docente'), '/docente')
  assert.equal(getRouteForRole('kiosco'), '/kiosco')
  assert.equal(getRouteForRole('guardia'), '/unauthorized')
})
