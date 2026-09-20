-- ============================================================
-- GimnasioAccess PWA — Esquema PostgreSQL / Supabase
-- Sistema de Control de Acceso y Membresías
-- ============================================================

-- 1. EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- búsqueda por similitud de texto

-- 2. TIPOS ENUM
-- ============================================================
DO $$ BEGIN
  CREATE TYPE access_status  AS ENUM ('granted', 'denied', 'intrusion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE movement_type  AS ENUM ('entry', 'exit', 'temp_exit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE presence_status AS ENUM ('present_on_time', 'present_late', 'temp_out', 'absent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. TABLAS PRINCIPALES
-- ============================================================

-- 3.1 Ubicaciones (recepción, sucursales, etc.)
CREATE TABLE IF NOT EXISTS labs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code         TEXT UNIQUE NOT NULL,             -- ej: RECEPCION
  name         TEXT NOT NULL,                    -- Recepción Principal
  location     TEXT,                             -- Planta Baja, Entrada
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3.2 Perfiles de usuario (roles del sistema)
-- Creado antes de schedules para resolver la dependencia foránea teacher_id REFERENCES profiles(id)
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'docente', 'kiosco')),
  lab_id     UUID REFERENCES labs(id),    -- para kiosco/docente: su ubicación asignada
  full_name  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3.3 Socios
CREATE TABLE IF NOT EXISTS students (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  matricula    TEXT UNIQUE NOT NULL,             -- ID / Clave de Socio
  full_name    TEXT NOT NULL,
  career       TEXT,                             -- Tipo de membresía
  photo_url    TEXT,                             -- foto de perfil (opcional)
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_students_matricula ON students USING btree (matricula);
CREATE INDEX IF NOT EXISTS idx_students_name_trgm  ON students USING gin  (full_name gin_trgm_ops);

-- 3.4 Horarios de práctica
CREATE TABLE IF NOT EXISTS schedules (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id       UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  teacher_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- Vinculación directa con la cuenta del instructor
  subject_name TEXT NOT NULL,
  teacher_name TEXT,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  days_of_week INTEGER[] NOT NULL,               -- {1,3,5} = Lun, Mié, Vie (ISO: 1=Lun..7=Dom)
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_time_order CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_schedules_lab ON schedules(lab_id);
CREATE INDEX IF NOT EXISTS idx_schedules_teacher ON schedules(teacher_id);

-- 3.5 Inscripciones
CREATE TABLE IF NOT EXISTS enrollments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id   UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
  schedule_id  UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, schedule_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_student  ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_schedule ON enrollments(schedule_id);

-- 3.6 Registro de accesos / eventos
CREATE TABLE IF NOT EXISTS access_logs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id     UUID REFERENCES students(id) ON DELETE SET NULL,  -- NULL = desconocido
  lab_id         UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  timestamp      TIMESTAMPTZ DEFAULT NOW(),
  status         access_status  NOT NULL,   -- granted | denied | intrusion
  movement_type  movement_type  NOT NULL,   -- entry | exit | temp_exit
  photo_url      TEXT,                      -- URL foto capturada en denegados/intrusiones
  notes          TEXT,
  synced_at      TIMESTAMPTZ               -- NULL = pendiente de sincronizar desde offline
);
CREATE INDEX IF NOT EXISTS idx_access_logs_lab       ON access_logs(lab_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_student   ON access_logs(student_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_status    ON access_logs(status);


-- 3.7 Cola de sincronización offline (espejo local de SyncQueue de IndexedDB)
CREATE TABLE IF NOT EXISTS sync_queue_server (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed  BOOLEAN DEFAULT FALSE
);

-- 4. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE labs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE students     ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;

-- Helper: función para obtener el rol del usuario actual
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper: función para obtener el lab del usuario actual
CREATE OR REPLACE FUNCTION get_user_lab_id()
RETURNS UUID AS $$
  SELECT lab_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- 4.1 Políticas: LABS
DROP POLICY IF EXISTS "labs_read_all"    ON labs;
DROP POLICY IF EXISTS "labs_admin_write" ON labs;

CREATE POLICY "labs_read_all"    ON labs FOR SELECT TO authenticated USING (true);
CREATE POLICY "labs_admin_write" ON labs FOR ALL    TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 4.2 Políticas: STUDENTS
DROP POLICY IF EXISTS "students_read"        ON students;
DROP POLICY IF EXISTS "students_admin_write" ON students;

CREATE POLICY "students_read"        ON students FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin','docente','kiosco'));
CREATE POLICY "students_admin_write" ON students FOR ALL TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 4.3 Políticas: SCHEDULES
DROP POLICY IF EXISTS "schedules_read"        ON schedules;
DROP POLICY IF EXISTS "schedules_admin_write" ON schedules;

CREATE POLICY "schedules_read"        ON schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "schedules_admin_write" ON schedules FOR ALL TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 4.4 Políticas: ENROLLMENTS
DROP POLICY IF EXISTS "enrollments_read"        ON enrollments;
DROP POLICY IF EXISTS "enrollments_admin_write" ON enrollments;

CREATE POLICY "enrollments_read"        ON enrollments FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin','docente','kiosco'));
CREATE POLICY "enrollments_admin_write" ON enrollments FOR ALL TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 4.5 Políticas: ACCESS_LOGS
DROP POLICY IF EXISTS "logs_kiosk_insert"  ON access_logs;
DROP POLICY IF EXISTS "logs_teacher_read"  ON access_logs;
DROP POLICY IF EXISTS "logs_guard_read"    ON access_logs;
DROP POLICY IF EXISTS "logs_admin_all"     ON access_logs;

-- Kiosco puede insertar eventos de acceso
CREATE POLICY "logs_kiosk_insert" ON access_logs FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('kiosco','admin'));

-- Docente ve los logs de las ubicaciones donde imparte clase o su ubicación asignada
CREATE POLICY "logs_teacher_read" ON access_logs FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('docente')
    AND (
      lab_id = get_user_lab_id()
      OR lab_id IN (
        SELECT s.lab_id FROM schedules s
        WHERE s.teacher_id = auth.uid()
      )
    )
  );

-- Admin puede todo
CREATE POLICY "logs_admin_all" ON access_logs FOR ALL TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 4.6 Políticas: PROFILES
DROP POLICY IF EXISTS "profiles_own"       ON profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON profiles;

CREATE POLICY "profiles_own"       ON profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_admin_all" ON profiles FOR ALL    TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- 5. PUBLICACIONES REALTIME
-- ============================================================
-- Activa Realtime para access_logs (cambios visibles en tiempo real)
-- Configurar en Supabase Dashboard → Database → Replication
-- o ejecutar:
-- ALTER PUBLICATION supabase_realtime ADD TABLE access_logs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE profiles;

-- 6. FUNCIONES Y VISTAS ÚTILES
-- ============================================================

-- Vista: estado actual de alumnos por laboratorio + horario activo
CREATE OR REPLACE VIEW v_lab_presence AS
SELECT
  s.id            AS student_id,
  s.matricula,
  s.full_name,
  s.career,
  al.lab_id,
  al.status,
  al.movement_type,
  al.timestamp    AS last_event_ts,
  CASE
    WHEN al.movement_type = 'exit' THEN 'absent'
    WHEN al.movement_type = 'temp_exit' THEN 'temp_out'
    WHEN al.status = 'granted' AND al.movement_type = 'entry' THEN 'present_on_time'
    ELSE 'unknown'
  END AS presence_status,
  sc.subject_name,
  sc.start_time,
  sc.end_time
FROM students s
JOIN enrollments e   ON e.student_id  = s.id
JOIN schedules sc    ON sc.id          = e.schedule_id
JOIN labs l          ON l.id           = sc.lab_id
LEFT JOIN LATERAL (
  SELECT * FROM access_logs al2
  WHERE al2.student_id = s.id
    AND al2.lab_id = sc.lab_id
    AND al2.timestamp::date = CURRENT_DATE
  ORDER BY al2.timestamp DESC
  LIMIT 1
) al ON true
WHERE
  sc.is_active = true
  AND s.is_active  = true
  AND EXTRACT(ISODOW FROM NOW()) = ANY(sc.days_of_week)
  AND NOW()::time BETWEEN sc.start_time AND sc.end_time;

-- Función: validar acceso (llamada desde kiosco vía RPC)
CREATE OR REPLACE FUNCTION validate_access(
  p_matricula TEXT,
  p_lab_id    UUID
)
RETURNS JSONB AS $$
DECLARE
  v_student   students%ROWTYPE;
  v_schedule  schedules%ROWTYPE;
  v_result    JSONB;
BEGIN
  -- Buscar alumno
  SELECT * INTO v_student FROM students WHERE matricula = p_matricula AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed',  false,
      'reason',   'student_not_found',
      'message',  'Matrícula no encontrada en el sistema'
    );
  END IF;

  -- Buscar horario activo para este lab en este momento
  SELECT sc.* INTO v_schedule
  FROM schedules sc
  JOIN enrollments e ON e.schedule_id = sc.id
  WHERE e.student_id = v_student.id
    AND sc.lab_id    = p_lab_id
    AND sc.is_active = true
    AND EXTRACT(ISODOW FROM NOW()) = ANY(sc.days_of_week)
    AND NOW()::time BETWEEN sc.start_time AND sc.end_time
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed',     false,
      'reason',      'no_schedule',
      'message',     'Sin horario asignado en este laboratorio ahora',
      'student_id',  v_student.id,
      'full_name',   v_student.full_name
    );
  END IF;

  -- Acceso concedido
  RETURN jsonb_build_object(
    'allowed',      true,
    'reason',       'schedule_ok',
    'message',      '¡Acceso concedido!',
    'student_id',   v_student.id,
    'schedule_id',  v_schedule.id,
    'full_name',    v_student.full_name,
    'subject_name', v_schedule.subject_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. DATOS SEMILLA (SEED)
-- ============================================================
-- Ejecutar sólo en entorno de desarrollo

INSERT INTO labs (id, code, name, location) VALUES
  ('11111111-1111-1111-1111-111111111111', 'LAB-A', 'Laboratorio de Cómputo A', 'Edificio 3, Planta Baja'),
  ('22222222-2222-2222-2222-222222222222', 'LAB-B', 'Laboratorio de Redes',     'Edificio 3, Planta Alta'),
  ('33333333-3333-3333-3333-333333333333', 'LAB-C', 'Laboratorio de Electrónica', 'Edificio 5, Planta Baja')
ON CONFLICT (id) DO NOTHING;

INSERT INTO students (id, matricula, full_name, career) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'L21120001', 'García López Juan Carlos',      'Ing. en Sistemas Computacionales'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'L21120002', 'Martínez Ruiz Ana Sofía',       'Ing. en Sistemas Computacionales'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'L21120003', 'Hernández Díaz Carlos Eduardo', 'Ing. en Mecatrónica'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'L21120004', 'López Sánchez María Fernanda',  'Ing. en Sistemas Computacionales'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'L21120005', 'Torres Vega Roberto Alejandro', 'Ing. en Mecatrónica'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '25460720',  'Lechuga García Andrés Iván',     'Ing. en Inteligencia Artificial')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schedules (id, lab_id, subject_name, teacher_name, start_time, end_time, days_of_week) VALUES
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Programación Avanzada', 'Dra. Pérez González', '07:00', '22:00', ARRAY[1,2,3,4,5,6,7]),
  ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Base de Datos',         'Mtro. Ramírez Cruz',  '10:00', '12:00', ARRAY[2,4]),
  ('77777777-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'Redes de Computadoras', 'Ing. Flores Mora',    '14:00', '16:00', ARRAY[1,2,3,4,5])
ON CONFLICT (id) DO NOTHING;

INSERT INTO enrollments (student_id, schedule_id) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '77777777-0000-0000-0000-000000000001'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-0000-0000-0000-000000000001'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '77777777-0000-0000-0000-000000000001'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '77777777-0000-0000-0000-000000000001'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '77777777-0000-0000-0000-000000000001'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '77777777-0000-0000-0000-000000000001'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-0000-0000-0000-000000000002'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '77777777-0000-0000-0000-000000000003')
ON CONFLICT DO NOTHING;
