const BAKU_CENTER = [40.3800, 49.8350];
const API_BASE = '/api';
const routeColors = { '14': '#2563eb', M2: '#dc2626', M3: '#9333ea' };
let map;
let busMarkers = Object.create(null);
let busMarkerCrowds = Object.create(null);
let busesData = [];
let stopMarkers = [];
let activeRouteLine = null;
let routeRequestId = 0;
let toastTimeout;

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) lucide.createIcons();
    initMap();
    document.addEventListener('click', event => {
        const reportButton = event.target.closest('.bus-crowd-report');
        if (reportButton) {
            sendCrowdReport(reportButton.dataset.crowdLevel, reportButton.dataset.busId);
            return;
        }

        const addBusButton = event.target.closest('.add-anomaly-bus');
        if (addBusButton) {
            addBusForAnomaly(addBusButton.dataset.routeId, addBusButton.dataset.busId, addBusButton);
        }
    });
    await populateRouteDropdown();
    await loadBuses();
    await loadAnomalies();
    setInterval(loadBuses, 6000);
    setInterval(loadAnomalies, 2000);
});

function initMap() {
    map = L.map('map', { zoomControl: false }).setView(BAKU_CENTER, 13);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri',
        maxZoom: 18
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

async function requestJson(path, options) {
    const response = await fetch(`${API_BASE}${path}`, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

async function populateRouteDropdown() {
    const select = document.getElementById('route-select');
    try {
        const { routes } = await requestJson('/routes');
        select.replaceChildren(...routes.map(routeId => {
            const option = document.createElement('option');
            option.value = routeId;
            option.textContent = `Xətt ${routeId}`;
            return option;
        }));
        if (routes.length) {
            select.value = routes.includes('14') ? '14' : routes[0];
            await drawBusRoute(select.value);
        }
    } catch (error) {
        showFeedback(`Marşrutlar yüklənmədi: ${error.message}`, true);
    }
}

async function drawBusRoute(routeId) {
    const requestId = ++routeRequestId;
    if (activeRouteLine) map.removeLayer(activeRouteLine);
    stopMarkers.forEach(marker => map.removeLayer(marker));
    stopMarkers = [];

    try {
        const { stops, routePolyline } = await requestJson(`/stops?route_id=${encodeURIComponent(routeId)}`);
        if (requestId !== routeRequestId || stops.length === 0) return;

        const routeCoordinates = routePolyline.length
            ? routePolyline
            : stops.map(stop => [stop.lat, stop.lng]);
        const coordinates = routeCoordinates.map(point => [Number(point[0]), Number(point[1])]);
        if (coordinates.length > 1) {
            activeRouteLine = L.polyline(coordinates, {
                color: routeColors[routeId] || '#2563eb',
                weight: 6,
                opacity: 0.8
            }).addTo(map);
            map.fitBounds(activeRouteLine.getBounds(), { padding: [40, 40] });
        } else {
            map.setView(coordinates[0], 15);
        }

        stops.forEach(stop => addStopMarker(stop, routeId));
        try {
            const { arrivals } = await requestJson(`/stops/${encodeURIComponent(stops[0].id)}/arrivals`);
            if (requestId === routeRequestId) updateNextBus(arrivals);
        } catch (error) {
            updateNextBus([]);
            console.error('Arrival summary failed:', error);
        }
    } catch (error) {
        showFeedback(`Dayanacaqlar yüklənmədi: ${error.message}`, true);
    }
}

function addStopMarker(stop, routeId) {
    const marker = L.circleMarker([Number(stop.lat), Number(stop.lng)], {
        radius: 7,
        fillColor: '#ffffff',
        color: routeColors[routeId] || '#2563eb',
        weight: 3,
        fillOpacity: 1
    }).addTo(map);

    marker.bindPopup(`<div class="p-1"><strong>${escapeHtml(stop.name)}</strong><p>Gələn avtobuslar yüklənir...</p></div>`);
    marker.on('click', async () => {
        marker.setPopupContent(`<div class="p-1"><strong>${escapeHtml(stop.name)}</strong><p>Gələn avtobuslar yüklənir...</p></div>`);
        try {
            const { arrivals } = await requestJson(`/stops/${encodeURIComponent(stop.id)}/arrivals`);
            updateNextBus(arrivals);
            const arrivalRows = arrivals.map(bus => `
                <div class="flex justify-between gap-4 text-xs p-1.5">
                    <span>${escapeHtml(bus.bus_id)} · ${escapeHtml(bus.crowd)}</span>
                    <strong>${Number(bus.eta_minutes)} dəq</strong>
                </div>`).join('');
            const content = arrivals.length ? arrivalRows : '<p>Bu xətt üzrə aktiv avtobus yoxdur.</p>';
            marker.setPopupContent(`<div class="p-1 min-w-[190px]"><strong>${escapeHtml(stop.name)}</strong><p class="my-1 text-xs">Gələn avtobuslar və ETA</p>${content}</div>`);
        } catch (error) {
            marker.setPopupContent(`<div class="p-1">ETA yüklənmədi: ${escapeHtml(error.message)}</div>`);
        }
    });

    stopMarkers.push(marker);
}

function updateNextBus(arrivals) {
    const nextBusId = document.getElementById('next-bus-id');
    const nextBusEta = document.getElementById('next-bus-eta');
    const nextBus = arrivals[0];
    nextBusId.textContent = nextBus ? nextBus.bus_id : 'Avtobus yoxdur';
    nextBusEta.textContent = nextBus ? `${Number(nextBus.eta_minutes)} dəqiqə` : 'Məlumat yoxdur';
}

function onRouteChanged() {
    const route = document.getElementById('route-select').value;
    updateBusSelect(busesData);
    renderBusMarkers(busesData);
    drawBusRoute(route);
}

async function loadBuses() {
    try {
        const { buses } = await requestJson('/buses');
        busesData = buses;
        updateBusSelect(busesData);
        renderBusMarkers(busesData);
        const activeCount = document.getElementById('stat-active-buses');
        if (activeCount) activeCount.textContent = String(buses.length);
    } catch (error) {
        console.error('Bus refresh failed:', error);
    }
}

function updateBusSelect(buses) {
    const select = document.getElementById('bus-select');
    if (!select) return;

    const routeId = document.getElementById('route-select')?.value;
    const activeBuses = routeId ? buses.filter(bus => bus.route_id === routeId) : buses;
    const previousSelection = select.value;
    const options = activeBuses.map(bus => {
        const option = document.createElement('option');
        option.value = bus.id;
        option.textContent = bus.id;
        return option;
    });

    select.replaceChildren(...options);
    select.value = activeBuses.some(bus => bus.id === previousSelection)
        ? previousSelection
        : activeBuses[0]?.id || '';
}

function renderBusMarkers(buses) {
    const selectedRoute = document.getElementById('route-select')?.value;
    const activeBuses = selectedRoute
        ? buses.filter(bus => bus.route_id === selectedRoute)
        : buses;
    const currentIds = new Set();
    activeBuses.forEach(bus => {
        currentIds.add(bus.id);
        const crowdLevel = String(bus.crowd_level || bus.crowd || 'low').toLowerCase();
        const crowd = ['high', 'medium', 'low'].includes(crowdLevel) ? crowdLevel : 'low';
        const customIcon = L.divIcon({
            className: `bus-marker-icon bus-marker-${crowd}`,
            html: '<span>🚌</span>',
            iconSize: [32, 32]
        });
        const popupHTML = `
            <div class="p-2 min-w-[180px]">
                <div class="flex justify-between items-center mb-1">
                    <span class="font-bold text-blue-600">${escapeHtml(bus.id)}</span>
                    <span class="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded uppercase">${escapeHtml(crowd)}</span>
                </div>
                <div class="text-xs text-slate-600 space-y-1">
                    <p><b>Xətt:</b> ${escapeHtml(bus.route_id)}</p>
                    <p><b>Haradan:</b> ${escapeHtml(bus.origin)}</p>
                    <p><b>Haraya:</b> ${escapeHtml(bus.destination)}</p>
                </div>
                <div class="bus-crowd-actions">
                    <button type="button" class="bus-crowd-report bus-crowd-low" data-bus-id="${escapeHtml(bus.id)}" data-crowd-level="low">Az</button>
                    <button type="button" class="bus-crowd-report bus-crowd-medium" data-bus-id="${escapeHtml(bus.id)}" data-crowd-level="medium">Orta</button>
                    <button type="button" class="bus-crowd-report bus-crowd-high" data-bus-id="${escapeHtml(bus.id)}" data-crowd-level="high">Yüksək</button>
                </div>
            </div>`;

        if (busMarkers[bus.id]) {
            busMarkers[bus.id].setLatLng([Number(bus.lat), Number(bus.lng)]);
            if (busMarkerCrowds[bus.id] !== crowd) {
                busMarkers[bus.id].setIcon(customIcon);
                busMarkerCrowds[bus.id] = crowd;
            }
            busMarkers[bus.id].setPopupContent(popupHTML);
        } else {
            busMarkers[bus.id] = L.marker([Number(bus.lat), Number(bus.lng)], { icon: customIcon })
                .addTo(map)
                .bindPopup(popupHTML);
            busMarkerCrowds[bus.id] = crowd;
        }
    });

    Object.keys(busMarkers).forEach(busId => {
        if (!currentIds.has(busId)) {
            map.removeLayer(busMarkers[busId]);
            delete busMarkers[busId];
            delete busMarkerCrowds[busId];
        }
    });
}

async function sendCrowdReport(level, busId) {
    const selectedBusId = busId || document.getElementById('bus-select').value;
    const bus = busesData.find(item => item.id === selectedBusId);
    if (!bus) {
        showFeedback('Əvvəlcə avtobus seçin.', true);
        return;
    }

    showFeedback('Göndərilir...');

    try {
        await requestJson('/crowd-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bus_id: bus.id, route_id: bus.route_id, crowd_level: level })
        });
        showFeedback(`${bus.id} üçün məlumat qeydə alındı!`);
        showToast(`✓ ${bus.id} üçün sıxlıq bildirildi`);
        await loadBuses();
        await loadAnomalies();
    } catch (error) {
        showFeedback(`Hesabat göndərilmədi: ${error.message}`, true);
        showToast(`Hesabat göndərilmədi: ${error.message}`, true);
    }
}

async function loadAnomalies() {
    try {
        const { alerts } = await requestJson('/operator/anomalies');
        const alertBox = document.getElementById('anomaly-alert-box');
        const alertList = document.getElementById('anomaly-list');
        const alertStat = document.getElementById('stat-alerts-count');
        alertStat.textContent = String(alerts.length);

        if (alerts.length) {
            alertList.replaceChildren(...alerts.map(alert => {
                const item = document.createElement('div');
                item.className = 'space-y-2';
                const message = document.createElement('p');
                message.className = 'text-xs text-rose-200 font-medium leading-relaxed';
                message.textContent = `Əlavə avtobus ehtiyyatı ayrılmalıdır (Xətt: ${alert.route_id}, Avtobus: ${alert.bus_id})`;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'add-anomaly-bus px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded';
                button.dataset.routeId = alert.route_id;
                button.dataset.busId = alert.bus_id;
                button.textContent = 'Yeni avtobus əlavə et';
                item.append(message, button);
                return item;
            }));
            alertBox.classList.remove('hidden');
        } else {
            alertList.replaceChildren();
            alertBox.classList.add('hidden');
        }
    } catch (error) {
        console.error('Anomaly refresh failed:', error);
    }
}

async function addBusForAnomaly(routeId, busIdToClear, button) {
    button.disabled = true;
    button.textContent = 'Əlavə olunur...';
    try {
        const result = await requestJson('/operator/add-bus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ route_id: routeId, bus_id_to_clear: busIdToClear })
        });
        const routeSelect = document.getElementById('route-select');
        routeSelect.value = routeId;
        await loadBuses();
        await drawBusRoute(routeId);
        await loadAnomalies();
        showToast(`✓ Yeni avtobus ${result.new_bus_id} Xətt ${routeId}-ə əlavə edildi!`);
    } catch (error) {
        console.error('Bus dispatch failed:', error);
        showFeedback(`Avtobus əlavə edilmədi: ${error.message}`, true);
        showToast(`Avtobus əlavə edilmədi: ${error.message}`, true);
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = 'Yeni avtobus əlavə et';
        }
    }
}

function showToast(message, isError = false) {
    const toast = document.getElementById('app-toast');
    if (!toast) return;

    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.classList.add('is-visible');
    toastTimeout = setTimeout(() => toast.classList.remove('is-visible'), 3000);
}

function showFeedback(message, isError = false) {
    const feedback = document.getElementById('report-feedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle('text-rose-400', isError);
    feedback.classList.toggle('text-emerald-400', !isError);
    if (!isError) setTimeout(() => { feedback.textContent = ''; }, 3000);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function switchTab(tab) {
    const passengerView = document.getElementById('view-passenger');
    const operatorView = document.getElementById('view-operator');
    const passengerButton = document.getElementById('tab-passenger');
    const operatorButton = document.getElementById('tab-operator');

    if (tab === 'passenger') {
        passengerView.classList.remove('hidden');
        operatorView.classList.add('hidden');
        passengerButton.className = 'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white shadow transition-all';
        operatorButton.className = 'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition-all';
    } else {
        operatorView.classList.remove('hidden');
        passengerView.classList.add('hidden');
        operatorButton.className = 'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white shadow transition-all';
        passengerButton.className = 'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition-all';
    }
}