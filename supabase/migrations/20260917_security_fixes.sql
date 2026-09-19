-- ==============================================================================
-- MIGRACIÓN GIMNASIOACCESS: CORRECCIONES DE SEGURIDAD Y ESQUEMA
-- Archivo: supabase/migrations/20260917_security_fixes.sql
-- Fecha: 2026-09-17
-- Descripción:
--   1. Hace privado el bucket access-photos (elimina acceso anónimo).
--   2. Reemplaza políticas RLS de storage para aceptar únicamente usuarios
--      autenticados con rol kiosco o admin (insert) o admin (select).
--   3. Actualiza el constraint de profiles.role a los roles actuales del sistema
--      eliminando los valores obsoletos (teacher, guard, kiosk).
--   4. Documenta pasos futuros de renombramiento labs → locations.
--
-- ORDEN DE EJECUCIÓN:
--   1. supabase/migrations/20260916_gimnasio_access_migration.sql
--   2. supabase/migrations/20260917_security_fixes.sql  <- este archivo
--   3. supabase/migrations/20260918_rename_labs_to_locations.sql  (opcional, multi-sucursal)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. BUCKET access-photos -> PRIVADO
-- ------------------------------------------------------------------------------
UPDATE storage.buckets
SET
  public             = false,
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'access-photos';

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
-- 2. ELIMINAR POLÍTICAS ANTIGUAS (abiertas a anon)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "access_photos_insert"       ON storage.objects;
DROP POLICY IF EXISTS "access_photos_select"       ON storage.objects;
DROP POLICY IF EXISTS "access_photos_anon_insert"  ON storage.objects;
DROP POLICY IF EXISTS "access_photos_anon_select"  ON storage.objects;

-- ------------------------------------------------------------------------------
-- 3. NUEVAS POLÍTICAS RLS — SOLO USUARIOS AUTENTICADOS
-- ------------------------------------------------------------------------------

-- INSERT: kiosco y admin pueden subir fotos de evidencia
CREATE POLICY "access_photos_kiosco_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'access-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('kiosco', 'admin')
    )
  );

-- SELECT: solo admin puede leer fotos de evidencia (auditoria)
CREATE POLICY "access_photos_admin_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'access-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- DELETE: solo admin puede eliminar (limpieza)
CREATE POLICY "access_photos_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'access-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- ------------------------------------------------------------------------------
-- 4. ACTUALIZAR CONSTRAINT DE ROLES EN profiles
-- Migrar valores antiguos antes de cambiar el constraint:
-- ------------------------------------------------------------------------------
UPDATE public.profiles SET role = 'docente' WHERE role IN ('teacher', 'profesor');
UPDATE public.profiles SET role = 'kiosco'  WHERE role = 'kiosk';
UPDATE public.profiles SET role = 'admin'   WHERE role = 'guard';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'docente', 'kiosco'));

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);

-- ------------------------------------------------------------------------------
-- 5. REVOCAR ACCESO ANONIMO A validate_access
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION validate_access(TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION validate_access(TEXT, UUID) TO authenticated;

-- ==============================================================================
-- ROLLBACK:
-- UPDATE storage.buckets SET public = true WHERE id = 'access-photos';
-- DROP POLICY IF EXISTS "access_photos_kiosco_insert" ON storage.objects;
-- DROP POLICY IF EXISTS "access_photos_admin_select"  ON storage.objects;
-- DROP POLICY IF EXISTS "access_photos_admin_delete"  ON storage.objects;
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
--   CHECK (role IN ('admin', 'teacher', 'guard', 'kiosk'));
-- REVOKE EXECUTE ON FUNCTION validate_access(TEXT, UUID) FROM authenticated;
-- GRANT  EXECUTE ON FUNCTION validate_access(TEXT, UUID) TO authenticated, anon;
-- ==============================================================================

