# Panel de administración · Inspecciones Ferronol

Web privada (un solo usuario) con el estado de la automatización, los tres manuales editables desde el navegador
(con historial de versiones) y accesos directos. Node.js sin dependencias.

## Variables de entorno (en EasyPanel → servicio → Entorno)

| Variable | Obligatoria | Qué es |
|---|---|---|
| `ADMIN_USER` | Sí | Usuario de acceso |
| `ADMIN_PASSWORD` | Sí | Contraseña de acceso (larga) |
| `SESSION_SECRET` | Sí | Cadena aleatoria de 32+ caracteres para firmar la sesión |
| `N8N_URL`, `N8N_API_KEY` | No | Para mostrar el estado de los workflows |
| `EVOLUTION_URL`, `EVOLUTION_APIKEY`, `EVOLUTION_INSTANCE` | No | Para mostrar si la línea de WhatsApp está conectada (instancia por defecto: `optimizador`) |
| `WORKFLOW_PREFIX` | No | Prefijo de los workflows a vigilar (por defecto `Inspecciones`) |

## Volumen

Montar un volumen en `/data`: ahí se guardan las guías editadas, sus versiones y los accesos directos.
Sin volumen, los cambios se pierden al redesplegar. La primera vez se rellena con el contenido de `seed/`.

## Local

```bash
ADMIN_USER=admin ADMIN_PASSWORD=prueba SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") COOKIE_SECURE=false node server.js
```
