-- ============================================================================
-- ReactMap Worker System Setup
-- ============================================================================
-- This script sets up the collaborative worker system for ReactMap
-- Run this ONCE in the Koji database
-- ============================================================================

-- Step 1: Create ReactMap-specific properties
-- These properties store metadata about fences without modifying the geofence table
INSERT INTO property (name, category, default_value) VALUES 
  ('reactmap_owner_user_id', 'string', NULL),
  ('reactmap_total_workers', 'number', '0'),
  ('reactmap_last_worker_activity', 'string', NULL),
  ('reactmap_dragonite_area_id', 'number', NULL);

-- Step 2: Create fence_workers table
-- This table tracks which users have assigned workers to which fences
CREATE TABLE IF NOT EXISTS fence_workers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fence_id INT UNSIGNED NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  worker_count INT UNSIGNED DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Indexes for performance
  INDEX idx_fence_user (fence_id, user_id),
  INDEX idx_user (user_id),
  INDEX idx_fence (fence_id),
  
  -- Foreign key to ensure data integrity
  FOREIGN KEY (fence_id) REFERENCES geofence(id) ON DELETE CASCADE,
  
  -- Ensure one entry per user per fence
  UNIQUE KEY unique_fence_user (fence_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Verification queries (optional - comment out for production)
-- ============================================================================

-- Check if properties were created
SELECT * FROM property WHERE name LIKE 'reactmap_%';

-- Check if fence_workers table exists
SHOW TABLES LIKE 'fence_workers';

-- ============================================================================
-- Done!
-- ============================================================================
