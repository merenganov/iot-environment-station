import Chart from 'chart.js/auto';
import {
  limitToLast,
  onValue,
  orderByChild,
  query,
  ref,
  set
} from 'firebase/database';
import { database, firebaseConfigured } from '../lib/firebase';

type EnvironmentReading = {
  temperatura: number;
  iluminacion: number;
  lluvia: boolean;
  alarmaActiva: boolean;
  wifi: boolean;
  estadoSistema?: string;
  actualizadoEn: number;
};

type HistoryReading = {
  temperatura: number;
  iluminacion: number;
  lluvia: boolean;
  alarmaActiva?: boolean;
  timestamp: number;
};

type Severity = 'normal' | 'warning' | 'danger';

const history: HistoryReading[] = [];

let alarmActive = false;
let stopCommandPending = false;

const getElement = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const chartCanvas = getElement<HTMLCanvasElement>('sensor-chart');

const chart = chartCanvas
  ? new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: [] as string[],
        datasets: [
          {
            label: 'Temperatura °C',
            data: [] as number[],
            tension: 0.35,
            borderWidth: 3,
            pointRadius: 2,
            yAxisID: 'y'
          },
          {
            label: 'Iluminación %',
            data: [] as number[],
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
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          y: {
            min: 0,
            max: 45,
            title: {
              display: true,
              text: 'Temperatura °C'
            }
          },
          y1: {
            min: 0,
            max: 100,
            position: 'right',
            grid: {
              drawOnChartArea: false
            },
            title: {
              display: true,
              text: 'Iluminación %'
            }
          }
        }
      }
    })
  : null;

function formatTime(timestamp: number): string {
  if (!timestamp || Number.isNaN(timestamp)) {
    return '--:--';
  }

  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp);
}

function formatDateTime(timestamp: number): string {
  if (!timestamp || Number.isNaN(timestamp)) {
    return 'Sin datos';
  }

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
): void {
  const card = document.querySelector<HTMLElement>(
    `[data-sensor-card="${id}"]`
  );
  const valueElement = getElement<HTMLElement>(`value-${id}`);
  const unitElement = getElement<HTMLElement>(`unit-${id}`);
  const statusElement = getElement<HTMLElement>(`status-${id}`);
  const descriptionElement = getElement<HTMLElement>(
    `description-${id}`
  );

  if (
    !card ||
    !valueElement ||
    !unitElement ||
    !statusElement ||
    !descriptionElement
  ) {
    return;
  }

  card.classList.remove(
    'status-normal',
    'status-warning',
    'status-danger'
  );
  card.classList.add(`status-${severity}`);

  valueElement.textContent = value;
  unitElement.textContent = unit;
  descriptionElement.textContent = description;

  statusElement.textContent =
    severity === 'normal'
      ? 'Normal'
      : severity === 'warning'
        ? 'Advertencia'
        : 'Alerta';
}

function updateDashboard(reading: EnvironmentReading): void {
  alarmActive = reading.alarmaActiva;
  updateAlarmControlInterface();

  const tempSeverity = temperatureSeverity(reading.temperatura);
  const illuminationSeverity = lightSeverity(reading.iluminacion);

  const rainSeverity: Severity =
    reading.lluvia || reading.alarmaActiva
      ? 'danger'
      : 'normal';

  const wifiSeverity: Severity = reading.wifi
    ? 'normal'
    : 'danger';

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

  let rainValue = 'Sin lluvia';
  let rainDescription =
    'No se detecta presencia de lluvia y la alarma está apagada.';

  if (reading.lluvia && reading.alarmaActiva) {
    rainValue = 'Humedad detectada';
    rainDescription =
      'El sensor detecta humedad y el buzzer permanece activo.';
  } else if (!reading.lluvia && reading.alarmaActiva) {
    rainValue = 'Alarma activa';
    rainDescription =
      'El sensor ya está seco, pero el buzzer seguirá activo hasta apagar la alarma.';
  } else if (reading.lluvia && !reading.alarmaActiva) {
    rainValue = 'Humedad detectada';
    rainDescription =
      'La humedad continúa presente, pero la alarma fue reconocida y apagada.';
  }

  setCardState(
    'rain',
    rainValue,
    '',
    rainSeverity,
    rainDescription
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

  const severities: Severity[] = [
    tempSeverity,
    illuminationSeverity,
    rainSeverity,
    wifiSeverity
  ];

  const worstSeverity: Severity = severities.includes('danger')
    ? 'danger'
    : severities.includes('warning')
      ? 'warning'
      : 'normal';

  updateSystemSummary(worstSeverity);
  updateAlerts(reading, tempSeverity, illuminationSeverity);

  const lastUpdate = getElement<HTMLElement>('last-update');

  if (lastUpdate) {
    lastUpdate.textContent = formatDateTime(
      reading.actualizadoEn
    );
  }
}

function updateSystemSummary(severity: Severity): void {
  const summary = getElement<HTMLElement>('system-summary');
  const icon = getElement<HTMLElement>('system-icon');
  const status = getElement<HTMLElement>('system-status');

  if (!summary || !icon || !status) {
    return;
  }

  summary.classList.remove(
    'status-normal',
    'status-warning',
    'status-danger'
  );
  summary.classList.add(`status-${severity}`);

  if (severity === 'danger') {
    icon.textContent = '!';
    status.textContent = alarmActive
      ? 'Alarma sonora activa'
      : 'Alerta activa';
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
): void {
  const alertList = getElement<HTMLElement>('alert-list');
  const count = getElement<HTMLElement>('alert-count');

  if (!alertList || !count) {
    return;
  }

  const alerts: Array<{
    title: string;
    message: string;
    severity: Severity;
  }> = [];

  if (tempSeverity !== 'normal') {
    alerts.push({
      title:
        tempSeverity === 'danger'
          ? 'ALERTA: temperatura alta'
          : 'Advertencia de temperatura',
      message:
        `La lectura actual es de ` +
        `${reading.temperatura.toFixed(1)} °C.`,
      severity: tempSeverity
    });
  }

  if (lightSeverityValue !== 'normal') {
    alerts.push({
      title:
        lightSeverityValue === 'danger'
          ? 'Baja iluminación'
          : 'Iluminación disminuyendo',
      message:
        `Nivel actual: ` +
        `${Math.round(reading.iluminacion)} %.`,
      severity: lightSeverityValue
    });
  }

  if (reading.alarmaActiva) {
    alerts.push({
      title: 'Alarma sonora activa',
      message: reading.lluvia
        ? 'Se detectó humedad. El buzzer seguirá encendido hasta presionar “Apagar alarma”.'
        : 'La humedad ya no está presente, pero el buzzer continúa enclavado hasta reconocer la alarma.',
      severity: 'danger'
    });
  } else if (reading.lluvia) {
    alerts.push({
      title: 'Humedad detectada',
      message:
        'El sensor continúa mojado, pero la alarma sonora fue apagada.',
      severity: 'danger'
    });
  }

  if (!reading.wifi) {
    alerts.push({
      title: 'ESP32 sin conexión',
      message:
        'Revisar la red Wi-Fi y la alimentación del dispositivo.',
      severity: 'danger'
    });
  }

  count.textContent =
    `${alerts.length} ` +
    `${alerts.length === 1 ? 'activa' : 'activas'}`;

  if (alerts.length === 0) {
    alertList.innerHTML = `
      <div class="empty-state">
        <span aria-hidden="true">✓</span>
        <p>No hay alertas activas.</p>
      </div>
    `;
    return;
  }

  alertList.innerHTML = alerts
    .map(
      (alert) => `
        <div class="alert-item status-${alert.severity}">
          <span
            class="alert-item__icon"
            aria-hidden="true"
          >
            ${alert.severity === 'danger' ? '!' : '⚠'}
          </span>
          <div>
            <strong>${alert.title}</strong>
            <p>${alert.message}</p>
          </div>
        </div>
      `
    )
    .join('');
}

function renderHistoryChart(
  readings: HistoryReading[]
): void {
  const orderedReadings = [...readings]
    .filter(
      (item) =>
        Number.isFinite(item.temperatura) &&
        Number.isFinite(item.iluminacion) &&
        Number.isFinite(item.timestamp) &&
        item.timestamp > 0
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-12);

  history.splice(0, history.length, ...orderedReadings);

  if (!chart) {
    return;
  }

  chart.data.labels = history.map((item) =>
    formatTime(item.timestamp)
  );

  chart.data.datasets[0].data = history.map(
    (item) => item.temperatura
  );

  chart.data.datasets[1].data = history.map(
    (item) => item.iluminacion
  );

  chart.update();
}

function updateConnection(
  connected: boolean,
  label: string
): void {
  const dot = getElement<HTMLElement>('connection-dot');
  const connectionLabel =
    getElement<HTMLElement>('connection-label');

  if (!dot || !connectionLabel) {
    return;
  }

  dot.classList.toggle('offline', !connected);
  connectionLabel.textContent = label;
}

// =====================================================
// PREPARAR LA INTERFAZ PARA DEJAR SOLO "APAGAR ALARMA"
// No es necesario modificar index.astro.
// =====================================================
function prepareAlarmControlPanel(): void {
  const controlsPanel =
    document.querySelector<HTMLElement>('.controls-panel');

  if (!controlsPanel) {
    return;
  }

  const title =
    controlsPanel.querySelector<HTMLElement>('h2');
  const eyebrow =
    controlsPanel.querySelector<HTMLElement>('.eyebrow');
  const modeSwitch =
    controlsPanel.querySelector<HTMLElement>('.mode-switch');
  const note = getElement<HTMLElement>('controls-note');

  if (title) {
    title.textContent = 'Control de alarma sonora';
  }

  if (eyebrow) {
    eyebrow.textContent = 'Reconocimiento de alertas';
  }

  if (modeSwitch) {
    modeSwitch.style.display = 'none';
  }

  if (note) {
    note.textContent =
      'Cuando se detecta humedad, el buzzer permanece encendido aunque el sensor vuelva a estar seco. Solo se apaga con este botón.';
  }

  document
    .querySelectorAll<HTMLButtonElement>('[data-control]')
    .forEach((button) => {
      if (button.dataset.control !== 'alarma') {
        button.style.display = 'none';
        return;
      }

      button.classList.remove('active');
      button.setAttribute(
        'aria-label',
        'Apagar alarma sonora'
      );

      const icon = button.querySelector<HTMLElement>(
        'span[aria-hidden="true"]'
      );
      const strong =
        button.querySelector<HTMLElement>('strong');

      if (icon) {
        icon.textContent = '🔕';
      }

      if (strong) {
        strong.textContent = 'Apagar alarma';
      }
    });

  const currentMode = getElement<HTMLElement>('current-mode');

  if (currentMode) {
    currentMode.textContent = 'Alarma enclavada';

    const container = currentMode.parentElement;
    const label = container?.querySelector<HTMLElement>('span');

    if (label) {
      label.textContent = 'Funcionamiento';
    }
  }
}

function updateAlarmControlInterface(): void {
  const button =
    document.querySelector<HTMLButtonElement>(
      '[data-control="alarma"]'
    );

  if (!button) {
    return;
  }

  const small = button.querySelector<HTMLElement>('small');

  button.classList.toggle(
    'active',
    alarmActive && !stopCommandPending
  );

  button.disabled =
    !alarmActive || stopCommandPending;

  button.setAttribute(
    'aria-pressed',
    String(alarmActive)
  );

  if (!small) {
    return;
  }

  if (stopCommandPending) {
    small.textContent = 'Enviando orden…';
  } else if (alarmActive) {
    small.textContent = 'Alarma activa: presiona para apagar';
  } else {
    small.textContent = 'Sin alarma activa';
  }
}

async function sendStopAlarmCommand(): Promise<void> {
  if (!database || !alarmActive || stopCommandPending) {
    return;
  }

  stopCommandPending = true;
  updateAlarmControlInterface();

  try {
    await set(
      ref(database, 'estacion/control/apagarAlarma'),
      true
    );
  } catch (error) {
    stopCommandPending = false;
    updateAlarmControlInterface();

    console.error(
      'No fue posible enviar la orden para apagar la alarma:',
      error
    );
  }
}

function configureAlarmControl(): void {
  const button =
    document.querySelector<HTMLButtonElement>(
      '[data-control="alarma"]'
    );

  button?.addEventListener('click', () => {
    void sendStopAlarmCommand();
  });
}

function showFirebaseUnavailable(message: string): void {
  const source = getElement<HTMLElement>('data-source');
  const lastUpdate = getElement<HTMLElement>('last-update');

  if (source) {
    source.textContent = 'Firebase no disponible';
  }

  if (lastUpdate) {
    lastUpdate.textContent = 'Sin datos';
  }

  updateConnection(false, message);
  console.error(message);
}

function startFirebaseMode(): void {
  if (!database) {
    showFirebaseUnavailable(
      'No se pudo inicializar Firebase'
    );
    return;
  }

  const source = getElement<HTMLElement>('data-source');

  if (source) {
    source.textContent = 'Firebase Realtime Database';
  }

  updateConnection(true, 'Firebase conectado');

  onValue(
    ref(database, 'estacion/actual'),
    (snapshot) => {
      const value =
        snapshot.val() as
          | Partial<EnvironmentReading>
          | null;

      if (!value) {
        updateConnection(
          true,
          'Firebase conectado, sin datos'
        );
        return;
      }

      const reading: EnvironmentReading = {
        temperatura: Number(value.temperatura ?? 0),
        iluminacion: Number(value.iluminacion ?? 0),
        lluvia: Boolean(value.lluvia),
        alarmaActiva: Boolean(value.alarmaActiva),
        wifi: value.wifi !== false,
        estadoSistema: String(
          value.estadoSistema ?? 'normal'
        ),
        actualizadoEn: Number(
          value.actualizadoEn ?? Date.now()
        )
      };

      updateConnection(true, 'Firebase conectado');
      updateDashboard(reading);
    },
    (error) => {
      console.error(
        'Error al leer estacion/actual:',
        error
      );
      updateConnection(false, 'Error de conexión');
    }
  );

  const historyQuery = query(
    ref(database, 'estacion/historial'),
    orderByChild('timestamp'),
    limitToLast(12)
  );

  onValue(
    historyQuery,
    (snapshot) => {
      const readings: HistoryReading[] = [];

      snapshot.forEach((childSnapshot) => {
        const value = childSnapshot.val() as
          | Partial<HistoryReading>
          | null;

        if (!value) {
          return;
        }

        readings.push({
          temperatura: Number(value.temperatura ?? 0),
          iluminacion: Number(value.iluminacion ?? 0),
          lluvia: Boolean(value.lluvia),
          alarmaActiva: Boolean(value.alarmaActiva),
          timestamp: Number(value.timestamp ?? 0)
        });
      });

      renderHistoryChart(readings);
    },
    (error) => {
      console.error(
        'Error al leer estacion/historial:',
        error
      );
    }
  );

  onValue(
    ref(database, 'estacion/control/apagarAlarma'),
    (snapshot) => {
      stopCommandPending = snapshot.val() === true;
      updateAlarmControlInterface();
    },
    (error) => {
      console.error(
        'Error al leer el control de la alarma:',
        error
      );
    }
  );
}

prepareAlarmControlPanel();
configureAlarmControl();
updateAlarmControlInterface();

if (firebaseConfigured && database) {
  startFirebaseMode();
} else {
  showFirebaseUnavailable(
    'Firebase no está configurado'
  );
}
