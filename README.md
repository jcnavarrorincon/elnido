# El Nido 🪺

Gestor Personal — Dashboard privado para administrar modelos LLM, archivos y sistema desde un solo lugar.

## ¿Qué hace?

- Envía peticiones de prueba a cada modelo configurado
- Mide el tiempo de respuesta
- Muestra resultados con código de color: 🟢 OK / 🔴 Fail
- Las API keys se guardan **solo en el navegador** (localStorage), nunca en el servidor

## Proveedores soportados

| Proveedor | Tipo | Auth |
|-----------|------|------|
| Anthropic | `anthropic` | Header `x-api-key` |
| Google (Gemini) | `google` | Query param `?key=` |
| Ollama / OpenCode | `ollama` | Header `Authorization: Bearer` |

## Instalación rápida

```bash
# Clonar
git clone https://github.com/jcnavarrorincon/elnido.git
cd elnido

# Instalar
npm install

# Arrancar
node server.js
```

Abre `http://localhost:3344` en tu navegador.

## Servicio systemd

```bash
sudo cp elnido.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now model-health
```

Contenido de `elnido.service`:

```ini
[Unit]
Description=El Nido - Gestor Personal
After=network.target

[Service]
ExecStart=/usr/bin/node /home/USER/elnido/server.js
Restart=on-failure
RestartSec=5
User=USER
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
```

## Seguridad

- **No guarda credenciales** en el servidor — las API keys viven solo en localStorage
- **Acceso restringido** — recomendado usar VPN/Tailscale, no exponer públicamente
- **Timeout de 30s** por petición para evitar bloqueos

## Stack

- Backend: Express (1 dependencia)
- Frontend: Vanilla HTML/CSS/JS (sin framework)
- Puerto por defecto: 3344

## Licencia

MIT