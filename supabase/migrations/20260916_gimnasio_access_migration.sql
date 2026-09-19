-- ==============================================================================
-- MIGRACIÓN GIMNASIOACCESS: ADAPTACIÓN DE MODELO DE DATOS Y STORAGE
-- Archivo: supabase/migrations/20260916_gimnasio_access_migration.sql
-- Fecha: 2026-09-16
-- Descripción:
--   1. Agrega formalmente columnas de membresía (expiration_date, updated_at) a 'students'.
--   2. Crea la vista 'members' para acceso desacoplado y semántica de gimnasio.
--   3. Configura el bucket 'access-photos' en Supabase Storage con políticas RLS.
--   4. Actualiza la función 'validate_access' con seguridad reforzada (search_path)
--      y validación de membresía vigente para el kiosco.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CAMPOS DE MEMBRESÍA EN TABLA STUDENTS (SOCIOS)
-- ------------------------------------------------------------------------------
ALTER TABLE students 
  ADD COLUMN IF NOT EXISTS expiration_date TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Índice para consultas rápidas de socios activos y vigentes
CREATE INDEX IF NOT EXISTS idx_students_expiration_date ON students (expiration_date);
CREATE INDEX IF NOT EXISTS idx_students_is_active ON students (is_active);

-- Trigger para mantener actualizado 'updated_at'
CREATE OR REPLACE FUNCTION update_students_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_students_timestamp ON students;
CREATE TRIGGER trg_update_students_timestamp
  BEFORE UPDATE ON students
  FOR EACH ROW
  EXECUTE FUNCTION update_students_timestamp();

-- ------------------------------------------------------------------------------
-- 2. VISTA DE COMPATIBILIDAD 'members'
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW members AS
SELECT
  id,
  matricula       AS member_id,
  full_name,
  career          AS membership_type,
  photo_url,
  is_active,
  expiration_date,
  CASE
    WHEN is_active = false THEN 'inactive'
    WHEN expiration_date IS NOT NULL AND expiration_date < NOW() THEN 'expired'
    ELSE 'active'
  END             AS membership_status,
  created_at,
  updated_at
FROM students;

-- ------------------------------------------------------------------------------
-- 3. BUCKET DE SUPABASE STORAGE PARA FOTOGRAFÍAS DE EVIDENCIA
--    PRIVADO: solo usuarios autenticados con rol kiosco/admin.
--    Las políticas RLS estrictas se aplican en 20260917_security_fixes.sql.
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'access-photos',
  'access-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = false,
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];


-- ------------------------------------------------------------------------------
-- 4. FUNCIÓN SEGURA DE VALIDACIÓN DE ACCESO DE SOCIOS (validate_access)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_access(
  p_matricula TEXT,
  p_lab_id    UUID DEFAULT NULL
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

GRANT EXECUTE ON FUNCTION validate_access(TEXT, UUID) TO authenticated, anon;

-- ==============================================================================
-- INSTRUCCIONES DE REVERSIÓN (ROLLBACK):
--
-- DROP VIEW IF EXISTS members;
-- DROP TRIGGER IF EXISTS trg_update_students_timestamp ON students;
-- DROP FUNCTION IF EXISTS update_students_timestamp();
-- ALTER TABLE students DROP COLUMN IF EXISTS expiration_date;
-- ALTER TABLE students DROP COLUMN IF EXISTS updated_at;
-- DROP POLICY IF EXISTS "access_photos_insert" ON storage.objects;
-- DROP POLICY IF EXISTS "access_photos_select" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'access-photos';
-- ==============================================================================
