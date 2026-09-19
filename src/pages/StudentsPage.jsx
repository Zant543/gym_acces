import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Users, Search, Filter, X, ArrowLeft, RefreshCw,
  UserCheck, CheckCircle2, UserX, Clock, AlertCircle
} from 'lucide-react'
import Header from '../components/layout/Header'
import SiitecCard from '../components/layout/SiitecCard'
import { supabase } from '../lib/supabase'

export default function StudentsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialSearch = searchParams.get('search') || ''

  const [searchQuery, setSearchQuery] = useState(initialSearch)
  const [students, setStudents]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [careerFilter, setCareerFilter] = useState('ALL')
  const [isOnline] = useState(navigator.onLine)

  const [error, setError]             = useState(null)

  // Sincronizar input si la URL cambia externamente (ej. desde el Header)
  useEffect(() => {
    const q = searchParams.get('search') || ''
    setSearchQuery(q)
  }, [searchParams])

  const fetchStudents = useCallback(async (query) => {
    setLoading(true)
    setError(null)
    try {
      let req = supabase
        .from('students')
        .select('*')
        .order('full_name', { ascending: true })

      if (query && query.trim()) {
        const term = query.trim()
        req = req.or(`matricula.ilike.%${term}%,full_name.ilike.%${term}%,career.ilike.%${term}%`)
      }

      const { data, error: fetchErr } = await req
      if (fetchErr) throw fetchErr

      setStudents(data || [])
    } catch (err) {
      console.error('[StudentsPage] Error fetching students from Supabase:', err.message)
      setStudents([])
      setError('No fue posible conectar con la base de datos para cargar el directorio de socios.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStudents(initialSearch)
  }, [fetchStudents, initialSearch])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      setSearchParams({ search: searchQuery.trim() })
    } else {
      setSearchParams({})
    }
    fetchStudents(searchQuery)
  }

  const clearSearch = () => {
    setSearchQuery('')
    setSearchParams({})
    fetchStudents('')
  }

  // Filtrado por carrera en cliente
  const careers = ['ALL', ...new Set(students.map(s => s.career).filter(Boolean))]
  const filteredStudents = students.filter(s => {
    if (careerFilter !== 'ALL' && s.career !== careerFilter) return false
    return true
  })

  return (
    <div className="min-h-screen bg-[#181818]">
      <Header isOnline={isOnline} title="Directorio de Socios" />

      <main className="pt-14 px-4 pb-8 max-w-screen-lg mx-auto">
        {/* Encabezado */}
        <div className="py-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/admin'))}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                title="Volver"
              >
                <ArrowLeft size={18} />
              </button>
              <h1 className="text-white font-extrabold text-xl flex items-center gap-2">
                <Users size={20} className="text-yellow-400" />
                Directorio de Socios
              </h1>
            </div>
            <p className="text-zinc-500 text-sm">
              Consulta de ID de Socio, tipo de membresía y estado de acceso
            </p>
          </div>

          <button
            onClick={() => fetchStudents(searchQuery)}
            className="btn-secondary flex items-center gap-1.5 text-xs py-1.5"
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>

        {/* Barra de Filtros y Búsqueda */}
        <div className="bg-[#282828] border border-zinc-700 rounded-xl p-4 mb-6 shadow-md">
          <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por ID de Socio o nombre..."
                className="siitec-input pl-9 pr-8 py-2 text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white p-0.5"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Filtro de carrera */}
            {careers.length > 2 && (
              <div className="relative min-w-[200px]">
                <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                <select
                  value={careerFilter}
                  onChange={(e) => setCareerFilter(e.target.value)}
                  className="siitec-input pl-8 pr-4 py-2 text-xs appearance-none cursor-pointer bg-zinc-800"
                >
                  <option value="ALL">Todos los tipos de membresía</option>
                  {careers.filter(c => c !== 'ALL').map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}

            <button type="submit" className="btn-primary text-xs py-2 px-4 whitespace-nowrap">
              Buscar
            </button>
          </form>

          {initialSearch && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-700/60 text-xs">
              <span className="text-zinc-500">Filtrando por:</span>
              <span className="badge-yellow font-mono">{initialSearch}</span>
              <button
                onClick={clearSearch}
                className="text-zinc-400 hover:text-white text-xs underline ml-1"
              >
                Quitar filtro
              </button>
            </div>
          )}
        </div>

        {/* Resultados */}
        <div className="flex items-center justify-between mb-3 text-xs text-zinc-400">
          <span>{filteredStudents.length} socio{filteredStudents.length === 1 ? '' : 's'} encontrado{filteredStudents.length === 1 ? '' : 's'}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-16 bg-[#282828] border border-red-500/30 rounded-xl p-6">
            <AlertCircle size={44} className="mx-auto mb-3 text-red-400" />
            <p className="text-white font-semibold">Error al cargar el directorio</p>
            <p className="text-zinc-400 text-xs mt-1 max-w-md mx-auto">
              {error}
            </p>
            <button
              onClick={() => fetchStudents(searchQuery)}
              className="btn-primary text-xs mt-4 inline-flex items-center gap-1.5"
            >
              <RefreshCw size={12} />
              Reintentar
            </button>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="text-center py-16 bg-[#282828] border border-zinc-700 rounded-xl">
            <UserX size={44} className="mx-auto mb-3 text-zinc-600" />
            <p className="text-white font-semibold">No se encontraron socios</p>
            <p className="text-zinc-500 text-xs mt-1">
              Prueba buscando con otro ID de Socio o término de búsqueda.
            </p>
            {searchQuery && (
              <button onClick={clearSearch} className="btn-secondary text-xs mt-4">
                Ver todos los socios
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredStudents.map(student => (
              <SiitecCard
                key={student.id}
                icon={<UserCheck size={20} />}
                title={student.full_name}
                description={student.career || 'Sin membresía asignada'}
                badge={student.matricula}
                badgeVariant="yellow"
                rightContent={
                  student.is_active !== false ? (
                    <span className="badge-green" title="Membresía Activa">
                      <CheckCircle2 size={12} />
                      <span className="hidden sm:inline">Activo</span>
                    </span>
                  ) : (
                    <span className="badge-red" title="Membresía Vencida">
                      Vencida
                    </span>
                  )
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
