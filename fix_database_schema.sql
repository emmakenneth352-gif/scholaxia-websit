-- Fix missing columns in student_profiles table
-- Run this directly on your Render PostgreSQL database

-- Add the missing cbt_subjects_locked column
ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS cbt_subjects_locked BOOLEAN DEFAULT FALSE;

-- Also add other potentially missing columns based on the error
ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS jamb_subjects VARCHAR[];

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS ssce_subjects VARCHAR[];

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS ssce_exam_type VARCHAR;

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS school_student_id VARCHAR;

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS has_active_subscription BOOLEAN DEFAULT FALSE;

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS live_plan_id VARCHAR;

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS live_plan_expires_at TIMESTAMP;

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS live_plan_sessions_used INTEGER DEFAULT 0;

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS community_channel_id UUID;

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS locked_by UUID;

-- Verify the changes
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'student_profiles' 
ORDER BY ordinal_position;