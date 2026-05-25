# Guía de Nuevas Funcionalidades y Túneles de Conexión (mcp-say-hello)

Este documento detalla todas las mejoras añadidas recientemente a **mcp-say-hello**, incluyendo las nuevas herramientas de desarrollo, la monitorización del servidor y las opciones de conexión con el exterior (Cloudflare Tunnel y ngrok).

---

## 1. Nuevas Herramientas de MCP (18 en total)

Se han incorporado herramientas potentes para que el chatbot de IA pueda interactuar de manera más profunda, ágil y estable con el espacio de trabajo local (`WORKSPACE_ROOT`).

### A. Herramientas de Git Seguras (Lectura - Sin riesgo)
Estas herramientas están siempre disponibles y permiten al asistente inspeccionar el repositorio sin realizar modificaciones:
* **`git_log`**: Permite ver el historial de commits (soporta formatos resumidos o detallados).
* **`git_show`**: Muestra los cambios detallados de un commit o una referencia específica.
* **`git_remote`**: Lista los repositorios remotos configurados (`git remote -v`).
* **`git_branch`**: Lista las ramas locales y remotas del repositorio.

### B. Herramientas de Git Peligrosas (Requiere `ENABLE_DANGEROUS_TOOLS=true`)
Permiten realizar modificaciones en el control de versiones:
* **`git_checkout`**: Permite crear nuevas ramas o cambiar a ramas existentes.
* **`git_restore`**: Descarta cambios locales en archivos de trabajo o remueve archivos del área de preparación (unstage).

### C. Gestión de Archivos (Requiere `ENABLE_DANGEROUS_TOOLS=true`)
Acciones avanzadas sobre el sistema de archivos (respetando los límites de exclusión de seguridad como `.env`, `.npmrc`, etc.):
* **`create_directory`**: Crea carpetas y subcarpetas recursivamente (`mkdir -p`).
* **`move_file`**: Mueve o renombra archivos dentro del workspace.
* **`delete_directory`**: Elimina carpetas de forma recursiva y destructiva.

### D. Analizador de Proyectos (Requiere `ENABLE_DANGEROUS_TOOLS=true`)
* **`analyze_project`**: Realiza un escaneo inteligente del directorio para identificar la estructura general, gestor de paquetes en uso, scripts de `package.json`, dependencias, puntos de entrada y los archivos más pesados en bytes.

### E. Administrador de Servidores de Desarrollo (HTTP, Requiere `ENABLE_DANGEROUS_TOOLS=true`)
Permite lanzar y monitorear servidores de desarrollo (como Vite, Next.js, tsx, etc.) en segundo plano, sobreviviendo a las desconexiones del MCP:
* **`start_dev_server`**: Inicia un script npm en background (ej. `pnpm dev`) en un puerto específico.
* **`stop_dev_server`**: Detiene un servidor de desarrollo en background previamente iniciado.
* **`get_dev_server_status`**: Consulta si el servidor de desarrollo sigue ejecutándose, su puerto y su tiempo activo (uptime).
* **`get_dev_server_logs`**: Captura y lee las últimas líneas impresas en la consola (`stdout`/`stderr`) por el servidor de desarrollo.

---

## 2. Endpoint de Salud (`GET /health`)

El servidor HTTP del MCP ahora expone un punto de verificación rápida en `http://127.0.0.1:3000/health`.
Al consultarlo mediante una petición HTTP GET normal, devuelve un JSON con información vital de diagnóstico:

```json
{
  "status": "ok",
  "serverName": "mcp-say-hello",
  "version": "0.1.0",
  "brand": "GVSLabs",
  "homepage": "https://gvslabs.cloud/",
  "uptime": 234,
  "workspaceRoot": "C:\\develoment\\mcp",
  "dangerousToolsEnabled": true,
  "managedProcesses": {}
}
```

Es ideal para validar que el servidor local está activo sin necesidad de iniciar una sesión completa del protocolo MCP.

---

## 3. Conexión del Equipo Local con el Exterior (Túneles)

Para conectar tu servidor local con un chatbot o cliente externo en la nube, se proveen dos integraciones automatizadas: **Cloudflare Tunnel** (Recomendado) y **ngrok**.

### A. Cloudflare Tunnel (TryCloudflare)
Usa la red global de Cloudflare para exponer el puerto local de manera anónima y gratuita.

* **Cómo correrlo:**
  ```bash
  pnpm run start:cloudflared
  # O si no requieres reconstruir el proyecto con build:
  pnpm run start:test-cf
  ```
* **¿Qué son las URLs temporales?**
  Al iniciar el túnel, Cloudflare genera un subdominio aleatorio temporal terminado en `.trycloudflare.com` (ejemplo: `https://learn-jim-consists-medicaid.trycloudflare.com`). Es de un solo uso.
* **¿Cuánto tiempo dura?**
  **No tiene límite de tiempo** mientras el proceso de tu consola permanezca abierto y conectado a Internet. Sin embargo, en cuanto detengas el comando (`Ctrl+C`), apagues el equipo o pierdas la red por un lapso largo, el subdominio **expira inmediatamente** y no podrá volver a usarse. Al encenderlo de nuevo obtendrás una URL aleatoria distinta.
* **Ventajas:**
  * Totalmente gratuito y sin límites de velocidad o número de llamadas.
  * No requiere crear cuentas, ni configurar tokens en archivos `.env`.

### B. ngrok
Usa el servicio tradicional de ngrok para exponer el puerto.

* **Cómo correrlo:**
  ```bash
  pnpm run start:ngrok
  ```
* **Características:**
  * Requiere configurar el token de autenticación en la variable `NGROK_AUTHTOKEN` de tu archivo `.env`.
  * La cuenta gratuita posee límites estrictos de peticiones por minuto (Rate Limiting). Si el chatbot hace demasiadas preguntas rápidas, ngrok bloqueará la conexión temporalmente.

---

## 4. Cómo configurar una URL Fija (Permanente) en Cloudflare

Si deseas que la URL del túnel sea siempre la misma para no tener que configurar tu cliente externo cada vez que arranques el MCP:

1. **Crear cuenta:** Regístrate de forma gratuita en [Cloudflare](https://dash.cloudflare.com/).
2. **Dominio:** Debes tener o añadir un dominio propio bajo la administración de Cloudflare.
3. **Crear Túnel:**
   * Ve a la sección **Zero Trust** -> **Networks** -> **Tunnels**.
   * Crea un túnel con nombre (ej. `mi-mcp-local`).
   * Copia el token de instalación provisto por Cloudflare.
4. **Instalar localmente:**
   * Configura el servicio de Cloudflare localmente usando su comando:
     ```bash
     cloudflared service install <TOKEN_PROVISTO>
     ```
5. **Configurar la ruta:**
   * Asocia una regla de host público en el túnel de Cloudflare para que apunte un subdominio tuyo (ej. `mcp.midominio.com`) al upstream local `http://localhost:3000`.
6. **Iniciar:**
   Una vez configurado como servicio o túnel fijo en Cloudflare, podrás acceder al MCP de manera persistente usando `https://mcp.midominio.com/mcp` cada vez que enciendas tu servidor local.
