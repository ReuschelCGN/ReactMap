# SQL Setup Scripts

## Koji Database Setup

### 001_setup_worker_system.sql

Sets up the collaborative worker system for ReactMap.

**Run this script ONCE in your Koji database:**

```bash
mariadb -h YOUR_HOST -u YOUR_USER -p YOUR_DATABASE --ssl=0 < 001_setup_worker_system.sql
```

**Or using the credentials from local.json:**

```bash
mariadb -h 192.168.1.105 -u and1 -p'baikal89' koji --ssl=0 < 001_setup_worker_system.sql
```

**What it does:**
- Creates 4 new properties in the `property` table (reactmap_*)
- Creates the `fence_workers` table for tracking worker assignments
- Does NOT modify any existing tables

**Safe to run:**
- Uses `IF NOT EXISTS` for table creation
- Will skip property insertion if they already exist (may show duplicate key warning)
