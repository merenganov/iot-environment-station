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

let controls: ControlState = {
  modo: 'automatico',
  led: false,
  buzzer: false,
  alarma: true
};

const history: HistoryReading[] = [];

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
  const tempSeverity = temperatureSeverity(reading.temperatura);
  const illuminationSeverity = lightSeverity(reading.iluminacion);
  const rainSeverity: Severity = reading.lluvia
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
    lastUpdate.textContent = formatDateTime(reading.actualizadoEn);
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

function addHistoryReading(reading: EnvironmentReading): void {
  const timestamp = reading.actualizadoEn || Date.now();
  const lastReading = history[history.length - 1];

  if (lastReading && lastReading.timestamp === timestamp) {
    return;
  }

  history.push({
    temperatura: reading.temperatura,
    iluminacion: reading.iluminacion,
    lluvia: reading.lluvia,
    timestamp
  });

  while (history.length > 12) {
    history.shift();
  }

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

function updateControlInterface(): void {
  const currentMode = getElement<HTMLElement>('current-mode');
  const note = getElement<HTMLElement>('controls-note');

  if (currentMode) {
    currentMode.textContent =
      controls.modo === 'automatico'
        ? 'Automático'
        : 'Manual';
  }

  if (note) {
    note.textContent =
      controls.modo === 'automatico'
        ? 'En modo automático, el ESP32 decide qué ' +
          'actuadores activar según las lecturas.'
        : 'En modo manual puedes activar o desactivar ' +
          'los actuadores desde este panel.';
  }

  document
    .querySelectorAll<HTMLButtonElement>('[data-mode]')
    .forEach((button) => {
      button.classList.toggle(
        'active',
        button.dataset.mode === controls.modo
      );
    });

  document
    .querySelectorAll<HTMLButtonElement>('[data-control]')
    .forEach((button) => {
      const controlName =
        button.dataset.control as keyof Omit<
          ControlState,
          'modo'
        >;

      const enabled = Boolean(controls[controlName]);

      button.classList.toggle('active', enabled);
      button.disabled = controls.modo !== 'manual';
      button.setAttribute(
        'aria-pressed',
        String(enabled)
      );

      const label = button.querySelector('small');

      if (label) {
        label.textContent =
          controlName === 'alarma'
            ? enabled
              ? 'Activadas'
              : 'Desactivadas'
            : enabled
              ? 'Encendido'
              : 'Apagado';
      }
    });
}

async function persistControl(
  path: string,
  value: boolean | string
): Promise<void> {
  if (!database) {
    return;
  }

  try {
    await set(
      ref(database, `estacion/control/${path}`),
      value
    );
  } catch (error) {
    console.error(
      'No fue posible actualizar el control en Firebase:',
      error
    );
  }
}

function configureControls(): void {
  document
    .querySelectorAll<HTMLButtonElement>('[data-mode]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode;

        if (
          mode !== 'automatico' &&
          mode !== 'manual'
        ) {
          return;
        }

        controls.modo = mode;
        updateControlInterface();
        void persistControl('modo', mode);
      });
    });

  document
    .querySelectorAll<HTMLButtonElement>('[data-control]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        if (controls.modo !== 'manual') {
          return;
        }

        const controlName =
          button.dataset.control as keyof Omit<
            ControlState,
            'modo'
          >;

        controls[controlName] =
          !controls[controlName];

        updateControlInterface();

        void persistControl(
          controlName,
          controls[controlName]
        );
      });
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
        wifi: value.wifi !== false,
        estadoSistema: String(
          value.estadoSistema ?? 'normal'
        ),
        actualizadoEn: Number(
          value.actualizadoEn ?? Date.now()
        )
      };

      console.log(
        'Lectura recibida desde Firebase:',
        reading
      );

      updateConnection(true, 'Firebase conectado');
      updateDashboard(reading);
      addHistoryReading(reading);
    },
    (error) => {
      console.error(
        'Error al leer estacion/actual:',
        error
      );
      updateConnection(false, 'Error de conexión');
    }
  );

  onValue(
    ref(database, 'estacion/control'),
    (snapshot) => {
      const value =
        snapshot.val() as
          | Partial<ControlState>
          | null;

      if (!value) {
        return;
      }

      controls = {
        modo:
          value.modo === 'manual'
            ? 'manual'
            : 'automatico',
        led: Boolean(value.led),
        buzzer: Boolean(value.buzzer),
        alarma: value.alarma !== false
      };

      updateControlInterface();
    },
    (error) => {
      console.error(
        'Error al leer estacion/control:',
        error
      );
    }
  );
}

configureControls();
updateControlInterface();

if (firebaseConfigured && database) {
  startFirebaseMode();
} else {
  showFirebaseUnavailable(
    'Firebase no está configurado'
  );
}
