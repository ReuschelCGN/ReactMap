# 🚀 Quick Start - Worker System

## ✅ Was wurde gemacht:

1. ✅ SQL-Script ausgeführt (Properties + fence_workers Tabelle erstellt)
2. ✅ UI-Komponenten erstellt und integriert
3. ✅ Backend-APIs implementiert

## 🎯 Wie du es jetzt nutzt:

### **1. Worker auf deine eigene Fence zuweisen**

1. **Fence erstellen** (wie bisher über den Fence-Button)
2. **FencePanel öffnet sich rechts**
3. **Scrolle nach unten** → Du siehst jetzt "Worker-Verwaltung"
4. **Klicke auf [+]** um Worker zuzuweisen
5. **Klicke auf [-]** um Worker zu entfernen

```
┌─────────────────────────────────┐
│ Worker-Verwaltung               │
├─────────────────────────────────┤
│ 👤 Meine Worker                 │
│ 0/3 zugewiesen | 3 verfügbar    │
├─────────────────────────────────┤
│ Worker an "Meine Fence"         │
│  [−]  0 Worker  [+]  ← HIER!   │
└─────────────────────────────────┘
```

### **2. Andere Fences sehen und Worker spenden**

1. **Klicke auf den blauen Map-Button** (unten rechts, über dem Fence-Button)
2. **Drawer öffnet sich** mit Liste aller Fences
3. **Klicke auf eine Fence** um Details zu sehen
4. **Klicke auf [+]** um Worker zu spenden

```
┌─────────────────────────────────┐
│ 🗺️ Öffentliche Fences (5)      │
├─────────────────────────────────┤
│ ▸ Downtown                      │
│   👷 6 Worker • 👥 3 User       │
│                                 │
│ ▸ Westside                      │
│   👷 3 Worker • 👥 1 User       │
│                                 │
│ ▾ Meine Fence ✓ 2 Worker       │
│   Owner: Du                     │
│   [−] 2 Worker [+]  ← HIER!    │
└─────────────────────────────────┘
```

### **3. Worker-Übersicht (Optional)**

Wenn du das WorkerStatsWidget einbinden möchtest:

**In `src/App.jsx` oder ähnlich:**

```jsx
import { WorkerStatsWidget } from '@features/fence'

// Am Ende des JSX:
;<WorkerStatsWidget />
```

Dann hast du ein **kleines Widget unten rechts** das deine Worker-Verteilung zeigt.

---

## 🔧 Server neu starten (nach SQL-Script):

```bash
cd /home/andy/SelfReact/ReactMap

# Build (wenn du Änderungen gemacht hast)
npm run build

# Server starten
yarn start
```

---

## 📊 Wie Worker-Anzahl bestimmt wird:

### **Automatisch durch Summe:**

```
Du:      2 Worker zugewiesen
User_A:  3 Worker zugewiesen
User_B:  1 Worker zugewiesen
─────────────────────────────────
Fence hat: 6 Worker total
```

### **Dragonite bekommt automatisch die Summe:**

```json
{
  "pokemon_mode": {
    "workers": 6 // ← Automatisch synchronisiert
  }
}
```

### **Ownership:**

- **User mit meisten Workern = Owner**
- Bei Gleichstand: Erster User (nach Erstellungsdatum)
- Owner kann sich ändern wenn andere mehr Worker zuweisen

---

## 🎮 Beispiel-Workflow:

### **Szenario: Gemeinsam eine Area scannen**

1. **User A erstellt Fence "Downtown"**

   - Weist 2 Worker zu
   - Fence hat 2 Worker

2. **User B sieht die Fence in der Liste**

   - Öffnet PublicFenceDrawer (Map-Button)
   - Klickt auf "Downtown"
   - Weist 3 Worker zu
   - Fence hat jetzt 5 Worker (2+3)
   - **User B wird Owner** (hat mehr Worker)

3. **User C spendiert auch 1 Worker**

   - Fence hat jetzt 6 Worker (2+3+1)
   - User B bleibt Owner (hat immer noch die meisten)

4. **User A zieht seine Worker zurück**

   - Klickt auf [-] bis 0 Worker
   - Fence hat jetzt 4 Worker (0+3+1)
   - User B bleibt Owner

5. **Nach 30 Tagen ohne Worker:**
   - Fence wird automatisch gelöscht
   - Auch in Dragonite entfernt

---

## 🐛 Troubleshooting:

### **"Property not found" Fehler:**

```bash
# SQL-Script nochmal ausführen
cd /home/andy/SelfReact/ReactMap
mariadb -h <HOST> -u <USER> -p'<PASSWORD>' <DATABASE> --ssl=0 < server/sql/001_setup_worker_system.sql

# Server neu starten
yarn start
```

### **Worker-Management wird nicht angezeigt:**

- Stelle sicher dass du eine Fence erstellt hast
- Scrolle im FencePanel nach unten
- Prüfe Browser-Console auf Fehler

### **PublicFenceDrawer erscheint nicht:**

- Prüfe ob der blaue Map-Button unten rechts sichtbar ist
- Falls nicht: `npm run build` und Server neu starten

### **API-Fehler:**

```bash
# Prüfe ob Properties existieren:
mariadb -h <HOST> -u <USER> -p'<PASSWORD>' <DATABASE> --ssl=0 -e "SELECT * FROM property WHERE name LIKE 'reactmap_%';"

# Sollte 4 Zeilen zurückgeben
```

---

## 📱 UI-Komponenten:

### **Bereits integriert:**

- ✅ **WorkerManager** - Im FencePanel (rechts)
- ✅ **PublicFenceDrawer** - Map-Button (unten rechts)

### **Optional einbinden:**

- ⚪ **WorkerStatsWidget** - Floating Widget (siehe oben)

---

## 🎯 Nächste Schritte:

1. **Server neu starten** (falls noch nicht gemacht)
2. **Fence erstellen** und Worker zuweisen
3. **Mit zweitem User testen** (Worker auf fremde Fence spenden)
4. **Feedback geben** wenn etwas nicht funktioniert

---

## 💡 Tipps:

- **Worker sofort zurückziehen:** Kein Cooldown, einfach auf [-] klicken
- **Mehrere Fences:** Du kannst bis zu 3 Fences erstellen
- **Worker-Limit:** 3 Worker pro User (in Config änderbar)
- **Ownership wechselt automatisch:** User mit meisten Workern wird Owner
- **Auto-Cleanup:** Fences ohne Worker werden nach 30 Tagen gelöscht

---

## ✅ Fertig!

Das System ist jetzt einsatzbereit. Viel Spaß beim gemeinsamen Map-Aufbau! 🎉
