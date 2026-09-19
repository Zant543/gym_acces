import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlaskConical, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useAuth, normalizeRole, getRouteForRole } from '../hooks/useAuth'

const DEMO_ACCOUNTS = [
  { role: 'admin',   email: 'admin@gimnasioaccess.com',   label: 'Administrador' },
  { role: 'docente', email: 'instructor@gimnasioaccess.com', label: 'Instructor' },
  { role: 'kiosco',  email: 'kiosco@gimnasioaccess.com',  label: 'Kiosco' },
]

export default function LoginPage() {
  const { user, role, loading: authLoading, signIn } = useAuth()
  const navigate   = useNavigate()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Si el usuario ya está previamente autenticado, redirigir a su vista correspondiente
  useEffect(() => {
    if (!authLoading && user && !loading) {
      navigate(getRouteForRole(role), { replace: true })
    }
  }, [user, role, authLoading, loading, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const authData = await signIn(email, password)
      const userProfile = authData?.profile
      const rawRole = userProfile?.role ? userProfile.role.toLowerCase().trim() : null
      const effectiveRole = normalizeRole(rawRole)

      // Redirección hacia la ruta adecuada según el rol:
      // admin -> /admin/sync
      // docente -> /docente
      // kiosco -> /kiosco
      if (effectiveRole === 'docente') {
        // Modal eliminado — no se requiere limpiar sessionStorage
      }
      const targetRoute = getRouteForRole(effectiveRole)
      navigate(targetRoute, { replace: true })
    } catch (err) {
      setError(err.message || 'Credenciales incorrectas. Verifica tu email y contraseña.')
    } finally {
      setLoading(false)
    }
  }

  const fillDemo = (demoEmail) => {
    setEmail(demoEmail)
    setPassword('Demo1234!')
    setError(null)
  }

  return (
    <div className="min-h-screen bg-[#181818] flex flex-col items-center justify-center px-4 py-12">
      {/* Card principal */}
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-yellow-500 rounded-2xl flex items-center justify-center shadow-lg mb-4">
            <FlaskConical size={32} className="text-black" />
          </div>
          <h1 className="text-2xl font-extrabold text-white">GimnasioAccess</h1>
          <p className="text-zinc-500 text-sm mt-1">Control de Acceso y Presencia</p>
        </div>

        {/* Formulario */}
        <div className="bg-[#282828] border border-zinc-700 rounded-2xl p-6 shadow-xl">
          <h2 className="text-white font-bold text-lg mb-5">Iniciar Sesión</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="text-zinc-400 text-xs font-medium block mb-1.5">
                Correo institucional
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="siitec-input pl-9"
                  placeholder="usuario@tecnm-colima.edu.mx"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Contraseña */}
            <div>
              <label className="text-zinc-400 text-xs font-medium block mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="siitec-input pl-9 pr-10"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/30 rounded-lg p-3 animate-fade-in">
                <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-red-400 text-xs leading-snug">{error}</p>
              </div>
            )}

            {/* Botón */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-sm mt-1 flex items-center justify-center gap-2"
            >
              {loading && (
                <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              )}
              {loading ? 'Autenticando...' : 'Ingresar al sistema'}
            </button>
          </form>
        </div>

        {/* Cuentas demo */}
        {import.meta.env.VITE_DEBUG_MODE === 'true' && (
          <div className="mt-5 bg-[#242424] border border-zinc-700/50 rounded-xl p-4">
            <p className="text-zinc-500 text-xs text-center mb-3 font-medium uppercase tracking-wider">
              Cuentas de demostración
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map(acc => (
                <button
                  key={acc.role}
                  onClick={() => fillDemo(acc.email)}
                  className="text-left bg-zinc-800 hover:bg-zinc-700 border border-zinc-700
                             rounded-lg px-3 py-2 transition-colors"
                >
                  <span className="text-yellow-400 text-xs font-semibold block">{acc.label}</span>
                  <span className="text-zinc-500 text-[10px] block truncate">{acc.email}</span>
                </button>
              ))}
            </div>
            <p className="text-zinc-600 text-[10px] text-center mt-2">
              Contraseña: <code className="text-zinc-500">Demo1234!</code> · Crea los usuarios en Supabase Auth
            </p>
          </div>
        )}

        <p className="text-zinc-700 text-xs text-center mt-6">
          GimnasioAccess · Sistema de Control de Acceso v1.0
        </p>
      </div>
    </div>
  )
}
