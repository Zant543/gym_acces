-- ==============================================================================
-- MIGRACIÓN GIMNASIOACCESS: RENOMBRAR LABS -> LOCATIONS
-- Archivo: supabase/migrations/20260918_rename_labs_to_locations.sql
-- Fecha: 2026-09-18
-- Descripción:
--   Formaliza la semántica del sistema para un gimnasio:
--   - Renombra la tabla 'labs' a 'locations'
--   - Renombra la columna 'access_logs.lab_id' a 'location_id'
--   - Actualiza funciones helper, políticas RLS e índices afectados
--   - Agrega fila seed de recepción por defecto
--
-- ORDEN DE EJECUCIÓN:
--   1. supabase/migrations/20260916_gimnasio_access_migration.sql
--   2. supabase/migrations/20260917_security_fixes.sql
--   3. supabase/migrations/20260918_rename_labs_to_locations.sql  <- este archivo
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RENOMBRAR TABLA labs -> locations
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS labs RENAME TO locations;

-- ------------------------------------------------------------------------------
-- 2. RENOMBRAR COLUMNA lab_id -> location_id EN access_logs
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'access_logs' AND column_name = 'lab_id'
  ) THEN
    ALTER TABLE access_logs RENAME COLUMN lab_id TO location_id;
  END IF;
END $$;

ALTER INDEX IF EXISTS idx_access_logs_lab RENAME TO idx_access_logs_location;

-- ------------------------------------------------------------------------------
-- 3. RENOMBRAR COLUMNA lab_id -> location_id EN profiles
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'lab_id'
  ) THEN
    ALTER TABLE profiles RENAME COLUMN lab_id TO location_id;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. RENOMBRAR COLUMNA lab_id -> location_id EN schedules
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedules' AND column_name = 'lab_id'
  ) THEN
    ALTER TABLE schedules RENAME COLUMN lab_id TO location_id;
  END IF;
END $$;

ALTER INDEX IF EXISTS idx_schedules_lab RENAME TO idx_schedules_location;

-- ------------------------------------------------------------------------------
-- 5. ACTUALIZAR FUNCIÓN HELPER get_user_lab_id -> get_user_location_id
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_location_id()
RETURNS UUID AS $$
  SELECT location_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Alias de compatibilidad mientras el código cliente se migra
CREATE OR REPLACE FUNCTION get_user_lab_id()
RETURNS UUID AS $$
  SELECT location_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ------------------------------------------------------------------------------
-- 6. ACTUALIZAR POLÍTICAS RLS QUE REFERENCIAN lab_id
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "logs_teacher_read" ON access_logs;
DROP POLICY IF EXISTS "labs_read_all"     ON locations;
DROP POLICY IF EXISTS "labs_admin_write"  ON locations;

CREATE POLICY "locations_read_all"    ON locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "locations_admin_write" ON locations FOR ALL    TO authenticated
  USING (get_user_role() = 'admin') WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "logs_teacher_read" ON access_logs FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('docente')
    AND (
      location_id = get_user_location_id()
      OR location_id IN (
        SELECT s.location_id FROM schedules s
        WHERE s.teacher_id = auth.uid()
      )
    )
  );

-- ------------------------------------------------------------------------------
-- 7. ACTUALIZAR FUNCIÓN validate_access (soporta p_location_id)
-- ------------------------------------------------------------------------------
-- Se deben eliminar las firmas previas antes de recrear con nuevo nombre de parámetro (p_lab_id -> p_location_id)
DROP FUNCTION IF EXISTS validate_access(TEXT, UUID);
DROP FUNCTION IF EXISTS validate_access(TEXT);

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

  -- 2. Caso: Socio no registrado
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed',     false,
      'reason',      'member_not_found',
      'status',      'denied',
      'message',     'Socio no registrado en el sistema'
    );
  END IF;

  -- 3. Caso: Membresía inactiva
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

  -- 4. Caso: Fecha de vigencia expirada
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

REVOKE EXECUTE ON FUNCTION validate_access(TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION validate_access(TEXT, UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 8. FILA SEED: Ubicación "Recepción" por defecto (gimnasio único)
-- ------------------------------------------------------------------------------
INSERT INTO locations (id, code, name, location, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'RECEPCION',
  'Recepción Principal',
  'Planta Baja, Entrada',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- ROLLBACK:
-- DROP POLICY IF EXISTS "locations_read_all"    ON locations;
-- DROP POLICY IF EXISTS "locations_admin_write" ON locations;
-- DROP POLICY IF EXISTS "logs_teacher_read"     ON access_logs;
-- DROP FUNCTION IF EXISTS get_user_location_id();
-- ALTER TABLE schedules    RENAME COLUMN location_id TO lab_id;
-- ALTER TABLE profiles     RENAME COLUMN location_id TO lab_id;
-- ALTER INDEX IF EXISTS idx_access_logs_location RENAME TO idx_access_logs_lab;
-- ALTER TABLE access_logs  RENAME COLUMN location_id TO lab_id;
-- ALTER INDEX IF EXISTS idx_schedules_location RENAME TO idx_schedules_lab;
-- ALTER TABLE locations RENAME TO labs;
-- ==============================================================================
