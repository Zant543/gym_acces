# GimnasioAccess — Sistema de Control de Acceso y Membresías PWA

PWA moderna y de alta eficiencia diseñada para ejecutarse en **Modo Kiosco Híbrido** (pad numérico USB y cámara OCR) sobre tablets o terminales en la recepción de gimnasios o centros deportivos. Incluye registro de accesos en tiempo real, monitoreo de seguridad con captura fotográfica de evidencia, gestión individual y masiva de socios, y arquitectura **Offline-First**.

---

## 🚀 Arquitectura y Tecnologías

- **Frontend**: React 18 + Vite, Tailwind CSS, Lucide React, React Router v6.
- **PWA & Service Worker**: `vite-plugin-pwa` con Workbox (estrategias `NetworkFirst` para APIs y `CacheFirst` para activos estáticos).
- **Backend & Base de Datos**: Supabase (PostgreSQL, Row Level Security, Storage Buckets, Canales Realtime vía WebSockets).
- **Almacenamiento Local Offline**: IndexedDB administrado con **Dexie.js** (espejo de socios activos con vigencia y cola resiliente `SyncQueue` para reconexión sin pérdida de datos).
- **Lector Híbrido en Kiosco**:
  - **Primario**: Entrada rápida con Pad Numérico USB / lector de código de barras físico con autofoco permanente.
  - **Respaldo Óptico**: OCR en tiempo real mediante **Tesseract.js** en Web Worker independiente y captura de snapshot.
- **Evidencia Fotográfica**: Carga automática a **Supabase Storage** (bucket `access-photos`) en accesos denegados o intrusiones.

---

## 📁 Estructura del Código

```
gimnasioaccess-pwa/
├── public/
│   ├── favicon.svg            # Isotipo oficial de GimnasioAccess
│   └── icons/
│       ├── icon-192.png       # Icono PWA 192x192
│       ├── icon-512.png       # Icono PWA 512x512
│       └── icon.svg           # Vector de alta resolución
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.jsx     # Barra de navegación con control de roles
│   │   │   └── SiitecCard.jsx # Componente de tarjeta estilizada
│   │   └── ui/
│   │       ├── AlertCard.jsx      # Tarjeta con foto de evidencia para seguridad
│   │       └── StatusOverlay.jsx  # Pantalla completa verde/rojo con tonos de audio
│   ├── hooks/
│   │   ├── useAuth.js             # Sesión, normalización estricta de roles (admin, guardia, kiosco, docente)
│   │   ├── useOfflineSync.js      # Sincronización resiliente sin pérdida de eventos
│   │   └── useRealtimeChannel.js  # Suscripciones WebSocket a Supabase Realtime
│   ├── lib/
│   │   ├── db.js                  # Dexie.js (IndexedDB: reglas locales y cola de sincronización)
│   │   ├── ocr.js                 # Worker Tesseract.js y captura de fotogramas
│   │   └── supabase.js            # Cliente Supabase, Storage helper y logging tipado
│   ├── pages/
│   │   ├── KioskPage.jsx          # /kiosco - Kiosco híbrido para puerta o torniquete
│   │   ├── LoginPage.jsx          # /login - Acceso seguro y cuentas de prueba
│   │   ├── SecurityDashboard.jsx  # /guardia - Monitoreo en vivo de alertas y fotos
│   │   ├── StudentsPage.jsx       # /students - Directorio y búsqueda de socios
│   │   ├── TeacherDashboard.jsx   # /docente - Monitoreo de presencia viva (últimas 2h)
│   │   └── admin/
│   │       └── SyncPage.jsx       # /admin/sync - Alta manual de socio y carga masiva CSV
│   ├── App.jsx                    # Enrutador con protección estricta y pantalla /unauthorized
│   ├── main.jsx
│   └── index.css
├── supabase/
│   ├── schema.sql                 # Esquema base de datos DDL
│   └── migrations/
│       └── 20260916_gimnasio_access_migration.sql # Migración reversible para gimnasio y Storage
├── test/
│   └── access_control.test.js     # Suite de pruebas automatizadas
├── .env.example                   # Plantilla de variables de entorno documentadas
├── package.json
└── vite.config.js
```

---

## 🛠️ Puesta en Marcha

### 1. Variables de Entorno
Copia `.env.example` a `.env` y configura tus claves de Supabase:
```bash
cp .env.example .env
```
```ini
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-aqui
VITE_KIOSK_LAB_ID=11111111-1111-1111-1111-111111111111
VITE_DEBUG_MODE=true
```

### 2. Migración de Base de Datos en Supabase
Ejecuta el script SQL en el **SQL Editor** de tu proyecto Supabase:
```
supabase/migrations/20260916_gimnasio_access_migration.sql
```
Este script:
- Agrega las columnas `expiration_date` y `updated_at` a la tabla `students` (conservando todos los registros).
- Crea la vista `members` para el gimnasio.
- Provisiona el bucket `access-photos` en Supabase Storage con políticas RLS.
- Actualiza la función de validación segura `validate_access`.

### 3. Aprovisionamiento Seguro de Cuentas y Roles
En Supabase Dashboard (**Authentication** → **Users**), crea las cuentas necesarias y luego asígnales su rol en la tabla `profiles`:

```sql
-- Ejemplo: Crear perfil de administrador
INSERT INTO profiles (id, role, full_name)
VALUES ('UUID-DEL-USUARIO-EN-AUTH', 'admin', 'Administrador Principal')
ON CONFLICT (id) DO UPDATE SET role = 'admin';

-- Ejemplo: Crear perfil de guardia de seguridad
INSERT INTO profiles (id, role, full_name)
VALUES ('UUID-DEL-USUARIO-EN-AUTH', 'guardia', 'Oficial de Seguridad')
ON CONFLICT (id) DO UPDATE SET role = 'guardia';

-- Ejemplo: Crear perfil de tablet Kiosco
INSERT INTO profiles (id, role, full_name)
VALUES ('UUID-DEL-USUARIO-EN-AUTH', 'kiosco', 'Kiosco Recepción')
ON CONFLICT (id) DO UPDATE SET role = 'kiosco';
```
> **Nota de Seguridad**: Si un usuario se autentica pero no tiene un registro correspondiente en la tabla `profiles`, el sistema deniega el acceso automáticamente y lo redirige a `/unauthorized`.

### 4. Ejecución en Desarrollo y Pruebas
```bash
# Iniciar servidor de desarrollo
npm run dev

# Ejecutar suite de pruebas unitarias
npm test

# Compilar para producción (PWA)
npm run build
```

---

## 🔐 Roles y Módulos Disponibles

| Rol | Rutas Autorizadas | Descripción |
|---|---|---|
| **Administrador** | `/admin/sync`, `/students`, `/guardia`, `/kiosco`, `/docente` | Control total: alta manual de socios, carga CSV/Excel, directorio y configuración. |
| **Guardia** | `/guardia`, `/students` | Monitoreo en tiempo real de accesos denegados e intrusiones con foto de evidencia. |
| **Kiosco** | `/kiosco` | Terminal de punto de acceso para tablet: pad numérico USB y cámara OCR. |
| **Instructor** | `/docente`, `/students` | Monitoreo en vivo de socios presentes en la recepción dentro de la ventana de 2 horas. |
