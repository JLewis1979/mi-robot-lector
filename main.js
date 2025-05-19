// main.js - Instrucciones para nuestro robot
const Apify = require('apify'); // Importar el módulo Apify completo

// Usar Apify.Actor.main en lugar de Actor.main
Apify.Actor.main(async () => {
    // Usar Apify.Actor.log en lugar de Actor.log
    Apify.Actor.log.info('🤖 ¡Hola! Soy el robot de artículos, comenzando mi trabajo...');

    // 1. Recibir la dirección web de la lista de artículos
    const input = await Apify.Actor.getInput(); // Usar Apify.Actor.getInput
    const paginaDeListaDeArticulos = input.startUrl;

    if (!paginaDeListaDeArticulos) {
        Apify.Actor.log.error('🆘 ¡Oh no! No me diste una "startUrl" para empezar. No puedo trabajar así.');
        await Apify.Actor.exit(1);
        return;
    }
    Apify.Actor.log.info(`🗺️ Voy a empezar mirando esta página: ${paginaDeListaDeArticulos}`);

    // 2. Preparar una "lista de tareas pendientes" para las páginas a visitar
    const colaDePaginas = await Apify.Actor.openRequestQueue(); // Usar Apify.Actor.openRequestQueue
    await colaDePaginas.addRequest({
        url: paginaDeListaDeArticulos,
        userData: { tipoDePaginA: 'LISTA_DE_ARTICULOS' },
    });

    // 3. Crear el "navegador robot" que visitará las páginas
    // PuppeteerCrawler es una propiedad de Apify, no de Apify.Actor
    const navegadorRobot = new Apify.PuppeteerCrawler({ // Usar Apify.PuppeteerCrawler
        requestQueue: colaDePaginas,
        launchContext: {
            launchOptions: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
            useChrome: true,
        },
        minConcurrency: 1,
        maxConcurrency: 1,
        maxRequestRetries: 1,
        handlePageTimeoutSecs: 180,

        handlePageFunction: async ({ request, page, log: pageLog }) => {
            const urlActual = request.url;
            const tipoDePagina = request.userData.tipoDePagina; // Corregido: era tipoDePaginA

            pageLog.info(`📄 Estoy en [${tipoDePagina}]: ${urlActual}`);

            if (tipoDePagina === 'LISTA_DE_ARTICULOS') {
                pageLog.info('   🧐 Es una lista. Voy a buscar los enlaces a cada artículo...');
                const SELECTOR_DE_ENLACES_A_ARTICULOS = 'a.card__title-link';
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
                    await Apify.Actor.setValue('DEBUG_PAGINA_LISTA_HTML', htmlDePaginaLista, { contentType: 'text/html' }); // Usar Apify.Actor.setValue
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
                pageLog.info('   ✍️ Es la página de un artículo. Voy a extraer la información...');
                const SELECTOR_TITULO = 'h1#article-heading_1-0';
                const SELECTOR_CONTENIDO = 'div#article-body_1-0';
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
                    return { titulo, contenido };
                }, SELECTOR_TITULO, SELECTOR_CONTENIDO);

                pageLog.info(`      Título encontrado: ${datosExtraidos.titulo}`);
                pageLog.info(`      Contenido encontrado (primeros 100 caracteres): ${datosExtraidos.contenido?.substring(0, 100)}...`);

                if (datosExtraidos.titulo || datosExtraidos.contenido) {
                    await Apify.Actor.pushData({ // Usar Apify.Actor.pushData
                        urlDelArticulo: urlActual,
                        tituloDelArticulo: datosExtraidos.titulo,
                        textoDelArticulo: datosExtraidos.contenido?.trim(),
                    });
                    pageLog.info(`   💾 ¡Información guardada para: ${datosExtraidos.titulo || urlActual}!`);
                } else {
                    pageLog.warning(`      ⚠️ No pude extraer título o contenido de esta página de artículo: ${urlActual}`);
                    const htmlDePaginaDetalle = await page.content();
                    const debugKey = `DEBUG_PAGINA_DETALLE_HTML_${request.uniqueKey.replace(/[\/:\.]/g, '_')}`;
                    await Apify.Actor.setValue(debugKey, htmlDePaginaDetalle, { contentType: 'text/html' }); // Usar Apify.Actor.setValue
                    pageLog.info(`      (Guardé el HTML de esta página de detalle como "${debugKey}" para que lo revises en el Key-Value Store de Apify)`);
                }
            }
        },

        handleFailedRequestFunction: async ({ request, error, log: pageLog }) => {
            pageLog.error(`❌ ¡Ups! Falló la visita a ${request.url} (Etiqueta: ${request.userData.tipoDePagina}): ${error.message}`);
        },
    });

    Apify.Actor.log.info('▶️  El navegador robot va a empezar a visitar las páginas...');
    await navegadorRobot.run();
    Apify.Actor.log.info('🏁 ¡Trabajo terminado por el navegador robot!');
});
