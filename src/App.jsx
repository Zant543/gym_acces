import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth, normalizeRole, getRouteForRole } from './hooks/useAuth'

import LoginPage          from './pages/LoginPage'
import HomePage           from './pages/HomePage'
import KioskPage          from './pages/KioskPage'
import TeacherDashboard   from './pages/TeacherDashboard'
import SyncPage           from './pages/admin/SyncPage'
import StudentsPage       from './pages/StudentsPage'

// ── Spinner de carga ─────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#181818] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-400 text-sm">Cargando GimnasioAccess...</p>
      </div>
    </div>
  )
}

// ── Pantalla de Acceso Denegado (Sin Perfil Asignado) ─────────────
function UnauthorizedPage() {
  const { user, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-[#181818] flex items-center justify-center px-4">
      <div className="bg-[#242424] border border-red-500/30 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl animate-fade-in">
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-400">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-white font-extrabold text-xl mb-2">Acceso Denegado</h2>
        <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
          Tu cuenta <span className="text-white font-mono font-medium">{user?.email}</span> está autenticada pero no tiene un perfil o rol asignado en el sistema.
        </p>
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 mb-6 text-xs text-zinc-400">
          Por favor, ponte en contacto con el <strong className="text-white">Administrador del Gimnasio</strong> para que asigne tu rol (administrador, instructor o kiosco) en la tabla <code className="text-yellow-400">profiles</code> de Supabase.
        </div>
        <button
          onClick={() => signOut().then(() => window.location.href = '/login')}
          className="btn-secondary w-full py-2.5 text-xs text-red-400 hover:text-red-300 border-red-500/30 hover:border-red-500/60"
        >
          Cerrar Sesión e Intentar con otra cuenta
        </button>
      </div>
    </div>
  )
}

// ── Redirección automática según rol autenticado ──────────────────
function RoleRedirect() {
  const { role } = useAuth()
  return <Navigate to={getRouteForRole(role)} replace />
}

// ── Ruta protegida por rol ────────────────────────────────────────
function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, isAdmin, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user)   return <Navigate to="/login" replace />

  // El administrador conserva acceso total a cualquiera de los módulos del sistema
  if (isAdmin) {
    return children
  }

  // Si la ruta especifica roles permitidos, verificar con normalización
  if (allowedRoles && allowedRoles.length > 0) {
    const userRole = normalizeRole(role)
    const normalizedAllowed = allowedRoles.map(r => normalizeRole(r))

    // Si el rol del usuario no está autorizado para esta ruta,
    // redirigir a su vista autorizada correspondiente para evitar bucles o pantallas negras
    if (!normalizedAllowed.includes(userRole)) {
      return <Navigate to={getRouteForRole(userRole)} replace />
    }
  }

  return children
}

// ── Enrutamiento principal ────────────────────────────────────────
export default function App() {
  const { loading } = useAuth()
  if (loading) return <LoadingScreen />

  return (
    <BrowserRouter>
      <Routes>
        {/* Pública */}
        <Route path="/login" element={<LoginPage />} />

        {/* Raíz: redirige a la vista correspondiente al rol (admin -> /admin) */}
        <Route path="/" element={
          <ProtectedRoute>
            <RoleRedirect />
          </ProtectedRoute>
        } />

        {/* Panel Principal del Administrador (Hub de Módulos) */}
        <Route path="/admin" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <HomePage />
          </ProtectedRoute>
        } />
        <Route path="/dashboard" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <HomePage />
          </ProtectedRoute>
        } />

        {/* Módulo Docente */}
        <Route path="/docente" element={
          <ProtectedRoute allowedRoles={['docente', 'admin']}>
            <TeacherDashboard />
          </ProtectedRoute>
        } />


        {/* Pantalla para usuarios autenticados sin perfil asignado */}
        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        {/* Módulo Kiosco de acceso */}
        <Route path="/kiosco" element={
          <ProtectedRoute allowedRoles={['kiosco', 'admin']}>
            <KioskPage />
          </ProtectedRoute>
        } />

        {/* Sincronización y configuración de socios (Admin) */}
        <Route path="/admin/sync" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <SyncPage />
          </ProtectedRoute>
        } />

        {/* Directorio de socios: admin e instructor */}
        <Route path="/students" element={
          <ProtectedRoute allowedRoles={['admin', 'docente']}>
            <StudentsPage />
          </ProtectedRoute>
        } />

        {/* Rutas de compatibilidad anteriores */}
        <Route path="/teacher-dashboard" element={<Navigate to="/docente" replace />} />
        <Route path="/security-dashboard" element={<Navigate to="/admin/sync" replace />} />
        <Route path="/guardia" element={<Navigate to="/admin/sync" replace />} />
        <Route path="/kiosk" element={<Navigate to="/kiosco" replace />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

