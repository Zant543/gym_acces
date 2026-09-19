import { Link, useNavigate, useLocation } from 'react-router-dom'
import {
  FlaskConical, LogOut, Wifi, WifiOff, Bell, Menu, X, Shield, Search
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuth, normalizeRole } from '../../hooks/useAuth'

const ROLE_LABELS = {
  admin:   'Administrador',
  docente: 'Instructor',
  kiosco:  'Kiosco',
  teacher: 'Instructor',
  kiosk:   'Kiosco',
}

// Ítems de navegación con restricción por rol
const ALL_NAV_ITEMS = [
  { to: '/admin/sync',          label: 'Sincronización',       roles: ['admin'] },
  { to: '/students',            label: 'Directorio de Socios', roles: ['admin', 'docente'] },
  { to: '/kiosco',              label: 'Kiosco',               roles: ['admin'] },
  { to: '/docente',             label: 'Dashboard Instructor', roles: ['admin', 'docente'] },
]

/**
 * Header institucional fijo al estilo SIITEC.
 * Props:
 *   isOnline  {boolean} - estado de conectividad
 *   title     {string}  - título de página (opcional)
 */
export default function Header({ isOnline = true, title }) {
  const { user, profile, role, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const normalizedRole = normalizeRole(role, user?.email)

  // Sincronizar el campo de búsqueda si la URL cambia en /students
  useEffect(() => {
    if (location.pathname === '/students') {
      const params = new URLSearchParams(location.search)
      setSearchTerm(params.get('search') || '')
    }
  }, [location.pathname, location.search])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    const query = searchTerm.trim()
    if (query) {
      navigate(`/students?search=${encodeURIComponent(query)}`)
    } else {
      navigate('/students')
    }
    setMenuOpen(false)
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const isKioskRoute = location.pathname === '/kiosco' || location.pathname === '/kiosk'

  // En modo kiosco, encabezado mínimo
  if (isKioskRoute) return null

  // Filtrar ítems del menú según el rol actual
  const navItems = ALL_NAV_ITEMS.filter(item =>
    item.roles.map(r => normalizeRole(r)).includes(normalizedRole)
  )

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-[#202020] border-b border-zinc-800 shadow-lg">
      <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center gap-4">

        {/* Logo / Brand */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
            <FlaskConical size={18} className="text-black" />
          </div>
          <div className="hidden sm:block">
            <span className="text-white font-bold text-sm leading-tight block">GimnasioAccess</span>
            <span className="text-zinc-500 text-[10px] leading-tight block">Control de Acceso</span>
          </div>
        </Link>

        {/* Título de página */}
        {title && (
          <div className="hidden md:flex items-center gap-2 ml-2">
            <span className="text-zinc-600">›</span>
            <span className="text-zinc-300 text-sm font-medium">{title}</span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Barra de búsqueda funcional (solo admin y docente) */}
        {(normalizedRole === 'admin' || normalizedRole === 'docente') && (
          <form
            onSubmit={handleSearchSubmit}
            className="hidden md:flex items-center bg-zinc-800 border border-zinc-700 focus-within:border-yellow-500/50 rounded-full px-3 py-1.5 gap-2 w-64 transition-all"
          >
            <button
              type="submit"
              className="text-zinc-500 hover:text-yellow-400 p-0 focus:outline-none transition-colors"
              title="Buscar socio"
            >
              <Search size={14} />
            </button>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-transparent text-xs text-white placeholder-zinc-500 outline-none w-full"
              placeholder="Buscar por ID de Socio o nombre..."
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('')
                  navigate('/students')
                }}
                className="text-zinc-500 hover:text-zinc-300 p-0 focus:outline-none"
                title="Limpiar búsqueda"
              >
                <X size={13} />
              </button>
            )}
          </form>
        )}

        {/* Indicador de conectividad */}
        <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
          isOnline
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {isOnline
            ? <Wifi size={12} />
            : <WifiOff size={12} />}
          <span className="hidden sm:block">{isOnline ? 'En línea' : 'Sin red'}</span>
        </div>


        {/* Info de usuario */}
        {user && (
          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-zinc-700">
            <div className="w-7 h-7 rounded-full bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center">
              <Shield size={13} className="text-yellow-400" />
            </div>
            <div className="text-right">
              <p className="text-white text-xs font-medium leading-tight">{profile?.full_name || user.email?.split('@')[0]}</p>
              <p className="text-yellow-400 text-[10px] leading-tight">{ROLE_LABELS[normalizedRole] || normalizedRole}</p>
            </div>
          </div>
        )}

        {/* Botón cerrar sesión */}
        <button
          onClick={handleSignOut}
          className="p-2 text-zinc-500 hover:text-red-400 transition-colors"
          title="Cerrar sesión"
        >
          <LogOut size={16} />
        </button>

        {/* Hamburger mobile */}
        <button
          className="md:hidden p-2 text-zinc-400"
          onClick={() => setMenuOpen(v => !v)}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile nav — solo ítems permitidos para el rol */}
      {menuOpen && (
        <nav className="md:hidden bg-[#202020] border-t border-zinc-800 px-4 py-3 flex flex-col gap-2 animate-fade-in">
          {/* Búsqueda móvil (solo admin y docente) */}
          {(normalizedRole === 'admin' || normalizedRole === 'docente') && (
            <form onSubmit={handleSearchSubmit} className="flex items-center bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 gap-2 mb-2">
              <Search size={14} className="text-zinc-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por ID de Socio o nombre..."
                className="bg-transparent text-xs text-white placeholder-zinc-500 outline-none w-full"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="text-zinc-500 hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </form>
          )}

          {navItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className="text-zinc-300 hover:text-yellow-400 text-sm py-1.5 transition-colors"
            >
              {item.label}
            </Link>
          ))}
          <button onClick={handleSignOut} className="text-red-400 text-sm text-left py-1.5">
            Cerrar sesión
          </button>
        </nav>
      )}
    </header>
  )
}
