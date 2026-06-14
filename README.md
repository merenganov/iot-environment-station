# Estación Ambiental Inteligente

Plantilla en Astro para visualizar datos de temperatura, iluminación, lluvia, conexión Wi-Fi, alertas, gráficas y controles de actuadores.

## Requisitos

- Node.js 22.12.0 o superior
- npm

## Ejecutar localmente

```bash
npm install
npm run dev
```

Abre `http://localhost:4321`.

Sin archivo `.env`, la página inicia automáticamente en modo demostración y genera nuevas lecturas cada cuatro segundos.

## Conectar Firebase Realtime Database

1. Crea un proyecto en Firebase.
2. Agrega una aplicación web al proyecto.
3. Activa Realtime Database.
4. Copia `.env.example` como `.env`.
5. Pega la configuración de Firebase en las variables `PUBLIC_FIREBASE_*`.
6. Importa `database-example.json` para probar la estructura.
7. Reinicia `npm run dev`.

La lectura principal esperada está en:

```text
estacion/actual
```

Los controles están en:

```text
estacion/control
```

## Seguridad

`firebase-rules.readonly.json` permite lecturas públicas y bloquea todas las escrituras. Sirve para presentar el dashboard sin exponer controles. Para que el ESP32 y el modo manual escriban datos, se deben agregar autenticación y reglas específicas antes de publicar el proyecto.

## Compilar

```bash
npm run build
npm run preview
```

La carpeta generada para publicar es `dist/`.

## Publicar gratuitamente en Firebase Hosting

Instala Firebase CLI e inicia sesión:

```bash
npm install -g firebase-tools
firebase login
```

Después compila y publica:

```bash
npm run build
firebase use --add
firebase deploy --only hosting
```

`firebase.json` ya está configurado para publicar la carpeta `dist/`.
