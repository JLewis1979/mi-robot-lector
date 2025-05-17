// main.js - Instrucciones para nuestro robot
const Actor = require('apify');
const log = Actor.log;  // Para escribir mensajes que podamos ver

Actor.main(async () => {
    log.info('🤖 ¡Hola! Soy el robot de artículos, comenzando mi trabajo...');

    // 1. Recibir la dirección web de la lista de artículos
    const input = await Apify.getInput();
    const paginaDeListaDeArticulos = input.startUrl; // Esperamos que nos den una "startUrl"

    if (!paginaDeListaDeArticulos) {
        log.error('🆘 ¡Oh no! No me diste una "startUrl" para empezar. No puedo trabajar así.');
        return; // Terminar el trabajo
    }
    log.info(`🗺️ Voy a empezar mirando esta página: ${paginaDeListaDeArticulos}`);

    // 2. Preparar una "lista de tareas pendientes" para las páginas a visitar
    const colaDePaginas = await Apify.openRequestQueue();
    await colaDePaginas.addRequest({
        url: paginaDeListaDeArticulos,
        userData: { tipoDePagina: 'LISTA_DE_ARTICULOS' }, // Una etiqueta para saber qué hacer
    });

    // 3. Crear el "navegador robot" que visitará las páginas
    const navegadorRobot = new Apify.PuppeteerCrawler({
        requestQueue: colaDePaginas, // Usará nuestra lista de tareas
        launchContext: {
            args: ['--no-sandbox', '--disable-setuid-sandbox'], // Configuraciones técnicas para Apify
        },
        minConcurrency: 1, // Visitar 1 página a la vez (para empezar)
        maxConcurrency: 1, // Visitar 1 página a la vez (para empezar)
        maxRequestRetries: 1, // Si una página falla, intentarlo 1 vez más
        handlePageTimeoutSecs: 180, // Tiempo máximo para procesar una página (3 minutos)

        // 4. QUÉ HACER EN CADA PÁGINA QUE VISITE EL NAVEGADOR ROBOT
        handlePageFunction: async ({ request, page }) => {
            const urlActual = request.url;
            const tipoDePagina = request.userData.tipoDePagina;

            log.info(`📄 Estoy en [${tipoDePagina}]: ${urlActual}`);

            if (tipoDePagina === 'LISTA_DE_ARTICULOS') {
                // --- ESTAMOS EN LA PÁGINA QUE TIENE LA LISTA DE ARTÍCULOS ---
                log.info('   🧐 Es una lista. Voy a buscar los enlaces a cada artículo...');

                // ***** ¡¡¡NECESITAS CAMBIAR ESTO PARA TU SITIO WEB ESPECÍFICO (ej. shape.com)!!! *****
                // Instrucción para encontrar los enlaces. Esto es un EJEMPLO GENÉRICO.
                const SELECTOR_DE_ENLACES_A_ARTICULOS = 'a.card__title-link'; // EJEMPLO PARA INTENTAR CON SHAPE.COM

                log.info(`      Usando selector para enlaces de lista: "${SELECTOR_DE_ENLACES_A_ARTICULOS}"`);

                // El robot le pide al navegador que busque usando el selector
                const urlsDeArticulos = await page.evaluate((selector) => {
                    const enlacesEncontrados = [];
                    document.querySelectorAll(selector).forEach(elementoAncla => {
                        if (elementoAncla.href && !elementoAncla.href.startsWith('javascript:')) { // Ignorar enlaces javascript
                            enlacesEncontrados.push(elementoAncla.href);
                        }
                    });
                    return enlacesEncontrados;
                }, SELECTOR_DE_ENLACES_A_ARTICULOS);

                log.info(`   🔍 Encontré ${urlsDeArticulos.length} enlaces a artículos.`);
                if (urlsDeArticulos.length > 0) {
                    log.info(`      Algunos ejemplos (max 3): ${urlsDeArticulos.slice(0, 3).join(' | ')}`);
                } else {
                    log.warning('      ⚠️ ¡No encontré ningún enlace con ese selector! Revisa el SELECTOR_DE_ENLACES_A_ARTICULOS.');
                    // Guardar el HTML de esta página para ver por qué no encontró nada
                    const htmlDePaginaLista = await page.content();
                    await Apify.setValue('DEBUG_PAGINA_LISTA_HTML', htmlDePaginaLista, { contentType: 'text/html' });
                    log.info('      (Guardé el HTML de esta página de lista como "DEBUG_PAGINA_LISTA_HTML" para que lo revises en el Key-Value Store de Apify)');
                }

                // Añadir cada enlace de artículo a nuestra lista de tareas pendientes
                for (const urlArticulo of urlsDeArticulos) {
                    try {
                        const urlAbsolutaArticulo = new URL(urlArticulo, urlActual).href; // Convierte a URL absoluta
                        log.info(`      ➕ Añadiendo a la cola para visitar (artículo individual): ${urlAbsolutaArticulo}`);
                        await colaDePaginas.addRequest({
                            url: urlAbsolutaArticulo,
                            userData: { tipoDePagina: 'PAGINA_DE_ARTICULO' }, // Nueva etiqueta
                        });
                    } catch (e) {
                        log.error(`      ❌ Error al procesar o crear URL absoluta para "${urlArticulo}" (base: ${urlActual}): ${e.message}`);
                    }
                }

            } else if (tipoDePagina === 'PAGINA_DE_ARTICULO') {
                // --- ESTAMOS EN LA PÁGINA DE UN ARTÍCULO INDIVIDUAL ---
                log.info('   ✍️ Es la página de un artículo. Voy a extraer la información...');

                // ***** ¡¡¡NECESITAS CAMBIAR ESTOS PARA TU SITIO WEB ESPECÍFICO (ej. shape.com)!!! *****
                // Instrucciones para encontrar el título, contenido, etc. EJEMPLOS GENÉRICOS.
                const SELECTOR_TITULO = 'h1#article-heading_1-0';     // EJEMPLO PARA INTENTAR CON SHAPE.COM
                const SELECTOR_CONTENIDO = 'div#article-body_1-0';   // EJEMPLO PARA INTENTAR CON SHAPE.COM
                // const SELECTOR_FECHA = 'span.tu-clase-de-fecha';    // Opcional
                // const SELECTOR_AUTOR = 'a.tu-clase-de-autor';      // Opcional

                log.info(`      Usando selector de título: "${SELECTOR_TITULO}"`);
                log.info(`      Usando selector de contenido: "${SELECTOR_CONTENIDO}"`);

                // El robot le pide al navegador que busque esta información
                const datosExtraidos = await page.evaluate((selTitulo, selContenido /*, selFecha, selAutor*/) => {
                    const titulo = document.querySelector(selTitulo)?.innerText.trim();

                    let textoContenido = '';
                    const elementoContenido = document.querySelector(selContenido);
                    if (elementoContenido) {
                        // Intentar tomar solo el texto de párrafos y encabezados dentro del contenido
                        elementoContenido.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li').forEach(el => {
                            textoContenido += el.innerText.trim() + '\n\n'; // Doble salto de línea entre párrafos
                        });
                        if (!textoContenido && elementoContenido.innerText) { // Si no encontró párrafos, etc., tomar todo el texto del contenedor
                            textoContenido = elementoContenido.innerText.trim();
                        }
                    }

                    // const fecha = document.querySelector(selFecha)?.innerText.trim();
                    // const autor = document.querySelector(selAutor)?.innerText.trim();

                    return {
                        titulo: titulo,
                        contenido: textoContenido,
                        // fechaPublicacion: fecha,
                        // autor: autor
                    };
                }, SELECTOR_TITULO, SELECTOR_CONTENIDO /*, SELECTOR_FECHA, SELECTOR_AUTOR*/);

                log.info(`      Título encontrado: ${datosExtraidos.titulo}`);
                log.info(`      Contenido encontrado (primeros 100 caracteres): ${datosExtraidos.contenido?.substring(0, 100)}...`);

                // Guardar la información encontrada si tenemos al menos título o contenido
                if (datosExtraidos.titulo || datosExtraidos.contenido) {
                    await Apify.pushData({
                        urlDelArticulo: urlActual,
                        tituloDelArticulo: datosExtraidos.titulo,
                        textoDelArticulo: datosExtraidos.contenido?.trim(), // Quitar espacios extra al final del contenido completo
                        // fecha: datosExtraidos.fechaPublicacion,
                        // autor: datosExtraidos.autor,
                    });
                    log.info(`   💾 ¡Información guardada para: ${datosExtraidos.titulo || urlActual}!`);
                } else {
                    log.warning(`      ⚠️ No pude extraer título o contenido de esta página de artículo: ${urlActual}`);
                     // Guardar el HTML de esta página para ver por qué no encontró nada
                    const htmlDePaginaDetalle = await page.content();
                    // Crear una clave única para el archivo HTML de debug reemplazando caracteres no válidos
                    const debugKey = `DEBUG_PAGINA_DETALLE_HTML_${request.uniqueKey.replace(/[\/:\.]/g, '_')}`;
                    await Apify.setValue(debugKey, htmlDePaginaDetalle, { contentType: 'text/html' });
                    log.info(`      (Guardé el HTML de esta página de detalle como "${debugKey}" para que lo revises en el Key-Value Store de Apify)`);
                }
            }
        },

        // Qué hacer si una página da un error al cargarla
        handleFailedRequestFunction: async ({ request, error }) => {
            log.error(`❌ ¡Ups! Falló la visita a ${request.url} (Etiqueta: ${request.userData.tipoDePagina}): ${error.message}`);
        },
    });

    // 5. PONER AL NAVEGADOR ROBOT A TRABAJAR
    log.info('▶️  El navegador robot va a empezar a visitar las páginas...');
    await navegadorRobot.run();
    log.info('🏁 ¡Trabajo terminado por el navegador robot!');
});
