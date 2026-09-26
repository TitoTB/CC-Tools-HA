# CC Tools

CC Tools ejecuta automatizaciones de Creality Cloud desde Home Assistant.

## Configuración

Antes de iniciar el complemento debes configurar:

- `initial_password`: contraseña obligatoria para el primer acceso a la interfaz web.
- `timezone`: zona horaria utilizada para planificar las automatizaciones. El valor predeterminado es `Europe/Madrid`.

La contraseña inicial solo se aplica cuando CC Tools todavía no tiene una contraseña guardada. Después puedes cambiarla desde **Ajustes > Sesión**.

## Primer acceso

1. Guarda la configuración del complemento.
2. Inicia CC Tools.
3. Pulsa **Abrir interfaz web**.
4. Introduce la contraseña inicial.
5. Completa el asistente para iniciar sesión en Creality Cloud y, opcionalmente, configurar Telegram.

## Datos persistentes

La configuración, la sesión del navegador, el historial y las capturas se almacenan en `/data`. Home Assistant conserva estos datos durante las actualizaciones y los incluye en las copias de seguridad del complemento.

## Soporte

Puedes comunicar dudas, fallos y sugerencias en la [comunidad de Aguacatec en Telegram](https://t.me/aguacatec_es/13374).

## Aviso

CC Tools no es una aplicación oficial ni está afiliada con Creality o Creality Cloud. Utiliza la herramienta bajo tu responsabilidad y respeta siempre las normas establecidas por la plataforma.
