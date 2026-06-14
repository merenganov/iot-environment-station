import Chart from 'chart.js/auto';
import { onValue, ref, set } from 'firebase/database';
import { database, firebaseConfigured } from '../lib/firebase';

type EnvironmentReading = {
  temperatura: number;
  iluminacion: number;
  lluvia: boolean;
  wifi: boolean;
  estadoSistema?: string;
  actualizadoEn: number;
};

type ControlState = {
  modo: 'automatico' | 'manual';
  led: boolean;
  buzzer: boolean;
  alarma: boolean;
};

type HistoryReading = {
  temperatura: number;
  iluminacion: number;
  lluvia: boolean;
  timestamp: number;
};

type Severity = 'normal' | 'warning' | 'danger';

const initialReading: EnvironmentReading = {
  temperatura: 24.6,
  iluminacion: 72,
  lluvia: false,
  wifi: true,
  estadoSistema: 'normal',
  actualizadoEn: Date.now()
};

let currentReading = { ...initialReading };
let controls: ControlState = {
  modo: 'automatico',
  led: false,
  buzzer: false,
  alarma: true
};

const history: HistoryReading[] = Array.from({ length: 12 }, (_, index) => ({
  temperatura: Number((22.8 + Math.sin(index / 2) * 1.8 + index * 0.08).toFixed(1)),
  iluminacion: Math.round(68 + Math.cos(index / 2) * 11),
  lluvia: false,
  timestamp: Date.now() - (11 - index) * 60_000
}));

const getElement = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const chartCanvas = getElement<HTMLCanvasElement>('sensor-chart');
const chart = chartCanvas
  ? new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: history.map((item) => formatTime(item.timestamp)),
        datasets: [
          {
            label: 'Temperatura °C',
            data: history.map((item) => item.temperatura),
            tension: 0.35,
            borderWidth: 3,
            pointRadius: 2,
            yAxisID: 'y'
          },
          {
            label: 'Iluminación %',
            data: history.map((item) => item.iluminacion),
            tension: 0.35,
            borderWidth: 3,
            pointRadius: 2,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            min: 0,
            max: 45,
            title: { display: true, text: 'Temperatura °C' }
          },
          y1: {
            min: 0,
            max: 100,
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Iluminación %' }
          }
        }
      }
    })
  : null;

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp);
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(timestamp);
}

function temperatureSeverity(value: number): Severity {
  if (value >= 32) return 'danger';
  if (value >= 28) return 'warning';
  return 'normal';
}

function lightSeverity(value: number): Severity {
  if (value <= 25) return 'danger';
  if (value <= 45) return 'warning';
  return 'normal';
}

function setCardState(
  id: string,
  value: string,
  unit: string,
  severity: Severity,
  description: string
) {
  const card = document.querySelector<HTMLElement>(`[data-sensor-card="${id}"]`);
  const valueElement = getElement(`value-${id}`);
  const unitElement = getElement(`unit-${id}`);
  const statusElement = getElement(`status-${id}`);
  const descriptionElement = getElement(`description-${id}`);

  if (!card || !valueElement || !unitElement || !statusElement || !descriptionElement) return;

  card.classList.remove('status-normal', 'status-warning', 'status-danger');
  card.classList.add(`status-${severity}`);
  valueElement.textContent = value;
  unitElement.textContent = unit;
  descriptionElement.textContent = description;
  statusElement.textContent =
    severity === 'normal' ? 'Normal' : severity === 'warning' ? 'Advertencia' : 'Alerta';
}

function updateDashboard(reading: EnvironmentReading) {
  currentReading = reading;
  const tempSeverity = temperatureSeverity(reading.temperatura);
  const illuminationSeverity = lightSeverity(reading.iluminacion);
  const rainSeverity: Severity = reading.lluvia ? 'danger' : 'normal';
  const wifiSeverity: Severity = reading.wifi ? 'normal' : 'danger';

  setCardState(
    'temperature',
    reading.temperatura.toFixed(1),
    ' °C',
    tempSeverity,
    tempSeverity === 'danger'
      ? 'Temperatura alta: revisar ventilación.'
      : tempSeverity === 'warning'
        ? 'La temperatura se aproxima al límite.'
        : 'Temperatura dentro del rango establecido.'
  );

  setCardState(
    'light',
    Math.round(reading.iluminacion).toString(),
    ' %',
    illuminationSeverity,
    illuminationSeverity === 'danger'
      ? 'Baja iluminación: se recomienda encender el foco.'
      : illuminationSeverity === 'warning'
        ? 'El nivel de iluminación está disminuyendo.'
        : 'Nivel de iluminación adecuado.'
  );

  setCardState(
    'rain',
    reading.lluvia ? 'Lluvia detectada' : 'Sin lluvia',
    '',
    rainSeverity,
    reading.lluvia
      ? 'Presencia de humedad o lluvia: cerrar ventana.'
      : 'No se detecta presencia de lluvia.'
  );

  setCardState(
    'wifi',
    reading.wifi ? 'Conectado' : 'Sin conexión',
    '',
    wifiSeverity,
    reading.wifi
      ? 'El ESP32 está enviando datos correctamente.'
      : 'No se están recibiendo datos desde el ESP32.'
  );

  const worstSeverity: Severity = [tempSeverity, illuminationSeverity, rainSeverity, wifiSeverity].includes(
    'danger'
  )
    ? 'danger'
    : [tempSeverity, illuminationSeverity].includes('warning')
      ? 'warning'
      : 'normal';

  updateSystemSummary(worstSeverity);
  updateAlerts(reading, tempSeverity, illuminationSeverity);

  const lastUpdate = getElement('last-update');
  if (lastUpdate) lastUpdate.textContent = formatDateTime(reading.actualizadoEn || Date.now());
}

function updateSystemSummary(severity: Severity) {
  const summary = getElement('system-summary');
  const icon = getElement('system-icon');
  const status = getElement('system-status');
  if (!summary || !icon || !status) return;

  summary.classList.remove('status-normal', 'status-warning', 'status-danger');
  summary.classList.add(`status-${severity}`);

  if (severity === 'danger') {
    icon.textContent = '!';
    status.textContent = 'Alerta activa';
  } else if (severity === 'warning') {
    icon.textContent = '⚠';
    status.textContent = 'Requiere atención';
  } else {
    icon.textContent = '✓';
    status.textContent = 'Condición normal';
  }
}

function updateAlerts(
  reading: EnvironmentReading,
  tempSeverity: Severity,
  lightSeverityValue: Severity
) {
  const alertList = getElement('alert-list');
  const count = getElement('alert-count');
  if (!alertList || !count) return;

  const alerts: Array<{ title: string; message: string; severity: Severity }> = [];

  if (tempSeverity !== 'normal') {
    alerts.push({
      title: tempSeverity === 'danger' ? 'ALERTA: temperatura alta' : 'Advertencia de temperatura',
      message: `La lectura actual es de ${reading.temperatura.toFixed(1)} °C.`,
      severity: tempSeverity
    });
  }

  if (lightSeverityValue !== 'normal') {
    alerts.push({
      title: lightSeverityValue === 'danger' ? 'Baja iluminación' : 'Iluminación disminuyendo',
      message: `Nivel actual: ${Math.round(reading.iluminacion)} %.`,
      severity: lightSeverityValue
    });
  }

  if (reading.lluvia) {
    alerts.push({
      title: 'Presencia de humedad / lluvia',
      message: 'Se recomienda cerrar la ventana.',
      severity: 'danger'
    });
  }

  if (!reading.wifi) {
    alerts.push({
      title: 'ESP32 sin conexión',
      message: 'Revisar la red Wi-Fi y la alimentación del dispositivo.',
      severity: 'danger'
    });
  }

  count.textContent = `${alerts.length} ${alerts.length === 1 ? 'activa' : 'activas'}`;

  if (!alerts.length) {
    alertList.innerHTML = `
      <div class="empty-state">
        <span aria-hidden="true">✓</span>
        <p>No hay alertas activas.</p>
      </div>`;
    return;
  }

  alertList.innerHTML = alerts
    .map(
      (alert) => `
        <div class="alert-item status-${alert.severity}">
          <span class="alert-item__icon" aria-hidden="true">${alert.severity === 'danger' ? '!' : '⚠'}</span>
          <div>
            <strong>${alert.title}</strong>
            <p>${alert.message}</p>
          </div>
        </div>`
    )
    .join('');
}

function addHistoryReading(reading: EnvironmentReading) {
  history.push({
    temperatura: reading.temperatura,
    iluminacion: reading.iluminacion,
    lluvia: reading.lluvia,
    timestamp: reading.actualizadoEn || Date.now()
  });

  while (history.length > 12) history.shift();
  if (!chart) return;

  chart.data.labels = history.map((item) => formatTime(item.timestamp));
  chart.data.datasets[0].data = history.map((item) => item.temperatura);
  chart.data.datasets[1].data = history.map((item) => item.iluminacion);
  chart.update();
}

function updateConnection(connected: boolean, label: string) {
  const dot = getElement('connection-dot');
  const connectionLabel = getElement('connection-label');
  if (!dot || !connectionLabel) return;

  dot.classList.toggle('offline', !connected);
  connectionLabel.textContent = label;
}

function updateControlInterface() {
  const currentMode = getElement('current-mode');
  const note = getElement('controls-note');

  if (currentMode) currentMode.textContent = controls.modo === 'automatico' ? 'Automático' : 'Manual';
  if (note) {
    note.textContent =
      controls.modo === 'automatico'
        ? 'En modo automático, el ESP32 decide qué actuadores activar según las lecturas.'
        : 'En modo manual puedes activar o desactivar los actuadores desde este panel.';
  }

  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === controls.modo);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => {
    const controlName = button.dataset.control as keyof Omit<ControlState, 'modo'>;
    const enabled = Boolean(controls[controlName]);
    button.classList.toggle('active', enabled);
    button.disabled = controls.modo !== 'manual';
    button.setAttribute('aria-pressed', String(enabled));
    const label = button.querySelector('small');
    if (label) {
      label.textContent = controlName === 'alarma'
        ? enabled ? 'Activadas' : 'Desactivadas'
        : enabled ? 'Encendido' : 'Apagado';
    }
  });
}

async function persistControl(path: string, value: boolean | string) {
  if (!database) return;
  try {
    await set(ref(database, `estacion/control/${path}`), value);
  } catch (error) {
    console.error('No fue posible actualizar el control en Firebase:', error);
  }
}

function configureControls() {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      if (mode !== 'automatico' && mode !== 'manual') return;
      controls.modo = mode;
      updateControlInterface();
      void persistControl('modo', mode);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => {
    button.addEventListener('click', () => {
      if (controls.modo !== 'manual') return;
      const controlName = button.dataset.control as keyof Omit<ControlState, 'modo'>;
      controls[controlName] = !controls[controlName];
      updateControlInterface();
      void persistControl(controlName, controls[controlName]);
    });
  });
}

function startDemoMode() {
  const source = getElement('data-source');
  if (source) source.textContent = 'Simulación local';
  updateConnection(true, 'Demostración activa');
  updateDashboard(initialReading);

  window.setInterval(() => {
    const nextReading: EnvironmentReading = {
      temperatura: Number(Math.max(18, Math.min(36, currentReading.temperatura + (Math.random() - 0.48) * 2.2)).toFixed(1)),
      iluminacion: Math.round(Math.max(10, Math.min(100, currentReading.iluminacion + (Math.random() - 0.5) * 18))),
      lluvia: Math.random() > 0.9 ? !currentReading.lluvia : currentReading.lluvia,
      wifi: true,
      estadoSistema: 'simulado',
      actualizadoEn: Date.now()
    };

    updateDashboard(nextReading);
    addHistoryReading(nextReading);
  }, 4000);
}

function startFirebaseMode() {
  if (!database) {
    startDemoMode();
    return;
  }

  const source = getElement('data-source');
  if (source) source.textContent = 'Firebase Realtime Database';
  updateConnection(true, 'Firebase conectado');

  onValue(
    ref(database, 'estacion/actual'),
    (snapshot) => {
      const value = snapshot.val() as Partial<EnvironmentReading> | null;
      if (!value) return;

      const reading: EnvironmentReading = {
        temperatura: Number(value.temperatura ?? currentReading.temperatura),
        iluminacion: Number(value.iluminacion ?? currentReading.iluminacion),
        lluvia: Boolean(value.lluvia),
        wifi: value.wifi !== false,
        estadoSistema: String(value.estadoSistema ?? 'normal'),
        actualizadoEn: Number(value.actualizadoEn ?? Date.now())
      };
      updateDashboard(reading);
      addHistoryReading(reading);
    },
    () => updateConnection(false, 'Error de conexión')
  );

  onValue(ref(database, 'estacion/control'), (snapshot) => {
    const value = snapshot.val() as Partial<ControlState> | null;
    if (!value) return;
    controls = {
      modo: value.modo === 'manual' ? 'manual' : 'automatico',
      led: Boolean(value.led),
      buzzer: Boolean(value.buzzer),
      alarma: value.alarma !== false
    };
    updateControlInterface();
  });
}

configureControls();
updateControlInterface();

if (firebaseConfigured) {
  startFirebaseMode();
} else {
  startDemoMode();
}
