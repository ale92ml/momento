# Momento

Diario emocional para anotar **cómo te sientes en el momento**: eliges la palabra exacta, la intensidad, opcionalmente una foto, dónde estás y con quién, y qué te pasa por la cabeza. Con el tiempo, la pestaña *Patrones* muestra qué se repite, y desde *Ajustes* se genera un informe para llevar a consulta.

Es una **PWA** (web app instalable): HTML, CSS y JavaScript sin frameworks ni dependencias. Funciona en iPhone y Android desde el navegador, se añade a la pantalla de inicio y funciona sin conexión.

## Qué hace

- **Anotar en 20 segundos**: familia emocional → palabra concreta (o una tuya), intensidad 0–10 **de cada emoción por separado** (sirve para sentir alegría y tristeza a la vez con distinta fuerza), texto libre, contexto y hasta cuatro fotos (la primera es la portada). Una fila de palabras recientes permite anotar en dos toques. La más intensa cuenta como principal.
- **Diario** por días con miniaturas, buscador por palabra, nota o pensamiento y filtro por familia emocional. En el detalle se pasa a la anotación anterior o siguiente deslizando.
- **Patrones**: emociones más frecuentes, palabras, balance semanal de anotaciones agradables y desagradables, día a día, por día de la semana, por franja horaria, dónde y con quién. Cada gráfico tiene leyenda y vista en tabla.
- **Informe** para consulta: rango de fechas, eliges qué incluir (fotos, notas, pensamientos), se imprime a PDF o se comparte como archivo HTML.
- **Diseño**: portada con el cielo según la hora (amanecer, día, atardecer, noche) y saludo; el detalle de una anotación sin foto muestra ese mismo cielo, y con foto, la foto a ancho completo con botón para verla entera (pellizco para ampliar, deslizar entre fotos y compartir con la hoja nativa del móvil). Familias emocionales en baldosas que despliegan sus palabras debajo, intensidad en diez barras por emoción teñidas con su color, calendario mensual en Patrones y bienvenida de tres pantallas la primera vez. Tipografía de cabecera Fraunces (licencia libre), alojada en `fonts/`.
- **Colores personalizables** (Ajustes → Colores): el color de cada emoción y el color principal, por separado para tema claro y oscuro, con vista previa en vivo, cuatro paletas predefinidas y aviso automático si dos colores se parecen demasiado, contrastan poco o se confunden con daltonismo. El informe usa los colores elegidos.
- **Privacidad**: todo se guarda en el propio móvil (IndexedDB) cifrado con AES-GCM. Con PIN, la clave solo se desbloquea al abrir. Nada sale del dispositivo salvo lo que exportes.
- **Copia de seguridad**: exportar e importar un archivo JSON (incluye todas las fotos). Las copias de la versión 1 (una foto por anotación) se importan sin problema.

## Probarla en el ordenador

Necesita servirse por HTTP (no abrir el archivo directamente). Con Python:

```bash
python -m http.server 8765
```

Y abrir <http://localhost:8765>. En local el service worker no se registra (para no cachear mientras desarrollas); añade `?sw=1` a la URL si quieres probarlo.

## Publicarla para usarla en el móvil

La forma más sencilla y gratuita es **GitHub Pages**:

1. Crea un repositorio en GitHub (puede ser privado con plan de pago, o público) y sube todos los archivos de esta carpeta.
2. En el repositorio: *Settings → Pages → Build and deployment → Source: Deploy from a branch*, rama `main`, carpeta `/ (root)`. Guarda.
3. En un par de minutos tendrás una URL tipo `https://TU_USUARIO.github.io/NOMBRE_REPO/`.
4. Ábrela en el móvil y añádela a la pantalla de inicio:
   - **Android (Chrome)**: menú ⋮ → *Añadir a pantalla de inicio* o *Instalar aplicación*.
   - **iPhone (Safari)**: botón compartir → *Añadir a pantalla de inicio*.

Cualquier hosting estático con HTTPS sirve igual (Netlify, Cloudflare Pages, Vercel...).

### Publicar cambios

Cada vez que cambies algo, sube el nuevo `VERSION` en [sw.js](sw.js) (por ejemplo `momento-v2`). Así las apps instaladas descargan la versión nueva y avisan para recargar.

## Estructura

```
index.html            Estructura de la app (barra superior, vista, pestañas, pantalla de PIN)
css/app.css           Estilos, temas claro/oscuro, colores de familias emocionales
js/app.js             Interfaz: rutas, diario, editor, detalle, patrones, ajustes, informe
js/db.js              Almacenamiento cifrado (IndexedDB + WebCrypto), PIN
js/emotions.js        Vocabulario emocional, lugares, compañía, etiquetas de intensidad
js/stats.js           Cálculos para patrones e informe
js/charts.js          Barras apiladas, leyendas y tablas (compartido por patrones e informe)
js/colors.js          Colores personalizables, paletas y comprobación de legibilidad
js/sky.js             Cielo según la hora (portada y detalle sin foto)
js/report.js          Informe imprimible y compartible
js/photo.js           Reducción de fotos antes de guardarlas
js/format.js          Fechas y utilidades
sw.js                 Service worker (funciona sin conexión)
manifest.webmanifest  Manifiesto de la PWA
icons/                Iconos
fonts/                Fraunces (subconjunto latino, woff2)
```

## Cosas a tener en cuenta

- **Si olvidas el PIN no hay recuperación posible.** La clave de cifrado se guarda envuelta con el PIN; sin él, los datos son ilegibles. Exporta copias.
- Los datos viven en el navegador del móvil. Si borras los datos del navegador, se pierden. En iPhone, instalarla en la pantalla de inicio reduce el riesgo de que Safari los borre por inactividad.
- Las copias exportadas (JSON) y los informes (HTML) **no van cifrados**: son para compartir o guardar donde tú decidas.
- Los gráficos cuentan cada anotación una vez por su **emoción principal** (la más intensa; a igualdad, la elegida antes). La lista de emociones cuenta todas las mencionadas. Las anotaciones de versiones anteriores guardan una sola intensidad; al editarlas se reparte a cada emoción.
- La paleta por defecto y las paletas predefinidas están validadas para daltonismo en claro y oscuro; el orden de apilado de los gráficos (`STACK_ORDER` en [js/emotions.js](js/emotions.js)) forma parte de esa validación. Si personalizas colores a mano, la página de Colores avisa de los problemas pero no impide guardarlos.
