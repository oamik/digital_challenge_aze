# Smart Transit & Crowdsourcing Engine (MVP)

Ictimai nəqliyyat marşrutlarını izləmək, avtobuslardakı sıxlıq səviyyəsini toplamaq (crowdsourcing) və parkın optimal idarə edilməsi üçün operator xəbərdarlıqlarını işə salmaq üçün real vaxt rejimində işləyən smart nəqliyyat sistemi. Node.js, Express, PostgreSQL və Leaflet.js ilə hazırlanmışdır.

## Tələblər (Prerequisites)

Quraşdırmadan əvvəl kompüterinizdə aşağıdakı proqramların olduğundan əmin olun:

* **Node.js** (v18.0.0 və ya daha yüksək) & **npm**
* **PostgreSQL** (v14.0 və ya daha yüksək)
* **Git**

## Lokal Məlumat Bazasının Quraşdırılması

### 1. Məlumat Bazasını Yaradın

Terminalı və ya PostgreSQL CLI (`psql`) alətini açın və `team_24q` adlı məlumat bazası yaradın:

```sql
CREATE DATABASE team_24q;
```

Alternativ olaraq, terminal vasitəsilə:

```bash
createdb -U postgres team_24q
```

### 2. Sxemi və İlkin Məlumatları Yükləyin

Kök qovluqda (root directory) aşağıdakı məzmunda `init.sql` faylı yaradın:

```sql
-- Connect to team_24q database before running
\c team_24q;

-- Create Buses Table
CREATE TABLE IF NOT EXISTS buses (
    id VARCHAR(50) PRIMARY KEY,
    route_id VARCHAR(10) NOT NULL,
    current_lat DOUBLE PRECISION NOT NULL,
    current_lng DOUBLE PRECISION NOT NULL,
    crowd_level VARCHAR(20) DEFAULT 'low',
    last_updated TIMESTAMP DEFAULT NOW()
);

-- Create Crowd Reports Table
CREATE TABLE IF NOT EXISTS crowd_reports (
    id SERIAL PRIMARY KEY,
    bus_id VARCHAR(50) REFERENCES buses(id) ON DELETE CASCADE,
    route_id VARCHAR(10) NOT NULL,
    crowd_level VARCHAR(20) NOT NULL,
    reported_at TIMESTAMP DEFAULT NOW()
);

-- Seed Initial Active Buses (All defaulting to 'low' crowd level)
INSERT INTO buses (id, route_id, current_lat, current_lng, crowd_level) VALUES
('BUS-141', '14', 40.4205, 49.8000, 'low'),
('BUS-142', '14', 40.3861, 49.8089, 'low'),
('BUS-M201', 'M2', 40.3861, 49.8089, 'low'),
('BUS-M301', 'M3', 40.3952, 49.8115, 'low')
ON CONFLICT (id) DO NOTHING;
```

SQL skriptini lokal məlumat bazanızda icra edin:

```bash
psql -U postgres -d team_24q -f init.sql
```

## Layihənin Quraşdırılması və Ətraf Mühit Tənzimləmələri

### 1. Klonlayın və Asılılıqları Quraşdırın

```bash
git clone <repository-url>
cd <repository-folder>
npm install
```

### 2. Ətraf Mühit Dəyişənləri (Environment Variables)

Kök qovluqda `.env` faylı yaradın və lokal PostgreSQL məlumatlarınızı qeyd edin:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=team_24q
DB_USER=postgres
DB_PASSWORD=your_local_postgres_password
```

`db.js` faylının bu ətraf mühit dəyişənlərindən istifadə etdiyindən əmin olun:

```javascript
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'team_24q',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgrespassword',
});

module.exports = pool;
```

## Tətbiqin İşə Salınması

Node.js serverini işə salın:

```bash
node server.js
```

Və ya `nodemon` vasitəsilə (əgər quraşdırılıbsa):

```bash
npx nodemon server.js
```

Server işə düşdükdən sonra veb tətbiqə daxil olun:
👉 **`http://localhost:3000`**

## API Sənədləşməsi (API Documentation)

Aşağıda backend xidməti tərəfindən təqdim olunan RESTful API endpoint-lərinin tam siyahısı qeyd olunmuşdur.

### 1. Avtobus Məkanları və Statusu

* **`GET /api/buses`**
  * **Təsvir:** Bütün aktiv avtobusların real vaxt koordinatlarını, təyin olunmuş marşrutunu və mövcud sıxlıq statusunu qaytarır.
  * **Cavab (200 OK):**

```json
{
  "buses": [
    {
      "id": "BUS-141",
      "route_id": "14",
      "lat": 40.4205,
      "lng": 49.8000,
      "crowd_level": "low",
      "last_updated": "2026-10-31T14:30:00.000Z"
    }
  ]
}
```

### 2. Dayanacaqlar və Marşrut Həndəsəsi

* **`GET /api/stops?route_id={route_id}`**
  * **Təsvir:** Konkret bir marşrut (`14`, `M2` və ya `M3`) üçün təyin olunmuş bütün avtobus dayanacaqlarını və küçə marşrutunun polyline koordinatlarını qaytarır.
  * **Sorğu Parametrləri:** `route_id` (string, məcburidir)
  * **Cavab (200 OK):**

```json
{
  "route_id": "14",
  "stops": [
    { "id": "STOP-101", "name": "28 May M/s", "lat": 40.3780, "lng": 49.8480 }
  ],
  "routePolyline": [
    [40.4205, 49.8000],
    [40.4120, 49.8080],
    [40.4000, 49.8140]
  ]
}
```

### 3. Sıxlıq Bildirişləri (Crowdsourcing)

* **`POST /api/crowd-report`**
  * **Təsvir:** Konkret bir avtobus üçün sərnişin tərəfindən verilən sıxlıq hesabatını daxil edir. PostgreSQL-də avtobusun statusunu yeniləyir və hesabat zamanını qeydə alır.
  * **Sorğu Gövdəsi (Request Body):**

```json
{
  "bus_id": "BUS-141",
  "route_id": "14",
  "crowd_level": "high" // Seçimlər: "low", "medium", "high"
}
```

* **Cavab (200 OK):**

```json
{
  "success": true,
  "message": "Crowd report recorded successfully",
  "bus_id": "BUS-141",
  "new_crowd_level": "high"
}
```

### 4. Operator Anomaliya İdarəetməsi

* **`GET /api/operator/anomalies`**
  * **Təsvir:** Son hesabatı `high` (Yüksək) kimi qeyd olunmuş bütün aktiv avtobus anomaliyalarını qaytarır.
  * **Cavab (200 OK):**

```json
{
  "anomalies": [
    {
      "bus_id": "BUS-141",
      "route_id": "14",
      "crowd_level": "high",
      "reported_at": "2026-10-31T14:35:10.000Z",
      "message": "Əlavə avtobus ehtiyyatı ayrılmalıdır (Xətt: 14, Avtobus: BUS-141)"
    }
  ]
}
```

### 5. Operator Xəttə Avtobus Çıxarılması

* **`POST /api/operator/add-bus`**
  * **Təsvir:** Yüksək sıxlığı aradan qaldırmaq üçün müvafiq marşruta yeni ehtiyat avtobus təyin edir. Sərnişinin ilkin hesabatını dəyişmədən aktiv anomaliya xəbərdarlığını həll edir.
  * **Sorğu Gövdəsi (Request Body):**

```json
{
  "route_id": "14",
  "bus_id_to_clear": "BUS-141"
}
```

* **Cavab (200 OK):**

```json
{
  "success": true,
  "message": "New bus dispatched successfully",
  "new_bus_id": "BUS-143",
  "route_id": "14"
}
```

## Tətbiq Funksionallıqları və Test Ardıcıllığı

1. **Sərnişin Paneli:**
   * Marşrut seçin (`14`, `M2`, `M3`) və xəritədə müvafiq polyline xəttinin və aktiv avtobusların görünüşünü izləyin.
   * Hərəkət edən istənilən avtobus markerinə klikləyərək popup pəncərəsini açın və sıxlıq səviyyəsini bildirin (**Az**, **Orta**, **Yüksək**).
   * Canlı toast bildirişinin təsdiqini görün və avtobus ikonunun rənginin dərhal dəyişməsinə diqqət yetirin.

2. **Operator Paneli və Anomaliyaların İdarə Edilməsi:**
   * Operator sek hissinə keçin.
   * **Yüksək** (🔴) olaraq qeyd edilən istənilən avtobus dərhal anomaliya bannerini işə salır: `"Əlavə avtobus ehtiyyatı ayrılmalıdır (Xətt: {route_id}, Avtobus: {bus_id})"`.
   * Xəbərdarlıq kartı üzərindəki **"Yeni avtobus əlavə et"** düyməsinə klikləyərək xəttə yeni avtobus çıxarın və sərnişinin göndərdiyi statusu dəyişmədən bildirimi təmizləyin.
   * Əgər sərnişin avtobusun statusunu yenidən **Az** olaraq yeniləyərsə, anomaliya avtomatik olaraq həll olunur.