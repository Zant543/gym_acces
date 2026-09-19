/**
 * useAuth.js — Hook de autenticación con Supabase Auth
 * Expone: user, profile, role, loading, signIn, signOut, flags de roles
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Normaliza el rol proveniente de la tabla `profiles` a uno de los 3 roles
 * válidos del sistema: 'admin', 'docente', 'kiosco'.
 *
 * SEGURIDAD: El rol SOLO se acepta desde rawRole (columna profiles.role).
 * No se infiere desde correo electrónico ni metadatos de Supabase Auth.
 * Un usuario sin fila en profiles siempre recibe null → redirigido a /unauthorized.
 *
 * Se acepta 'teacher'/'kiosk' como alias de migración para cuentas existentes.
 */
export function normalizeRole(rawRole) {
  const role = (rawRole || '').toString().trim().toLowerCase()
  if (role === 'admin' || role === 'administrador') return 'admin'
  if (role === 'docente' || role === 'teacher' || role === 'profesor') return 'docente'
  if (role === 'kiosco' || role === 'kiosk') return 'kiosco'
  return null
}

/**
 * Retorna la ruta inicial o área según el rol normalizado
 */
export function getRouteForRole(role) {
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

export function useAuth() {
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return null
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (!error && data) {
        const role = data.role ? data.role.toLowerCase().trim() : null
        const normalizedProfile = {
          ...data,
          role
        }
        setProfile(normalizedProfile)
        return normalizedProfile
      }
    } catch (err) {
      console.warn('[useAuth] Error cargando perfil:', err)
    }
    return null
  }, [])

  useEffect(() => {
    let isMounted = true

    // Sesión inicial
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser?.id) {
        await fetchProfile(currentUser.id)
      }
      if (isMounted) {
        setLoading(false)
      }
    })

    // Listener de cambios de sesión
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return
        const currentUser = session?.user ?? null
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          setLoading(true)
        }
        setUser(currentUser)
        if (currentUser?.id) {
          await fetchProfile(currentUser.id)
        } else {
          setProfile(null)
        }
        if (isMounted) {
          setLoading(false)
        }
      }
    )

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  const signIn = useCallback(async (email, password) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      let userProfile = null
      if (data?.user?.id) {
        setUser(data.user)
        userProfile = await fetchProfile(data.user.id)
      }
      setLoading(false)
      return { ...data, profile: userProfile }
    } catch (err) {
      setLoading(false)
      throw err
    }
  }, [fetchProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }, [])

  // Normalizar el rol — solo desde profiles.role, nunca desde email ni metadatos
  const rawRole = profile?.role ? profile.role.toLowerCase().trim() : null
  const effectiveRole = normalizeRole(rawRole)

  return {
    user,
    profile,
    role:       effectiveRole,
    locationId: profile?.location_id ?? profile?.lab_id ?? null,
    labId:      profile?.location_id ?? profile?.lab_id ?? null,
    loading,
    signIn,
    signOut,
    isAdmin:   effectiveRole === 'admin',
    isTeacher: effectiveRole === 'docente',
    isDocente: effectiveRole === 'docente',
    isKiosk:   effectiveRole === 'kiosco',
    isKiosco:  effectiveRole === 'kiosco',
  }
}


