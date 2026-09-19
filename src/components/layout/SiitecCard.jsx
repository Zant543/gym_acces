/**
 * SiitecCard — Tarjeta de módulo reutilizable al estilo SIITEC
 *
 * Props:
 *   icon         {ReactNode}  - Ícono de Lucide React
 *   title        {string}     - Título principal (blanco/dorado si activo)
 *   description  {string}     - Descripción secundaria
 *   active       {boolean}    - Estado activo (resalta con amarillo)
 *   badge        {string}     - Texto del badge de estado (opcional)
 *   badgeVariant {string}     - 'green'|'red'|'yellow'|'zinc'|'blue'
 *   onClick      {Function}   - Handler de click
 *   className    {string}     - Clases adicionales
 *   disabled     {boolean}    - Deshabilitar interacción
 *   href         {string}     - Si se provee, renderiza como Link
 *   rightContent {ReactNode}  - Contenido en la derecha (contadores, etc.)
 */
import { Link } from 'react-router-dom'

export default function SiitecCard({
  icon,
  title,
  description,
  active    = false,
  badge,
  badgeVariant = 'zinc',
  onClick,
  className = '',
  disabled  = false,
  href,
  rightContent,
  children
}) {
  const baseClass = `
    siitec-card
    flex items-center gap-4 p-4
    ${active ? 'active' : ''}
    ${disabled ? 'opacity-50 pointer-events-none' : ''}
    ${className}
  `.trim().replace(/\s+/g, ' ')

  const content = (
    <>
      {/* Ícono */}
      {icon && (
        <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center
          ${active
            ? 'bg-yellow-500/20 text-yellow-400'
            : 'bg-zinc-700/60 text-zinc-400'
          }`}>
          {icon}
        </div>
      )}

      {/* Texto */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className={`font-bold text-sm leading-tight truncate
            ${active ? 'text-yellow-400' : 'text-white'}`}>
            {title}
          </h3>
          {badge && (
            <span className={`badge-${badgeVariant}`}>
              {badge}
            </span>
          )}
        </div>
        {description && (
          <p className={`text-xs mt-0.5 leading-snug line-clamp-2
            ${active ? 'text-yellow-300/70' : 'text-zinc-400'}`}>
            {description}
          </p>
        )}
        {children}
      </div>

      {/* Contenido derecho */}
      {rightContent && (
        <div className="shrink-0 ml-auto">{rightContent}</div>
      )}
    </>
  )

  if (href) {
    return <Link to={href} className={baseClass}>{content}</Link>
  }

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick(e) : undefined}
      className={baseClass}
    >
      {content}
    </div>
  )
}
