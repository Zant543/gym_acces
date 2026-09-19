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
│   │   ├── useAuth.js             # Sesión, normalización estricta de roles (admin, docente, kiosco)
│   │   ├── useOfflineSync.js      # Sincronización resiliente sin pérdida de eventos
│   │   └── useRealtimeChannel.js  # Suscripciones WebSocket a Supabase Realtime
│   ├── lib/
│   │   ├── db.js                  # Dexie.js (GymAccessDB: reglas locales y cola de sincronización)
│   │   ├── ocr.js                 # Worker Tesseract.js y captura de credenciales
│   │   ├── barcode.js             # Lector de códigos de barra y QR
│   │   └── supabase.js            # Cliente Supabase, Storage helper y logging tipado
│   ├── pages/
│   │   ├── KioskPage.jsx          # /kiosco - Kiosco híbrido para recepción o torniquete
│   │   ├── LoginPage.jsx          # /login - Acceso seguro y formulario de entrada
│   │   ├── StudentsPage.jsx       # /students - Directorio y búsqueda de socios
│   │   ├── TeacherDashboard.jsx   # /docente - Monitoreo de presencia viva (últimas 2h)
│   │   └── admin/
│   │       └── SyncPage.jsx       # /admin/sync - Alta manual con vencimiento y carga masiva CSV
│   ├── App.jsx                    # Enrutador con protección estricta y pantalla /unauthorized
│   ├── main.jsx
│   └── index.css
├── supabase/
│   ├── schema.sql                 # Esquema base de datos DDL
│   └── migrations/
│       ├── 20260909_teacher_assignments.sql         # Asignaciones iniciales de horarios
│       ├── 20260916_gimnasio_access_migration.sql   # Modelo de membresías y bucket privado
│       ├── 20260917_security_fixes.sql              # RLS de storage, roles y search_path
│       └── 20260918_rename_labs_to_locations.sql    # Semántica locations y recepción por defecto
├── test/
│   └── access_control.test.js     # Suite de pruebas automatizadas
├── .env.example                   # Plantilla de variables de entorno documentadas
├── package.json
└── vite.config.js
```

---

## 🛠️ Puesta en Marcha

### 1. Variables de Entorno
Copia `.env.example` a `.env` y configura tus credenciales de Supabase:
```bash
cp .env.example .env
```
```ini
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-aqui
VITE_KIOSK_LOCATION_ID=00000000-0000-0000-0000-000000000001
VITE_KIOSK_LAB_ID=00000000-0000-0000-0000-000000000001
VITE_DEBUG_MODE=true
```

### 2. Orden de Despliegue de Migraciones en Supabase
Para configurar la base de datos de manera consistente sin dejar tablas con el esquema anterior, ejecuta los siguientes scripts en el **SQL Editor** de Supabase en este orden estricto:

1. `supabase/schema.sql` (únicamente si es una instalación desde cero)
2. `supabase/migrations/20260916_gimnasio_access_migration.sql`
   - Agrega `expiration_date` y `updated_at` a la tabla de socios.
   - Crea la vista `members` y aprovisiona el bucket `access-photos` como privado.
   - Instala la función `validate_access` con validación de membresía vigente.
3. `supabase/migrations/20260917_security_fixes.sql`
   - Aplica políticas RLS estrictas en Storage (solo inserción desde kiosco/admin autenticado, lectura solo admin).
   - Actualiza el constraint de roles en `profiles` a `('admin', 'docente', 'kiosco')`.
   - Revoca acceso público anónimo a `validate_access`.
4. `supabase/migrations/20260918_rename_labs_to_locations.sql`
   - Renombra `labs` a `locations` y `lab_id` a `location_id`.
   - Inserta la ubicación predeterminada `Recepción Principal`.

### 3. Aprovisionamiento Seguro de Cuentas y Roles
En Supabase Dashboard (**Authentication** → **Users**), crea las cuentas de los usuarios y asígnales su rol en la tabla `profiles`:

```sql
-- Ejemplo 1: Crear perfil de Administrador
INSERT INTO profiles (id, role, full_name)
VALUES ('UUID-DEL-USUARIO-EN-AUTH', 'admin', 'Administrador General')
ON CONFLICT (id) DO UPDATE SET role = 'admin';

-- Ejemplo 2: Crear perfil de Instructor / Docente
INSERT INTO profiles (id, role, full_name)
VALUES ('UUID-DEL-USUARIO-EN-AUTH', 'docente', 'Entrenador de Piso')
ON CONFLICT (id) DO UPDATE SET role = 'docente';

-- Ejemplo 3: Crear perfil de Tablet Kiosco (recepción)
INSERT INTO profiles (id, role, full_name)
VALUES ('UUID-DEL-USUARIO-EN-AUTH', 'kiosco', 'Kiosco Recepción')
ON CONFLICT (id) DO UPDATE SET role = 'kiosco';
```
> **Nota de Seguridad**: Si un usuario se autentica pero no tiene un registro correspondiente en la tabla `profiles`, el sistema deniega el acceso automáticamente y lo redirige a `/unauthorized`. El rol nunca se infiere por el correo electrónico.

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
| **Administrador** (`admin`) | `/admin/sync`, `/students`, `/kiosco`, `/docente` | Control total: alta manual de socios con fecha de expiración, importación masiva CSV/Excel, directorio y auditoría. |
| **Kiosco** (`kiosco`) | `/kiosco` | Terminal de punto de acceso para tablet: pad numérico USB y cámara para escaneo de credenciales. Carga fotos de evidencia en accesos denegados. |
| **Instructor** (`docente`) | `/docente`, `/students` | Monitoreo en vivo de socios presentes en la recepción dentro de la ventana de tiempo de 2 horas y consulta del padrón de socios. |

