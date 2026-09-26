# CC Tools para Home Assistant

CC Tools permite automatizar distintas tareas de Creality Cloud desde Home Assistant y administrar su ejecución desde una interfaz web propia.

## Compatibilidad

- Home Assistant OS o una instalación con Supervisor.
- Arquitecturas `amd64` y `aarch64`.
- Una cuenta de Creality Cloud.

## Instalación

1. Abre Home Assistant y entra en **Configuración > Aplicaciones > Tienda de aplicaciones**.
2. Abre el menú de los tres puntos de la esquina superior derecha y selecciona **Repositorios**.
3. Añade esta URL:

   ```text
   https://github.com/TitoTB/CC-Tools-HA
   ```

4. Cierra el diálogo de repositorios y busca **CC Tools** en la tienda.
5. Abre su ficha y pulsa **Instalar**. La primera compilación puede tardar varios minutos.
6. En la pestaña **Configuración**, establece una contraseña inicial y revisa la zona horaria.
7. Inicia el complemento y pulsa **Abrir interfaz web**.
8. Accede con la contraseña configurada y completa el asistente inicial.

## Actualizaciones

Home Assistant comprobará las versiones publicadas en este repositorio. Cuando haya una nueva versión disponible, aparecerá el botón **Actualizar** en la ficha de CC Tools.

La configuración, la sesión del navegador y el historial se guardan en `/data` y se conservan durante las actualizaciones y copias de seguridad del complemento.

## Soporte

Para resolver dudas, comunicar fallos o proponer mejoras, visita la [comunidad de Aguacatec en Telegram](https://t.me/aguacatec_es/13374).

## Disclaimer

**CC Tools no es una aplicación oficial** y no está de ninguna manera afiliada con Creality o Creality Cloud. Se trata de una iniciativa desarrollada por la [comunidad de Aguacatec](https://t.me/aguacatec_es/13374), con el objetivo de mejorar la experiencia de la impresión 3D e integrarla en nuestro sistema domótico de automatización.

El objetivo no es, en ningún caso, violar o evadir las reglas de Creality Cloud. **Utiliza la herramienta bajo tu responsabilidad**, cumpliendo siempre las normas establecidas por la plataforma.

Si quieres reportar algún fallo o hacer alguna sugerencia, puedes unirte a [nuestra comunidad de Telegram](https://t.me/aguacatec_es/13374).

## Licencia

Este proyecto se distribuye bajo la [licencia MIT](LICENSE).
