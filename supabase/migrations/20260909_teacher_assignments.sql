-- ============================================================
-- Migracion: Asignacion de Docentes, Horarios y Alumno 25460720
-- Ejecutar en Supabase -> SQL Editor
-- ============================================================

-- 1. Agregar columna teacher_id en la tabla schedules si no existe
ALTER TABLE schedules 
  ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_schedules_teacher ON schedules(teacher_id);

-- 2. Actualizar politica de lectura para docentes en access_logs
-- Permite que el docente consulte accesos de los laboratorios donde tiene clases asignadas
DROP POLICY IF EXISTS "logs_teacher_read" ON access_logs;

CREATE POLICY "logs_teacher_read" ON access_logs FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('teacher', 'docente')
    AND (
      lab_id = get_user_lab_id()
      OR lab_id IN (
        SELECT s.lab_id FROM schedules s
        WHERE s.teacher_id = auth.uid()
      )
    )
  );

-- 3. Registrar al alumno 25460720 (Andres Ivan Lechuga Garcia)
INSERT INTO students (id, matricula, full_name, career, is_active)
VALUES (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '25460720',
  'Lechuga Garcia Andres Ivan',
  'Ing. en Inteligencia Artificial',
  true
)
ON CONFLICT (matricula) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  career    = EXCLUDED.career,
  is_active = EXCLUDED.is_active;

-- 4. Inscribir al alumno 25460720 en el horario de Programacion Avanzada en LAB-A
INSERT INTO enrollments (student_id, schedule_id)
VALUES (
  (SELECT id FROM students WHERE matricula = '25460720' LIMIT 1),
  '77777777-0000-0000-0000-000000000001'
)
ON CONFLICT (student_id, schedule_id) DO NOTHING;

-- 5. Vincular el horario de Programacion Avanzada con la cuenta del docente
UPDATE schedules
SET 
  start_time   = '07:00',
  end_time     = '22:00',
  days_of_week = ARRAY[1,2,3,4,5,6,7],
  teacher_id   = (SELECT id FROM profiles WHERE role IN ('teacher','docente') LIMIT 1)
WHERE id = '77777777-0000-0000-0000-000000000001';

-- 6. Ampliar dias en los otros horarios para pruebas en cualquier dia de la semana
UPDATE schedules
SET 
  days_of_week = ARRAY[1,2,3,4,5,6,7]
WHERE id IN ('77777777-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000003');
