import React, { useState, useEffect } from 'react'
import {
  Monitor, BookOpen, Shield, Settings2,
  FlaskConical, Clock, Users, Wifi, WifiOff,
  ChevronRight
} from 'lucide-react'
import Header from '../components/layout/Header'
import SiitecCard from '../components/layout/SiitecCard'
import { useAuth } from '../hooks/useAuth'

const ALL_MODULES = [
  {
    id:          'sync',
    href:        '/admin/sync',
    icon:        <Settings2 size={22} />,
    title:       'Administración de Datos',
    description: 'Carga masiva e importación de socios CSV/Excel y sincronización.',
    badge:       'Administración',
    badgeVariant: 'yellow',
    roles:       ['admin'],
  },
  {
    id:          'kiosk',
    href:        '/kiosco',
    icon:        <Monitor size={22} />,
    title:       'Kiosco de Entrada',
    description: 'Control de acceso con cámara OCR y pad numérico USB. Modo pantalla completa para tablet en puerta.',
    badge:       'Puerta',
    badgeVariant: 'green',
    roles:       ['admin'],
  },
  {
    id:          'students',
    href:        '/students',
    icon:        <Users size={22} />,
    title:       'Directorio de Socios',
    description: 'Búsqueda por ID de Socio, nombre, tipo de membresía y estado de acceso.',
    badge:       'Consultas',
    badgeVariant: 'yellow',
    roles:       ['admin', 'docente'],
  },
  {
    id:          'teacher',
    href:        '/docente',
    icon:        <BookOpen size={22} />,
    title:       'Dashboard Instructor',
    description: 'Presencia de socios en tiempo real en la recepción.',
    badge:       'Tiempo real',
    badgeVariant: 'blue',
    roles:       ['admin', 'docente'],
  },
]

// Stats del sistema
const SYSTEM_STATS = [
  { label: 'Ubicación',   value: 'Recepción', icon: <FlaskConical size={16} /> },
  { label: 'Socios Hoy',  value: '127',       icon: <Users size={16} /> },
  { label: 'Hora Actual', value: null,        icon: <Clock size={16} />, dynamic: 'time' },
]

function LiveClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span>{time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
}

export default function HomePage() {
  const { profile } = useAuth()
  const [isOnline] = useState(navigator.onLine)

  // En el Panel Principal del Administrador se muestran TODOS los módulos del sistema
  const visibleModules = ALL_MODULES

  return (
    <div className="min-h-screen bg-[#181818]">
      <Header isOnline={isOnline} title="Panel Principal" />

      <main className="pt-14 px-4 pb-8 max-w-screen-lg mx-auto">
        {/* Saludo */}
        <div className="py-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-white font-extrabold text-2xl leading-tight">
              Bienvenido,{' '}
              <span className="text-gradient-gold">
                {profile?.full_name?.split(' ')[0] || 'Usuario'}
              </span>
            </h1>
            <p className="text-zinc-500 text-sm mt-1">
              {new Date().toLocaleDateString('es-MX', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
              })}
            </p>
          </div>
          {/* Badge de conectividad */}
          <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full shrink-0 ${
            isOnline
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}>
            {isOnline ? <Wifi size={12}/> : <WifiOff size={12}/>}
            {isOnline ? 'En línea' : 'Sin red · Modo Offline'}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {SYSTEM_STATS.map((stat, i) => (
            <div key={i} className="bg-[#282828] border border-zinc-700 rounded-xl p-4 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
                {stat.icon}
                <span>{stat.label}</span>
              </div>
              <p className="text-white font-bold text-xl">
                {stat.dynamic === 'time' ? <LiveClock /> : stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Módulos — Grid 2 columnas estilo SIITEC */}
        <div>
          <h2 className="text-zinc-500 text-xs uppercase tracking-widest font-semibold mb-3">
            Módulos del sistema
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleModules.map(mod => (
              <SiitecCard
                key={mod.id}
                href={mod.href}
                icon={mod.icon}
                title={mod.title}
                description={mod.description}
                badge={mod.badge}
                badgeVariant={mod.badgeVariant}
                onClick={() => {
                  if (mod.id === 'kiosk') sessionStorage.removeItem('kiosk_manual_exit')
                }}
                rightContent={<ChevronRight size={16} className="text-zinc-600" />}
              />
            ))}
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center">
          <p className="text-zinc-700 text-xs">
            GimnasioAccess · Sistema de Control de Acceso · v1.0
          </p>
        </div>
      </main>
    </div>
  )
}
