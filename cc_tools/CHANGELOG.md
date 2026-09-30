# Changelog

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
