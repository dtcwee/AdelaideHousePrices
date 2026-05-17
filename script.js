/**
 * Adelaide House Prices Choropleth Map
 * 
 * This script loads a compressed GeoJSON file containing Adelaide property data,
 * decompresses it in the browser, and visualizes it as a choropleth map using Leaflet.
 * Users can select start and end dates to see percentage changes in median prices by suburb.
 * A search box allows users to quickly find and zoom to specific suburbs.
 */

const map = L.map('map').setView([-34.9285, 138.6007], 11);
const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data © <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
}).addTo(map);

const startDateSelect = document.getElementById('startDateSelect');
const endDateSelect = document.getElementById('endDateSelect');
const suburbSearch = document.getElementById('suburbSearch');
const suburbList = document.getElementById('suburbList');
const updateButton = document.getElementById('updateMapButton');
const statusBanner = document.getElementById('statusBanner');
const legendContainer = document.getElementById('legend');

const stats = {
    geoBySuburb: {},
    dateIndex: {},
    suburbNames: [],
    layerBySuburb: {},
    featureGroup: null
};

const bins = [-50, -20, -10, -5, 0, 5, 10, 20, 50];
const colors = ['#a50026', '#d73027', '#f46d43', '#fdae61', '#ffffbf', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'];

function setStatus(message, variant = 'info') {
    const bg = variant === 'error' ? '#ffe5e5' : '#eaf2ff';
    const color = variant === 'error' ? '#a40000' : '#0f2b64';
    statusBanner.textContent = message;
    statusBanner.style.background = bg;
    statusBanner.style.color = color;
}

function getColor(value) {
    if (value === null || isNaN(value)) return '#cccccc';
    for (let i = 0; i < bins.length; i += 1) {
        if (value <= bins[i]) {
            return colors[i];
        }
    }
    return colors[colors.length - 1];
}

function buildLegend() {
    const labels = [
        '<  -50%',
        '-50% to -20%',
        '-20% to -10%',
        '-10% to -5%',
        '-5% to 0%',
        '0% to 5%',
        '5% to 10%',
        '10% to 20%',
        '> 20%'
    ];
    legendContainer.innerHTML = labels.map((label, index) => {
        return `<div class="legend-item"><span class="legend-swatch" style="background:${colors[index]}"></span><span>${label}</span></div>`;
    }).join('');
}

function formatNumeric(value) {
    if (value === null || value === undefined || value === '' || isNaN(value)) {
        return 'N/A';
    }
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function loadGeoJson() {
    setStatus('Fetching compressed GeoJSON file...', 'info');

    return fetch('adelaide_property_data.geojson.gz')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Unable to load file: ${response.statusText}`);
            }
            return response.arrayBuffer();
        })
        .then(arrayBuffer => {
            setStatus('Decompressing GeoJSON...', 'info');
            const decompressed = pako.inflate(new Uint8Array(arrayBuffer), { to: 'string' });
            return JSON.parse(decompressed);
        });
}

function normalizeSuburbName(name) {
    return String(name || '').trim().toLowerCase();
}

function getDateValue(date) {
    const raw = String(date || '');
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : raw;
}

function prepareData(data) {
    if (!Array.isArray(data.features)) {
        throw new Error('GeoJSON does not contain a features array.');
    }

    const dates = new Set();
    const suburbSet = new Set();

    data.features.forEach(feature => {
        const props = feature.properties || {};
        const suburb = normalizeSuburbName(props.suburb);
        const date = getDateValue(props.date);
        const medianPrice = Number(props.median_price);
        const sales = Number(props.sales);

        if (!suburb || !date) {
            return;
        }

        dates.add(date);
        suburbSet.add(suburb);

        if (!stats.geoBySuburb[suburb]) {
            stats.geoBySuburb[suburb] = {
                name: props.suburb,
                geometry: feature.geometry,
                values: {}
            };
        }

        if (!stats.dateIndex[date]) {
            stats.dateIndex[date] = {};
        }
        stats.dateIndex[date][suburb] = {
            median_price: medianPrice,
            sales: Number.isFinite(sales) ? sales : null,
            feature: feature
        };
    });

    stats.suburbNames = Array.from(suburbSet).sort((a, b) => a.localeCompare(b));
    const sortedDates = Array.from(dates).sort();
    return sortedDates;
}

function populateControls(sortedDates) {
    startDateSelect.innerHTML = '';
    endDateSelect.innerHTML = '';
    suburbList.innerHTML = '';

    sortedDates.forEach(date => {
        const optionA = document.createElement('option');
        optionA.value = date;
        optionA.textContent = date;
        startDateSelect.appendChild(optionA);

        const optionB = document.createElement('option');
        optionB.value = date;
        optionB.textContent = date;
        endDateSelect.appendChild(optionB);
    });

    stats.suburbNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        suburbList.appendChild(option);
    });

    if (sortedDates.length >= 2) {
        startDateSelect.value = sortedDates[0];
        endDateSelect.value = sortedDates[sortedDates.length - 1];
    }
}

function createChoroplethLayer(startDate, endDate) {
    if (stats.featureGroup) {
        map.removeLayer(stats.featureGroup);
    }

    const features = [];
    stats.suburbNames.forEach(suburb => {
        const startRecord = stats.dateIndex[startDate]?.[suburb];
        const endRecord = stats.dateIndex[endDate]?.[suburb];
        if (!startRecord || !endRecord) {
            return;
        }

        const startPrice = startRecord.median_price;
        const endPrice = endRecord.median_price;
        const pctChange = Number.isFinite(startPrice) && startPrice !== 0
            ? ((endPrice - startPrice) / startPrice) * 100
            : null;
        const absoluteChange = Number.isFinite(startPrice) && Number.isFinite(endPrice)
            ? endPrice - startPrice
            : null;

        features.push({
            type: 'Feature',
            properties: {
                suburb: stats.geoBySuburb[suburb].name,
                normalized: suburb,
                startDate,
                endDate,
                startSales: startRecord.sales,
                endSales: endRecord.sales,
                startPrice,
                endPrice,
                absoluteChange,
                percentageChange: pctChange
            },
            geometry: stats.geoBySuburb[suburb].geometry
        });
    });

    stats.featureGroup = L.geoJSON(features, {
        style(feature) {
            return {
                fillColor: getColor(feature.properties.percentageChange),
                weight: 1,
                opacity: 1,
                color: '#ffffff',
                fillOpacity: 0.75
            };
        },
        onEachFeature(feature, layer) {
            const props = feature.properties;
            const tooltip = `<strong>${props.suburb}</strong><br/>` +
                `Start Date: ${props.startDate}<br/>` +
                `End Date: ${props.endDate}<br/>` +
                `Sales (Start): ${formatNumeric(props.startSales)}<br/>` +
                `Sales (End): ${formatNumeric(props.endSales)}<br/>` +
                `Median Price (Start): $${formatNumeric(props.startPrice)}<br/>` +
                `Median Price (End): $${formatNumeric(props.endPrice)}<br/>` +
                `Absolute Change: $${formatNumeric(props.absoluteChange)}<br/>` +
                `Pct Change: ${props.percentageChange === null ? 'N/A' : props.percentageChange.toFixed(2) + '%'}`;
            layer.bindTooltip(tooltip, {
                sticky: true,
                className: 'suburb-tooltip'
            });
            layer.on('click', () => {
                layer.openTooltip();
            });
            stats.layerBySuburb[props.normalized] = layer;
        }
    }).addTo(map);

    if (features.length > 0) {
        map.fitBounds(stats.featureGroup.getBounds(), { padding: [20, 20] });
    }
}

function updateMap() {
    const startDate = startDateSelect.value;
    const endDate = endDateSelect.value;
    if (!startDate || !endDate) {
        setStatus('Please select both start and end dates.', 'error');
        return;
    }
    if (startDate === endDate) {
        setStatus('Start and end dates must be different to calculate change.', 'error');
        return;
    }

    createChoroplethLayer(startDate, endDate);
    setStatus(`Map updated for ${startDate} → ${endDate}.`, 'info');
}

function highlightSuburb() {
    const searchText = normalizeSuburbName(suburbSearch.value);
    if (!searchText) {
        return;
    }
    const layer = stats.layerBySuburb[searchText];
    if (layer) {
        map.fitBounds(layer.getBounds(), { padding: [30, 30] });
        layer.openTooltip();
        setStatus(`Centered on ${layer.feature.properties.suburb}.`, 'info');
    } else {
        setStatus(`Suburb not found: ${suburbSearch.value}`, 'error');
    }
}

function initialize() {
    buildLegend();
    loadGeoJson()
        .then(data => {
            const sortedDates = prepareData(data);
            if (sortedDates.length < 2) {
                throw new Error('Need at least two dates to compare percentage change.');
            }
            populateControls(sortedDates);
            updateMap();
        })
        .catch(error => {
            setStatus(error.message, 'error');
            console.error(error);
        });
}

updateButton.addEventListener('click', updateMap);
suburbSearch.addEventListener('change', highlightSuburb);
suburbSearch.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        highlightSuburb();
    }
});

initialize();