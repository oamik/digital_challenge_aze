const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db'); // Yuxarıda yaratdığımız db.js faylı

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));

const allowedCrowdLevels = new Set(['low', 'medium', 'high']);
const targetRoutes = ['14', 'M2', 'M3'];
const routePolylines = {
    '14': [
        [40.4205, 49.8], [40.412, 49.808], [40.4, 49.814],
        [40.3952, 49.8115], [40.389, 49.808], [40.3861, 49.8089],
        [40.38, 49.815], [40.378, 49.823], [40.3815, 49.829],
        [40.379, 49.83], [40.375, 49.836], [40.378, 49.848]
    ],
    M2: [
        [40.3861, 49.8089], [40.382, 49.82], [40.379, 49.83],
        [40.375, 49.836], [40.378, 49.848]
    ],
    M3: [
        [40.3952, 49.8115], [40.388, 49.822], [40.379, 49.83],
        [40.378, 49.848]
    ]
};

async function ensureBusSchema() {
    await db.query('ALTER TABLE buses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE');
    await db.query("ALTER TABLE buses ADD COLUMN IF NOT EXISTS crowd_level VARCHAR(20) NOT NULL DEFAULT 'low'");
}

app.get('/api/routes', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT DISTINCT route_id FROM stops WHERE route_id = ANY($1::varchar[]) ORDER BY route_id',
            [targetRoutes]
        );
        res.json({ routes: result.rows.map(row => row.route_id) });
    } catch (err) {
        console.error('Routes query error:', err);
        res.status(500).json({ error: 'Marşrutları yükləmək mümkün olmadı' });
    }
});

app.get('/api/stops', async (req, res) => {
    const { route_id: routeId } = req.query;
    if (!targetRoutes.includes(routeId)) {
        return res.status(400).json({ error: 'Etibarsız route_id' });
    }

    try {
        const result = await db.query(
            `SELECT id, route_id, stop_name AS name, latitude AS lat,
                    longitude AS lng, stop_order
             FROM stops WHERE route_id = $1 ORDER BY stop_order`,
            [routeId]
        );
        res.json({ stops: result.rows, routePolyline: routePolylines[routeId] });
    } catch (err) {
        console.error('Stops query error:', err);
        res.status(500).json({ error: 'Dayanacaqları yükləmək mümkün olmadı' });
    }
});

app.get('/api/buses', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT b.id, b.route_id, b.origin, b.destination,
                   b.current_lat AS lat, b.current_lng AS lng,
                   COALESCE(latest_report.crowd_level, b.crowd_level, 'low') AS crowd,
                   COALESCE(latest_report.crowd_level, b.crowd_level, 'low') AS crowd_level
            FROM buses b
            LEFT JOIN LATERAL (
                SELECT crowd_level FROM crowd_reports
                WHERE bus_id = b.id
                ORDER BY reported_at DESC NULLS LAST, id DESC LIMIT 1
            ) latest_report ON true
            ORDER BY b.route_id, b.id
        `);
        res.json({ buses: result.rows });
    } catch (err) {
        console.error('Buses query error:', err);
        res.status(500).json({ error: 'Avtobusları yükləmək mümkün olmadı' });
    }
});

app.get('/api/stops/:stopId/arrivals', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT s.route_id, s.latitude AS stop_lat, s.longitude AS stop_lng,
                   b.id AS bus_id, b.origin, b.destination,
                   b.current_lat AS bus_lat, b.current_lng AS bus_lng,
                   COALESCE(latest_report.crowd_level, b.crowd_level, 'low') AS crowd
            FROM stops s
            LEFT JOIN buses b ON b.route_id = s.route_id
            LEFT JOIN LATERAL (
                SELECT crowd_level FROM crowd_reports
                WHERE bus_id = b.id
                ORDER BY reported_at DESC NULLS LAST, id DESC LIMIT 1
            ) latest_report ON true
            WHERE s.id = $1
            ORDER BY b.id
        `, [req.params.stopId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Dayanacaq tapılmadı' });
        }

        const stop = result.rows[0];
        const arrivals = result.rows.filter(row => row.bus_id).map(row => {
            const latDistance = (Number(row.bus_lat) - Number(stop.stop_lat)) * 111.32;
            const lngDistance = (Number(row.bus_lng) - Number(stop.stop_lng)) *
                111.32 * Math.cos(Number(stop.stop_lat) * Math.PI / 180);
            const distanceKm = Math.hypot(latDistance, lngDistance);
            return {
                bus_id: row.bus_id,
                route_id: row.route_id,
                origin: row.origin,
                destination: row.destination,
                crowd: row.crowd,
                eta_minutes: Math.max(1, Math.ceil(distanceKm / 20 * 60))
            };
        }).sort((first, second) => first.eta_minutes - second.eta_minutes);

        res.json({ route_id: stop.route_id, arrivals });
    } catch (err) {
        console.error('Arrivals query error:', err);
        res.status(500).json({ error: 'Gələn avtobusları yükləmək mümkün olmadı' });
    }
});

app.post('/api/crowd-report', async (req, res) => {
    const { bus_id: busId, route_id: routeId, crowd_level: crowdLevel } = req.body;
    if (!busId || !targetRoutes.includes(routeId) || !allowedCrowdLevels.has(crowdLevel)) {
        return res.status(400).json({ error: 'Etibarsız bus_id, route_id və ya crowd_level' });
    }

    try {
        const result = await db.query(
            `WITH updated_bus AS (
                UPDATE buses
                SET crowd_level = $3
                WHERE id = $1 AND route_id = $2
                RETURNING id, route_id
             )
             INSERT INTO crowd_reports (bus_id, route_id, crowd_level)
             SELECT id, route_id, $3 FROM updated_bus
             RETURNING *`,
            [busId, routeId, crowdLevel]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Avtobus bu marşrutda tapılmadı' });
        }

        res.status(201).json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Database INSERT error:', err);
        res.status(500).json({ error: 'Məlumat bazaya yazıla bilmədi' });
    }
});

app.post('/api/operator/add-bus', async (req, res) => {
    const { route_id: routeId, bus_id_to_clear: busIdToClear } = req.body;
    const waypoints = routePolylines[routeId];
    if (!targetRoutes.includes(routeId) || !busIdToClear || !waypoints?.length) {
        return res.status(400).json({ error: 'Etibarsız route_id və ya bus_id_to_clear' });
    }

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('smart-transit-add-bus'))");

        const busToClear = await client.query(
            'SELECT id FROM buses WHERE id = $1 AND route_id = $2 FOR UPDATE',
            [busIdToClear, routeId]
        );
        if (busToClear.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Avtobus bu marşrutda tapılmadı' });
        }

        const routeStops = await client.query(
            'SELECT stop_name FROM stops WHERE route_id = $1 ORDER BY stop_order',
            [routeId]
        );
        if (routeStops.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Marşrut dayanacaqları tapılmadı' });
        }

        const existingBusIds = await client.query("SELECT id FROM buses WHERE id LIKE 'BUS-%'");
        const nextBusNumber = existingBusIds.rows.reduce((highest, row) => {
            const match = row.id.match(/^BUS-(\d+)$/);
            return match ? Math.max(highest, Number(match[1])) : highest;
        }, 0) + 1;
        const newBusId = `BUS-${nextBusNumber}`;
        const [latitude, longitude] = waypoints[0];

        await client.query(
            `INSERT INTO buses (id, route_id, origin, destination, current_lat, current_lng,
                                crowd_level, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'low', NOW())`,
            [newBusId, routeId, routeStops.rows[0].stop_name,
                routeStops.rows[routeStops.rows.length - 1].stop_name, latitude, longitude]
        );

        await client.query('COMMIT');
        res.status(201).json({ success: true, new_bus_id: newBusId });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('Add bus transaction error:', err);
        res.status(500).json({ error: 'Yeni avtobus əlavə etmək mümkün olmadı' });
    } finally {
        if (client) client.release();
    }
});

app.get('/api/operator/anomalies', async (req, res) => {
    try {
        const queryText = `
            WITH latest_report_per_bus AS (
                SELECT DISTINCT ON (report.bus_id)
                       report.bus_id, report.route_id, report.crowd_level,
                       report.reported_at, report.id
                FROM crowd_reports report
                JOIN buses bus ON bus.id = report.bus_id
                              AND bus.route_id = report.route_id
                WHERE report.bus_id IS NOT NULL
                ORDER BY report.bus_id, report.reported_at DESC NULLS LAST, report.id DESC
            )
                        SELECT latest.bus_id, latest.route_id
                        FROM latest_report_per_bus latest
                        WHERE latest.crowd_level = 'high'
                            AND NOT EXISTS (
                                    SELECT 1
                                    FROM buses dispatched
                                    WHERE dispatched.route_id = latest.route_id
                                        AND dispatched.id <> latest.bus_id
                                        AND dispatched.created_at > latest.reported_at
                            )
                        ORDER BY latest.route_id, latest.bus_id
        `;
        const result = await db.query(queryText);
        res.json({
            alerts: result.rows.map(row => ({
                message: `Əlavə avtobus ehtiyyatı ayrılmalıdır (Xətt: ${row.route_id}, Avtobus: ${row.bus_id})`,
                bus_id: row.bus_id,
                route_id: row.route_id,
            }))
        });
    } catch (err) {
        console.error('Database SELECT error:', err);
        res.status(500).json({ error: 'Baza oxunma xətası' });
    }
});

let gpsUpdateInProgress = false;
const busMovementStates = new Map();

function findNearestWaypointIndex(bus, waypoints) {
    return waypoints.reduce((nearestIndex, waypoint, index) => {
        const distance = Math.hypot(
            Number(bus.current_lat) - waypoint[0],
            Number(bus.current_lng) - waypoint[1]
        );
        const nearest = waypoints[nearestIndex];
        const nearestDistance = Math.hypot(
            Number(bus.current_lat) - nearest[0],
            Number(bus.current_lng) - nearest[1]
        );
        return distance < nearestDistance ? index : nearestIndex;
    }, 0);
}

function normalizeStopName(name) {
    return String(name || '').toLocaleLowerCase().replace(/\s*[·–-].*$/, '').trim();
}

function initializeBusMovementState(bus, waypoints) {
    const startDistance = Math.hypot(
        Number(bus.current_lat) - waypoints[0][0],
        Number(bus.current_lng) - waypoints[0][1]
    );
    const endWaypoint = waypoints[waypoints.length - 1];
    const endDistance = Math.hypot(
        Number(bus.current_lat) - endWaypoint[0],
        Number(bus.current_lng) - endWaypoint[1]
    );
    const origin = normalizeStopName(bus.origin);
    const routeStart = normalizeStopName(bus.route_start);
    const routeEnd = normalizeStopName(bus.route_end);
    const forward = origin === routeStart
        ? true
        : origin === routeEnd
            ? false
            : startDistance <= endDistance;

    return { index: findNearestWaypointIndex(bus, waypoints), forward };
}

async function updateBusCoordinates() {
    if (gpsUpdateInProgress) return;
    gpsUpdateInProgress = true;

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');
        const result = await client.query(
            `SELECT b.id, b.route_id, b.current_lat, b.current_lng, b.origin, b.destination,
                    (SELECT stop_name FROM stops WHERE route_id = b.route_id
                     ORDER BY stop_order ASC LIMIT 1) AS route_start,
                    (SELECT stop_name FROM stops WHERE route_id = b.route_id
                     ORDER BY stop_order DESC LIMIT 1) AS route_end
             FROM buses b FOR UPDATE OF b`
        );
        const updatedStates = [];

        for (const bus of result.rows) {
            const waypoints = routePolylines[bus.route_id];
            if (!waypoints || waypoints.length === 0) continue;

            const currentState = busMovementStates.get(bus.id) ||
                initializeBusMovementState(bus, waypoints);
            let nextIndex;
            let forward = currentState.forward;
            let origin = bus.origin;
            let destination = bus.destination;

            if (forward) {
                nextIndex = Math.min(currentState.index + 1, waypoints.length - 1);
                if (nextIndex === waypoints.length - 1) {
                    forward = false;
                    [origin, destination] = [destination, origin];
                }
            } else {
                nextIndex = Math.max(currentState.index - 1, 0);
                if (nextIndex === 0) {
                    forward = true;
                    [origin, destination] = [destination, origin];
                }
            }

            const [latitude, longitude] = waypoints[nextIndex];

            await client.query(
                `UPDATE buses
                 SET current_lat = $1, current_lng = $2, origin = $3,
                     destination = $4, last_updated = NOW()
                 WHERE id = $5`,
                [latitude, longitude, origin, destination, bus.id]
            );
            updatedStates.push([bus.id, { index: nextIndex, forward }]);
        }

        await client.query('COMMIT');
        updatedStates.forEach(([busId, state]) => busMovementStates.set(busId, state));
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('GPS simulation update error:', err);
    } finally {
        if (client) client.release();
        gpsUpdateInProgress = false;
    }
}

if (require.main === module) {
    const port = process.env.PORT || 3000;
    ensureBusSchema().then(() => {
        app.listen(port, () => {
            console.log(`Server ${port} portunda aktivdir (http://localhost:${port})`);
        });
        const gpsSimulationTimer = setInterval(updateBusCoordinates, 6000);
        gpsSimulationTimer.unref();
    }).catch(err => {
        console.error('Bus timestamp migration error:', err);
        process.exitCode = 1;
    });
}

module.exports = app;