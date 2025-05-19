// main.js - Instrucciones para nuestro robot
const { Actor, PuppeteerCrawler } = require('apify');

Actor.main(async () => {
    Actor.log.info('🤖 ¡Hola! Soy el robot de artículos, comenzando mi trabajo...');

    // 1. Recibir la dirección web de la lista de artículos
    const input = await Actor.getInput();
    const paginaDeListaDeArticulos = input.startUrl;

    if (!paginaDeListaDeArticulos) {
        Actor.log.error('🆘 ¡Oh no! No me diste una "startUrl" para empezar. No puedo trabajar así.');
        await Actor.exit(1); // Terminar el trabajo con código de error
        return;
    }
    Actor.log.info(`🗺️ Voy a empezar mirando esta página: ${paginaDeListaDeArticulos}`);

    // 2. Preparar una "lista de tareas pendientes" para las páginas a visitar
    const colaDePaginas = await Actor.openRequestQueue();
    await colaDePaginas.addRequest({
        url: paginaDeListaDeArticulos,
        userData: { tipoDePagina: 'LISTA_DE_ARTICULOS' }, // Una etiqueta para saber qué hacer
    });

    // 3. Crear el "navegador robot" que visitará las páginas
    const navegadorRobot = new PuppeteerCrawler({
        requestQueue: colaDePaginas, // Usará nuestra lista de tareas
        launchContext: {
            launchOptions: { // Se recomienda usar launchOptions para argumentos
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
            useChrome: true, // Recomendado para Puppeteer en Apify
        },
        minConcurrency: 1, // Visitar 1 página a la vez (para empezar)
        maxConcurrency: 1, // Visitar 1 página a la vez (para empezar)
        maxRequestRetries: 1, // Si una página falla, intentarlo 1 vez más
        handlePageTimeoutSecs: 180, // Tiempo máximo para procesar una página (3 minutos)

        // 4. QUÉ HACER EN CADA PÁGINA QUE VISITE EL NAVEGADOR ROBOT
        // Usamos 'log' desestructurado aquí, que es el logger específico de la página
        handlePageFunction: async ({ request, page, log: pageLog }) => {
            const urlActual = request.url;
            const tipoDePagina = request.userData.tipoDePagina;

            pageLog.info(`📄 Estoy en [${tipoDePagina}]: ${urlActual}`);

            if (tipoDePagina === 'LISTA_DE_ARTICULOS') {
                // --- ESTAMOS EN LA PÁGINA QUE TIENE LA LISTA DE ARTÍCULOS ---
                pageLog.info('   🧐 Es una lista. Voy a buscar los enlaces a cada artículo...');

                // ***** ¡¡¡NECESITAS CAMBIAR ESTO PARA TU SITIO WEB ESPECÍFICO (ej. shape.com)!!! *****
                const SELECTOR_DE_ENLACES_A_ARTICULOS = 'a.card__title-link'; // EJEMPLO PARA INTENTAR CON SHAPE.COM

                pageLog.info(`      Usando selector para enlaces de lista: "${SELECTOR_DE_ENLACES_A_ARTICULOS}"`);

                const urlsDeArticulos = await page.evaluate((selector) => {
                    const enlacesEncontrados = [];
                    document.querySelectorAll(selector).forEach(elementoAncla => {
                        if (elementoAncla.href && !elementoAncla.href.startsWith('javascript:')) {
                            enlacesEncontrados.push(elementoAncla.href);
                        }
                    });
                    return enlacesEncontrados;
                }, SELECTOR_DE_ENLACES_A_ARTICULOS);

                pageLog.info(`   🔍 Encontré ${urlsDeArticulos.length} enlaces a artículos.`);
                if (urlsDeArticulos.length > 0) {
                    pageLog.info(`      Algunos ejemplos (max 3): ${urlsDeArticulos.slice(0, 3).join(' | ')}`);
                } else {
                    pageLog.warning('      ⚠️ ¡No encontré ningún enlace con ese selector! Revisa el SELECTOR_DE_ENLACES_A_ARTICULOS.');
                    const htmlDePaginaLista = await page.content();
                    await Actor.setValue('DEBUG_PAGINA_LISTA_HTML', htmlDePaginaLista, { contentType: 'text/html' });
                    pageLog.info('      (Guardé el HTML de esta página de lista como "DEBUG_PAGINA_LISTA_HTML" para que lo revises en el Key-Value Store de Apify)');
                }

                for (const urlArticulo of urlsDeArticulos) {
                    try {
                        const urlAbsolutaArticulo = new URL(urlArticulo, urlActual).href;
                        pageLog.info(`      ➕ Añadiendo a la cola para visitar (artículo individual): ${urlAbsolutaArticulo}`);
                        await colaDePaginas.addRequest({
                            url: urlAbsolutaArticulo,
                            userData: { tipoDePagina: 'PAGINA_DE_ARTICULO' },
                        });
                    } catch (e) {
                        pageLog.error(`      ❌ Error al procesar o crear URL absoluta para "${urlArticulo}" (base: ${urlActual}): ${e.message}`);
                    }
                }

            } else if (tipoDePagina === 'PAGINA_DE_ARTICULO') {
                // --- ESTAMOS EN LA PÁGINA DE UN ARTÍCULO INDIVIDUAL ---
                pageLog.info('   ✍️ Es la página de un artículo. Voy a extraer la información...');

                // ***** ¡¡¡NECESITAS CAMBIAR ESTOS PARA TU SITIO WEB ESPECÍFICO (ej. shape.com)!!! *****
                const SELECTOR_TITULO = 'h1#article-heading_1-0';
                const SELECTOR_CONTENIDO = 'div#article-body_1-0';
                // const SELECTOR_FECHA = 'span.tu-clase-de-fecha';
                // const SELECTOR_AUTOR = 'a.tu-clase-de-autor';

                pageLog.info(`      Usando selector de título: "${SELECTOR_TITULO}"`);
                pageLog.info(`      Usando selector de contenido: "${SELECTOR_CONTENIDO}"`);

                const datosExtraidos = await page.evaluate((selTitulo, selContenido) => {
                    const titulo = document.querySelector(selTitulo)?.innerText.trim();
                    let textoContenido = '';
                    const elementoContenido = document.querySelector(selContenido);
                    if (elementoContenido) {
                        elementoContenido.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li').forEach(el => {
                            textoContenido += el.innerText.trim() + '\n\n';
                        });
                        if (!textoContenido && elementoContenido.innerText) {
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
                }, SELECTOR_TITULO, SELECTOR_CONTENIDO);

                pageLog.info(`      Título encontrado: ${datosExtraidos.titulo}`);
                pageLog.info(`      Contenido encontrado (primeros 100 caracteres): ${datosExtraidos.contenido?.substring(0, 100)}...`);

                if (datosExtraidos.titulo || datosExtraidos.contenido) {
                    await Actor.pushData({
                        urlDelArticulo: urlActual,
                        tituloDelArticulo: datosExtraidos.titulo,
                        textoDelArticulo: datosExtraidos.contenido?.trim(),
                        // fecha: datosExtraidos.fechaPublicacion,
                        // autor: datosExtraidos.autor,
                    });
                    pageLog.info(`   💾 ¡Información guardada para: ${datosExtraidos.titulo || urlActual}!`);
                } else {
                    pageLog.warning(`      ⚠️ No pude extraer título o contenido de esta página de artículo: ${urlActual}`);
                    const htmlDePaginaDetalle = await page.content();
                    const debugKey = `DEBUG_PAGINA_DETALLE_HTML_${request.uniqueKey.replace(/[\/:\.]/g, '_')}`;
                    await Actor.setValue(debugKey, htmlDePaginaDetalle, { contentType: 'text/html' });
                    pageLog.info(`      (Guardé el HTML de esta página de detalle como "${debugKey}" para que lo revises en el Key-Value Store de Apify)`);
                }
            }
        },

        // Qué hacer si una página da un error al cargarla
        // Usamos 'log' desestructurado aquí también
        handleFailedRequestFunction: async ({ request, error, log: pageLog }) => {
            pageLog.error(`❌ ¡Ups! Falló la visita a ${request.url} (Etiqueta: ${request.userData.tipoDePagina}): ${error.message}`);
        },
    });

    // 5. PONER AL NAVEGADOR ROBOT A TRABAJAR
    Actor.log.info('▶️  El navegador robot va a empezar a visitar las páginas...');
    await navegadorRobot.run();
    Actor.log.info('🏁 ¡Trabajo terminado por el navegador robot!');
});
