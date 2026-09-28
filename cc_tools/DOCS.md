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

## Añadir a la colección

La herramienta guarda un diseño pendiente en Default Collections y verifica el punto diario de Collection Models. Si la recompensa ya está completada o el modelo ya está guardado, omite la acción. La programación requiere que Descubrir diseños esté activado.

La API local expone esta herramienta como `collections` en `/api/integration/state` y en los eventos de `/api/integration/events`. Permite activar o desactivar su programación con `PATCH /api/integration/tasks/collections` (`{"enabled": true}` o `false`) y ejecutarla con `POST /api/integration/tasks/collections/run`. Al desactivar Descubrir diseños se desactiva también la programación de colecciones.

La creación de entidades y controles en Home Assistant depende de que la integración cliente admita esta tarea; este complemento proporciona su API.

## Datos persistentes

La configuración, la sesión del navegador, el historial y las capturas se almacenan en `/data`. Home Assistant conserva estos datos durante las actualizaciones y los incluye en las copias de seguridad del complemento.

## Soporte

Puedes comunicar dudas, fallos y sugerencias en la [comunidad de Aguacatec en Telegram](https://t.me/aguacatec_es/13374).

## Aviso

CC Tools no es una aplicación oficial ni está afiliada con Creality o Creality Cloud. Utiliza la herramienta bajo tu responsabilidad y respeta siempre las normas establecidas por la plataforma.
