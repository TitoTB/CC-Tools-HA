# Changelog

## 1.0.40

- Evita contabilizar dos veces un mismo movimiento cuando Creality Cloud repite la operación con texto adicional de la página.
- Deduplica correctamente check-ins, descargas, impresiones, comentarios y me gusta por su identidad normalizada.
- Mantiene separadas las recompensas legítimas `Consecutive Check-in` y `Member Double Check-in` aunque compartan fecha, hora e importe.
- Limpia automáticamente los duplicados históricos almacenados durante la siguiente actualización de puntos.

## 1.0.39

- Corrige la regresión de la versión 1.0.38 que podía bloquear todas las tareas si el Banco de trabajo no solicitaba automáticamente el perfil del usuario.
- Permite continuar una tarea cuando la comprobación de sesión es inconclusa, sin marcar por ello la sesión como restablecida.
- Mantiene la detección explícita de sesiones cerradas, tokens inválidos y verificaciones de seguridad.
- Evita clasificar por sí sola una comprobación de sesión inconclusa como una caída general de Creality Cloud.
- Aplaza las tareas programadas mientras el navegador remoto está abierto, en lugar de cerrar la sesión interactiva del usuario.

## 1.0.38

- Solo reanuda las automatizaciones cuando Creality Cloud confirma positivamente el perfil autenticado.
- Mantiene las tareas pausadas cuando la comprobación de sesión no devuelve una respuesta concluyente.
- Detecta el acceso cerrado aunque el primer control de inicio de sesión encontrado esté oculto.
- Evita que el check-in muestre un estado desconocido cuando realmente se ha cerrado la sesión.

## 1.0.37

- Limita a diez el número máximo de diseños que se pueden descubrir cada día.
- Aplica el mismo límite en la interfaz, la planificación, la ejecución y la validación del servidor.
- Ajusta automáticamente a diez las configuraciones anteriores que tuvieran un valor superior.

## 1.0.36

- Reconoce el botón "Impulsar de nuevo" de Creality Cloud en diseños que ya habían recibido un boost.
- Evita descartar modelos válidos y devolver `BOOST_TARGET_NOT_FOUND` cuando todavía quedan boosts disponibles.

## 1.0.35

- Mantiene el límite de un boost diario únicamente para las ejecuciones programadas.
- Permite aplicar manualmente varios boosts el mismo día mientras queden boletos disponibles.
- Comprueba el límite automático antes de abrir Chromium y evita búsquedas innecesarias de modelos.
- Limita cada búsqueda a tres candidatos rotativos y registra los modelos revisados y sus rechazos cuando no se puede aplicar el boost.

## 1.0.34

- Sustituye el enlace "Ver histórico" del seguimiento de pedidos por un botón con icono.
- Añade un botón para consultar manualmente los pedidos sin esperar a la actualización automática de 24 horas.
- Muestra el estado de la consulta manual y conserva los pedidos conocidos cuando Creality Cloud no responde.

## 1.0.33

- Unifica el valor "Puntos obtenidos hoy" de Home Assistant con el badge de CC Tools.
- Suma únicamente los movimientos positivos del día y evita que los gastos reduzcan los puntos obtenidos.

## 1.0.32

- Añade la opción "Inicio de sesión automático" en Ajustes > Sesión > Creality Cloud.
- Recupera una sesión cerrada usando exclusivamente los datos que ya recuerda el perfil persistente del navegador.
- Mantiene las automatizaciones pausadas cuando Creality Cloud exige completar el acceso manualmente.
- Limita los intentos automáticos fallidos a uno cada 30 minutos para evitar bucles.
- Mueve el indicador LED de sesión un píxel hacia arriba y hacia la derecha.

## 1.0.31

- Comprueba y sincroniza la sesión de Creality Cloud antes de ejecutar cada tarea.
- Detecta automáticamente una sesión restablecida y reanuda las automatizaciones sin exigir cerrar manualmente el navegador.
- Ajusta la posición del indicador LED para integrarlo mejor sobre el avatar.
- Aclara la opción de notificación cuando un cupón pasa a estar disponible.

## 1.0.30

- Mejora el indicador de sesión del avatar con un efecto luminoso de tipo LED.
- Sitúa el indicador sobre el contenedor del avatar para evitar que el borde o el resplandor queden recortados.

## 1.0.29

- Muestra sobre el avatar un indicador verde o rojo según el último estado confirmado de la sesión de Creality Cloud.
- Reconoce la redirección al centro de cuentas de Creality como una sesión cerrada.
- Evita que los diagnósticos secundarios de descarga oculten una pérdida de sesión.
- Expone el estado de sesión a la integración de Home Assistant.

## 1.0.28

- Detecta con mayor fiabilidad una sesión de Creality Cloud caducada y pausa las automatizaciones hasta completar un nuevo inicio de sesión.
- Envía un único aviso de sesión cerrada y reanuda la actividad después de confirmar el acceso.
- Refuerza el canje programado validando región, producto, precio, cantidad y número de pedido antes de registrar el éxito.
- Evita repetir automáticamente un canje cuyo resultado no se pueda confirmar.
- Actualiza los avatares de los perfiles favoritos e impide añadir perfiles sin diseños publicados.
- Añade paginación y descarga de registros, y clasifica la última ejecución como puntual, retrasada o fallida.
- Amplía el diagnóstico del navegador, del planificador y del estado de las impresoras.

## 1.0.27

- Expone a Home Assistant la planificación pendiente y su revisión estable.
- Añade el estado detallado de la ejecución activa y la detección `stale` del planificador.
- Proporciona la información necesaria para el reinicio automático seguro de la integración.

## 1.0.26

- Limita los comentarios a diseños cuya descarga haya sido verificada.
- Excluye modelos meramente indexados desde favoritos o descubiertos en el catálogo.
- Omite la tarea sin publicar comentarios cuando no quedan descargas válidas.

## 1.0.25

- Evita que una tarea correcta sin incidencia se interprete como un error vacío.
- Impide las pausas falsas de 60 minutos por una supuesta caída de Creality Cloud.
- Mantiene la detección de errores vacíos reales cuando se reciben de forma explícita.

## 1.0.24

- Registra en Logs el motivo técnico de cada pausa temporal por indisponibilidad de Creality Cloud.
- Incluye código original, URL, HTTP, fallos consecutivos y fecha del próximo intento.
- Evita que estos registros técnicos consuman posiciones de la planificación diaria.

## 1.0.23

- Impide que la consulta auxiliar de boosts deje bloqueado el planificador indefinidamente.
- Aplica watchdog a las consultas de boosts, pedidos y canjes.
- Detecta y libera automáticamente ejecuciones antiguas cuyo tiempo máximo ya ha vencido.

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
