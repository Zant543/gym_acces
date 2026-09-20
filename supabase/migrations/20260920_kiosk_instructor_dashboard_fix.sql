-- ==============================================================================
-- MIGRACIÓN GIMNASIOACCESS: FIX REALTIME Y RLS PARA KIOSCO Y DASHBOARD INSTRUCTOR
-- Archivo: supabase/migrations/20260920_kiosk_instructor_dashboard_fix.sql
-- Fecha: 2026-09-20
-- Descripción:
--   1. Activa la replicación en tiempo real para 'access_logs' en supabase_realtime.
--   2. Configura REPLICA IDENTITY FULL en 'access_logs' para emitir todas las columnas.
--   3. Corrige las políticas RLS en 'access_logs':
--      - Permite INSERT a roles: 'kiosco', 'admin', 'docente'.
--      - Permite SELECT a roles: 'admin', 'docente', 'kiosco'.
--      - Los instructores (docente) pueden ver todos los registros del gimnasio si su
--        location_id es NULL (o los de su sucursal si está asignado).
--   4. Asegura la existencia de la ubicación fija de Recepción por defecto.
--   5. Garantiza que validate_access devuelva student_id, allowed y status granted.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ACTIVAR REPLICACIÓN REALTIME EN access_logs
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'access_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE access_logs;
  END IF;
END $$;

ALTER TABLE access_logs REPLICA IDENTITY FULL;

-- ------------------------------------------------------------------------------
-- 2. ASEGURAR UBICACIÓN POR DEFECTO (RECEPCIÓN)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'locations') THEN
    INSERT INTO locations (id, code, name, location, is_active)
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      'RECEPCION',
      'Recepción Principal',
      'Planta Baja, Entrada',
      true
    )
    ON CONFLICT (id) DO UPDATE SET
      name      = EXCLUDED.name,
      is_active = true;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'labs') THEN
    INSERT INTO labs (id, code, name, location, is_active)
    VALUES (
      '00000000-0000-0000-0000-000000000001',
      'RECEPCION',
      'Recepción Principal',
      'Planta Baja, Entrada',
      true
    )
    ON CONFLICT (id) DO UPDATE SET
      name      = EXCLUDED.name,
      is_active = true;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. ACTUALIZAR POLÍTICAS RLS EN access_logs
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "logs_kiosk_insert"        ON access_logs;
DROP POLICY IF EXISTS "logs_teacher_read"        ON access_logs;
DROP POLICY IF EXISTS "logs_read_policy"         ON access_logs;
DROP POLICY IF EXISTS "logs_authenticated_read"  ON access_logs;
DROP POLICY IF EXISTS "logs_admin_all"           ON access_logs;

-- A) Inserción: Kiosco, Admin y Docente (para pruebas y registros)
CREATE POLICY "logs_kiosk_insert" ON access_logs FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('kiosco', 'admin', 'docente'));

-- B) Lectura (SELECT): Admin, Docente y Kiosco
-- Compatible tanto si la columna se llama location_id como si aún es lab_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'access_logs' AND column_name = 'location_id'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "logs_authenticated_read" ON access_logs FOR SELECT TO authenticated
      USING (
        get_user_role() IN ('admin', 'docente', 'kiosco')
        AND (
          get_user_location_id() IS NULL
          OR location_id IS NULL
          OR location_id = get_user_location_id()
        )
      );
    $pol$;
  ELSE
    EXECUTE $pol$
      CREATE POLICY "logs_authenticated_read" ON access_logs FOR SELECT TO authenticated
      USING (
        get_user_role() IN ('admin', 'docente', 'kiosco')
        AND (
          get_user_lab_id() IS NULL
          OR lab_id IS NULL
          OR lab_id = get_user_lab_id()
        )
      );
    $pol$;
  END IF;
END $$;

-- C) Control total para Administradores
CREATE POLICY "logs_admin_all" ON access_logs FOR ALL TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

-- ------------------------------------------------------------------------------
-- 4. POLÍTICAS EN students (SOCIOS)
-- Garantiza que admin, docente y kiosco puedan consultar los datos del socio
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "students_read" ON students;
CREATE POLICY "students_read" ON students FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'docente', 'kiosco'));

-- ------------------------------------------------------------------------------
-- 5. FUNCIÓN validate_access (GIMNASIO)
-- Valida que el socio exista, esté activo y con membresía vigente
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_access(
  p_matricula   TEXT,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student   students%ROWTYPE;
BEGIN
  -- 1. Buscar socio por ID / Clave
  SELECT * INTO v_student
  FROM students
  WHERE LOWER(TRIM(matricula)) = LOWER(TRIM(p_matricula))
  LIMIT 1;

  -- 2. Socio no registrado
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed',     false,
      'reason',      'member_not_found',
      'status',      'denied',
      'message',     'Socio no registrado en el sistema'
    );
  END IF;

  -- 3. Membresía inactiva
  IF v_student.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'allowed',     false,
      'reason',      'membership_inactive',
      'status',      'denied',
      'student_id',  v_student.id,
      'full_name',   v_student.full_name,
      'career',      v_student.career,
      'message',     'Membresía inactiva o suspendida'
    );
  END IF;

  -- 4. Membresía vencida
  IF v_student.expiration_date IS NOT NULL AND v_student.expiration_date < NOW() THEN
    RETURN jsonb_build_object(
      'allowed',         false,
      'reason',          'membership_expired',
      'status',          'denied',
      'student_id',      v_student.id,
      'full_name',       v_student.full_name,
      'career',          v_student.career,
      'expiration_date', v_student.expiration_date,
      'message',         'Membresía vencida'
    );
  END IF;

  -- 5. Acceso concedido
  RETURN jsonb_build_object(
    'allowed',         true,
    'reason',          'membership_valid',
    'status',          'granted',
    'student_id',      v_student.id,
    'full_name',       v_student.full_name,
    'career',          v_student.career,
    'expiration_date', v_student.expiration_date,
    'message',         'Acceso concedido — ¡Bienvenido!'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_access(TEXT, UUID) TO authenticated, anon;
