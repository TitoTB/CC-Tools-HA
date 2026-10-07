# Changelog

## 1.0.22

- Evita que respuestas vacías oculten el error real de una descarga con `Cannot read properties of null`.
- Conserva y reprograma las descargas cuando Creality Cloud devuelve una página incompleta.
- Amplía los datos técnicos con la fase y la pila necesarias para diagnosticar futuros cambios de la web.

## 1.0.21

- Trata los timeouts de navegación y los estados HTTP 502, 503 y 504 como indisponibilidades temporales de Creality Cloud.
- Conserva los turnos pendientes y aplica reintentos progresivos sin generar alertas por cada tarea.
- Envía un único aviso al confirmar la incidencia y otro cuando las automatizaciones se recuperan.

## 1.0.20

- Reintenta la comprobación inicial de sesión cuando Creality Cloud tarda en responder.
- Evita registrar y notificar como descarga fallida una indisponibilidad puntual de la portada.
- Conserva el turno planificado y lo desplaza diez minutos cuando la comprobación no puede completarse.

## 1.0.19

- Trata los timeouts recuperables del planificador como reintentos aplazados y conserva su diagnóstico en Logs.
- Evita que esos bloqueos transitorios consuman una posición del plan diario de impresiones.
- Suprime las alertas de Telegram para timeouts que se reprograman automáticamente.

## 1.0.18

- Cierra automáticamente el recordatorio de reposición del check-in después de marcar que no vuelva a mostrarse durante el ciclo.
- Reintenta el descubrimiento de impresoras cuando el Banco de trabajo carga lentamente o desde caché.
- Evita que los registros de seguimiento y verificación consuman posiciones adicionales del plan diario de impresiones.
- Mantiene la plantilla actualizada de Telegram para pedidos disponibles.

## 1.0.17

- Comprueba la sesión de Creality Cloud antes de iniciar cada automatización y avisa cuando haya caducado.
- Finaliza las tareas bloqueadas tras ocho minutos, libera Chromium y reprograma el mismo turno automáticamente.
- Permite que el botón de inicio de sesión cancele una automatización que esté reteniendo el navegador.
- Registra en el log del contenedor el inicio, el final y la duración de cada tarea.

## 1.0.16

- Amplía el diagnóstico de compatibilidad entre impresoras y archivos G-code.
- Distingue la ausencia de boletos boost del rechazo real de un diseño.
- Cambia a blanco los puntos requeridos del objetivo al superar el 50% de progreso.

## 1.0.15

- Detecta todas las impresoras combinando las dos respuestas del Banco de trabajo.
- Mantiene separadas varias impresoras del mismo modelo mediante sus identificadores únicos.

## 1.0.14

- Reconoce los cupones canjeados como disponibles y abre la tienda con el descuento precargado.
- Mantiene los pedidos disponibles activos hasta que alcancen un estado realmente finalizado.
- Actualiza las plantillas de Telegram con iconos específicos y mensajes más concisos.
- Sustituye la notificación de pedido enviado por la de cupón disponible.

## 1.0.13

- Añade el panel Mis impresoras con conectividad, estado, progreso y detalle de errores en tiempo real.
- Permite pausar, reanudar y detener impresiones, además de liberar procesos bloqueados cuando sea necesario.
- Incorpora el envío manual desde cada impresora inactiva utilizando la galería completa de G-code.
- Distingue correctamente entre impresoras inactivas, desconectadas, imprimiendo y finalizadas sin arrastrar datos antiguos.
- Evita confundir contenido externo incrustado con una verificación de seguridad de Creality Cloud.
- Elimina el bloque manual duplicado Realizar impresión.

## 1.0.12

- Corrige las conversiones de puntos Spotlight en el historial sin mezclar el encabezado y los filtros de Creality Cloud.
- Repara automáticamente los nombres defectuosos que ya estuvieran guardados en el historial.
- Retira la herramienta experimental Completa tu colección y su configuración asociada.

## 1.0.11

- Mantiene actualizada la disponibilidad de boletos boost y mejora sus reintentos.
- Refuerza la verificación de recompensas de comentarios y descargas.
- Tolera navegaciones lentas de Creality Cloud sin duplicar errores de descarga.
- Añade el enlace al histórico de pedidos y expone el último pedido a la integración de Home Assistant.

## 1.0.10

- Evita que Home Assistant reutilice respuestas antiguas del estado y de los registros.
- Actualiza los registros cada diez segundos mientras el apartado Logs está visible.

## 1.0.9

- Añade la API local utilizada por la integración Creality Cloud para Home Assistant.
- Expone puntos, recompensas, tareas, pedidos, impresoras, controles y eventos de CC Tools.
- Actualiza inmediatamente los registros al abrir Logs y cada diez segundos mientras el apartado está visible.

## 1.0.8

- Activa automáticamente cada herramienta al guardar su programación.
- Evita publicar comentarios duplicados comprobando previamente el historial real del usuario en Creality Cloud.

## 1.0.7

- Refuerza la primera conexión de noVNC con precarga y reintentos automáticos del visor.
- Sincroniza el perfil, el historial completo de puntos y el seguimiento de pedidos después del primer inicio de sesión en Creality Cloud.

## 1.0.6

- Elimina la contraseña y el inicio de sesión internos del panel de CC Tools.
- Corrige la verificación del check-in y utiliza todos los boletos de lotería recibidos sin registrar falsos fallos.
- Añade el seguimiento diario de pedidos de la tienda de regalos al historial de puntos.
- Permite archivar pedidos enviados y notificarlos por Telegram cuando pasan de pendiente a enviado.

## 1.0.5

- Recupera automáticamente el perfil y el avatar de Creality Cloud después del inicio de sesión del asistente.
- Permite reintentar la consulta del perfil cuando el primer intento no obtiene datos.

## 1.0.4

- Permite iniciar el complemento sin repetir `initial_password` cuando ya existen credenciales guardadas.
- Muestra en rojo el aviso que solicita configurar la contraseña inicial.
- Reconecta automáticamente el visor noVNC si el primer intento queda esperando conexión.

## 1.0.3

- Posponemos la indexación inicial de perfiles favoritos hasta completar el asistente.
- Actualiza automáticamente Aguacatec y los demás favoritos al finalizar la configuración inicial.

## 1.0.2

- Evita que la carga automática del perfil ocupe el navegador durante el asistente inicial.
- Cierra el navegador interactivo al avanzar tras iniciar sesión para guardar la sesión y liberar las automatizaciones.

## 1.0.1

- Sustituye el error técnico de opción obligatoria por una indicación clara para configurar la contraseña antes de iniciar CC Tools.

## 1.0.0

- Primera versión pública instalable desde un repositorio de Home Assistant.
- Compatibilidad con `amd64` y `aarch64`.
- Configuración inicial protegida mediante una contraseña obligatoria.
- Automatizaciones, historial, notificaciones y herramientas de Creality Cloud administradas desde la interfaz web de CC Tools.
