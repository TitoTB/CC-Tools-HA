# CC Tools

CC Tools ejecuta automatizaciones de Creality Cloud desde Home Assistant.

## Configuración

Antes de iniciar el complemento puedes configurar:

- `timezone`: zona horaria utilizada para planificar las automatizaciones. El valor predeterminado es `Europe/Madrid`.

## Primer acceso

1. Guarda la configuración del complemento.
2. Inicia CC Tools.
3. Pulsa **Abrir interfaz web**.
4. Completa el asistente para iniciar sesión en Creality Cloud y, opcionalmente, configurar Telegram.

## Datos persistentes

La configuración, la sesión del navegador, el historial y las capturas se almacenan en `/data`. Home Assistant conserva estos datos durante las actualizaciones y los incluye en las copias de seguridad del complemento.

## Chromium y verificaciones de seguridad

El navegador de sesión se inicia como un proceso visible independiente y Playwright se conecta mediante CDP. Mantiene el perfil existente en `/data/browser-session/chromium`, incluidas sus cookies y almacenamiento local. No requiere cambiar ajustes ni volver a iniciar sesión si el perfil sigue siendo válido. La conexión de depuración usa un puerto temporal en loopback dentro del contenedor; no se publica en Home Assistant.

Se conserva la gestión de Cloudflare de 1.0.47: espera pasiva, aviso para abrir el navegador remoto y comprobación periódica de las tareas pausadas. El cambio de arranque se ha comprobado en Home Assistant en CC Tools Dev, pero no garantiza que Cloudflare acepte siempre la sesión. La casilla de verificación sigue siendo manual.

Al finalizar la tarea o cerrar el navegador remoto, se cierra también el proceso externo y se conserva el perfil para la siguiente apertura. Si no puede arrancar la pantalla virtual o Chromium, se informa del error sin cambiar automáticamente a un navegador sin pantalla. Las consultas paralelas aisladas mantienen su comportamiento anterior.

Cuando aparece el aviso inicial de cookies de Creality, CC Tools pulsa **Reject all / Rechazar todas**. El sitio rechaza las categorías opcionales y conserva las necesarias. La elección se guarda mediante el propio sitio en el perfil persistente: CC Tools no borra cookies ni escribe preferencias manualmente. Si ya existe una elección y el aviso no aparece, no se modifica; puede revisarse manualmente desde **Cookie Settings**. Solo se actúa sobre el aviso identificado de Creality, sin pulsar controles de Cloudflare ni abrir ajustes personalizados.

## Soporte

Puedes comunicar dudas, fallos y sugerencias en la [comunidad de Aguacatec en Telegram](https://t.me/aguacatec_es/13374).

## Aviso

CC Tools no es una aplicación oficial ni está afiliada con Creality o Creality Cloud. Utiliza la herramienta bajo tu responsabilidad y respeta siempre las normas establecidas por la plataforma.
