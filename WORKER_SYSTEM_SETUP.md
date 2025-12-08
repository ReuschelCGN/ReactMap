# 🚀 Worker System Setup Guide

## Übersicht

Das neue Worker-System ermöglicht es Usern:

- **3 Worker** pro User zu verwalten (konfigurierbar)
- **Bis zu 3 Fences** zu erstellen (konfigurierbar)
- Worker auf eigene oder fremde Fences zu verteilen
- Worker jederzeit zurückzuziehen (ohne Cooldown)
- Automatische Fence-Vererbung bei Inaktivität (30 Tage)

---

## 📋 Installation

### Schritt 1: Koji-Datenbank Setup

Führe das SQL-Script in deiner Koji-Datenbank aus:

```bash
cd /home/andy/SelfReact/ReactMap/server/sql
mariadb -h <HOST> -u <USER> -p'<PASSWORD>' <DATABASE> --ssl=0 < 001_setup_worker_system.sql
```

**Was wird erstellt:**

- 4 neue Properties: `reactmap_owner_user_id`, `reactmap_total_workers`, `reactmap_last_worker_activity`, `reactmap_dragonite_area_id`
- 1 neue Tabelle: `fence_workers` (für Worker-Zuweisungen)

### Schritt 2: ReactMap-Datenbank Migration

Die Migration läuft automatisch beim nächsten Server-Start:

```bash
cd /home/andy/SelfReact/ReactMap
npm run migrate
```

**Was wird erstellt:**

- 1 neue Tabelle: `user_settings` (für User-spezifische Worker/Fence-Limits)

### Schritt 3: Server neu starten

```bash
pm2 restart reactmap
# oder
npm run start
```

---

## ⚙️ Konfiguration

In `server/src/configs/default.json` (oder `local.json`):

```json
{
  "fenceSystem": {
    "workersPerUser": 3, // Worker pro User
    "maxFencesPerUser": 3, // Max Fences pro User
    "inactivityDays": 30, // Tage ohne Worker bis Auto-Löschung
    "allowWorkerRejection": false // Owner kann Worker nicht ablehnen
  }
}
```

### User-spezifische Limits setzen

Für einzelne User kannst du custom Limits in der `user_settings` Tabelle setzen:

```sql
INSERT INTO user_settings (user_id, max_workers, max_fences)
VALUES ('discord_123456789', 5, 5)
ON DUPLICATE KEY UPDATE max_workers = 5, max_fences = 5;
```

---

## 🔌 API-Endpunkte

### 1. Worker-Statistik abrufen

```http
GET /api/v1/users/me/workers
Authorization: Required
```

**Response:**

```json
{
  "total": 3,
  "allocated": 2,
  "available": 1,
  "allocations": [
    {
      "fenceId": 123,
      "fenceName": "Downtown",
      "isOwner": true,
      "workers": 2
    }
  ]
}
```

### 2. Worker zuweisen/entfernen

```http
POST /api/v1/users/fence/:fenceId/workers
Authorization: Required
Content-Type: application/json

{
  "workerDelta": 1  // +1 = hinzufügen, -1 = entfernen
}
```

**Response:**

```json
{
  "status": "ok",
  "success": true,
  "totalWorkers": 3,
  "userWorkers": 1
}
```

### 3. Fence-Contributors abrufen

```http
GET /api/v1/users/fence/:fenceId/contributors
```

**Response:**

```json
{
  "fenceId": 123,
  "fenceName": "Downtown",
  "owner": "discord_123456",
  "totalWorkers": 6,
  "contributors": [
    {
      "userId": "discord_123456",
      "workers": 3,
      "isOwner": true
    },
    {
      "userId": "discord_789012",
      "workers": 2,
      "isOwner": false
    }
  ]
}
```

### 4. Alle öffentlichen Fences

```http
GET /api/v1/users/fences/public
```

**Response:**

```json
[
  {
    "id": 123,
    "name": "Downtown",
    "mode": "auto_quest",
    "owner": "discord_123456",
    "totalWorkers": 6,
    "lastActivity": "2024-11-29T15:30:00.000Z",
    "dragoniteAreaId": 456,
    "contributorCount": 3,
    "geometry": {...},
    "created_at": "2024-11-20T10:00:00.000Z",
    "updated_at": "2024-11-29T15:30:00.000Z"
  }
]
```

---

## 🎯 Funktionsweise

### Worker-Verteilung

1. **User erstellt Fence** → Wird automatisch Owner mit 0 Workern
2. **User weist Worker zu** → Worker werden der Fence zugeordnet
3. **Andere User können Worker spenden** → Jeder kann Worker auf fremde Fences verteilen
4. **Worker-Rückzug** → Sofort möglich, keine Wartezeit

### Ownership-System

**Owner = User mit den meisten Workern**

```
Fence hat:
  - User A: 2 Worker
  - User B: 3 Worker  ← Wird Owner
  - User C: 1 Worker

→ User B ist Owner
```

**Bei Gleichstand:** Erster User (nach created_at) wird Owner

### Auto-Cleanup

**Nach 30 Tagen ohne Worker:**

- Fence wird automatisch gelöscht
- Auch in Dragonite entfernt
- Cron-Job läuft täglich um 3 Uhr

---

## 🔧 Dragonite-Integration

Worker-Anzahl wird automatisch mit Dragonite synchronisiert:

```javascript
// Automatisch beim Worker-Zuweisen/Entfernen
{
  "pokemon_mode": {
    "workers": 3,  // Summe aller Worker
    "enable_scout": false,
    "invasion": false
  }
}
```

**Mindestens 1 Worker** wird immer an Dragonite gesendet, auch wenn 0 zugewiesen sind.

---

## 📊 Datenbank-Schema

### `fence_workers` (Koji-DB)

```sql
CREATE TABLE fence_workers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fence_id INT UNSIGNED NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  worker_count INT UNSIGNED DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (fence_id) REFERENCES geofence(id) ON DELETE CASCADE,
  UNIQUE KEY unique_fence_user (fence_id, user_id)
);
```

### `user_settings` (ReactMap-DB)

```sql
CREATE TABLE user_settings (
  user_id VARCHAR(255) PRIMARY KEY,
  max_workers INT DEFAULT 3,
  max_fences INT DEFAULT 3,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Properties (Koji-DB)

Neue Einträge in `property` Tabelle:

- `reactmap_owner_user_id` (string)
- `reactmap_total_workers` (number)
- `reactmap_last_worker_activity` (string)
- `reactmap_dragonite_area_id` (number)

Werte werden in `geofence_property` gespeichert.

---

## 🐛 Troubleshooting

### Properties nicht gefunden

```
Error: Property 'owner_user_id' not found. Did you run the setup SQL script?
```

**Lösung:** SQL-Script erneut ausführen:

```bash
mariadb -h <HOST> -u <USER> -p'<PASSWORD>' <DATABASE> --ssl=0 < server/sql/001_setup_worker_system.sql
```

### Migration läuft nicht

```bash
# Manuell ausführen
cd /home/andy/SelfReact/ReactMap/server
node src/db/migrate.js
```

### Worker-Sync mit Dragonite fehlgeschlagen

Prüfe Dragonite-Config in `local.json`:

```json
{
  "integrations": {
    "dragonite": {
      "baseUrl": "http://192.168.1.105:7272",
      "instance": "your-instance",
      "authHeaderName": "X-API-Key",
      "authHeaderValue": "your-key"
    }
  }
}
```

### Fence-Properties werden nicht gespeichert

Prüfe ob Properties existieren:

```sql
SELECT * FROM property WHERE name LIKE 'reactmap_%';
```

Sollte 4 Einträge zurückgeben.

---

## 🔄 Upgrade von altem System

Wenn du bereits Fences hast:

```sql
-- Setze Owner für existierende Fences
-- Ersetze 'YOUR_USER_ID' mit deiner User-ID

-- 1. Finde deine User-ID
SELECT * FROM project WHERE name LIKE '%YOUR_USERNAME%';

-- 2. Setze Owner für alle Fences in deinem Project
INSERT INTO geofence_property (geofence_id, property_id, value)
SELECT
  g.id,
  (SELECT id FROM property WHERE name = 'reactmap_owner_user_id'),
  'YOUR_USER_ID'
FROM geofence g
JOIN geofence_project gp ON g.id = gp.geofence_id
JOIN project p ON gp.project_id = p.id
WHERE p.name = 'YOUR_PROJECT_NAME'
ON DUPLICATE KEY UPDATE value = 'YOUR_USER_ID';
```

---

## ✅ Fertig!

Das Worker-System ist jetzt einsatzbereit. User können:

- Fences erstellen
- Worker zuweisen
- Mit anderen kollaborieren
- Ihre Map gemeinsam aufbauen

Bei Fragen oder Problemen, check die Logs:

```bash
pm2 logs reactmap
```
