// main.js - Instrucciones para nuestro robot
const { Actor, PuppeteerCrawler } = require('apify');

// Asegúrate de que Actor está inicializado antes de usar Actor.log si lo defines fuera de main.
// No es estrictamente necesario con Actor.main, pero no hace daño ser explícito.
// await Actor.init(); // Podrías añadir esto si el problema persistiera, pero probemos sin él primero.

Actor.main(async () => {
    // Obtén el logger directamente de Actor cada vez o así:
    const log = Actor.log; // Esto debería funcionar bien aquí.

    // Línea donde antes estaba el error (ahora podría ser una línea diferente si añadiste Actor.init())
    log.info('🤖 ¡Hola! Soy el robot de artículos, comenzando mi trabajo...');

    const input = await Actor.getInput();
    const paginaDeListaDeArticulos = input.startUrl;

    if (!paginaDeListaDeArticulos) {
        log.error('🆘 ¡Oh no! No me diste una "startUrl" para empezar. No puedo trabajar así.');
        await Actor.exit(1);
        return;
    }
    log.info(`🗺️ Voy a empezar mirando esta página: ${paginaDeListaDeArticulos}`);

    // 2. Preparar una "lista de tareas pendientes" para las páginas a visitar
    const colaDePaginas = await Actor.openRequestQueue(); // <--- CAMBIO AQUÍ TAMBIÉN
    await colaDePaginas.addRequest({
        url: paginaDeListaDeArticulos,
        userData: { tipoDePagina: 'LISTA_DE_ARTICULOS' },
    });

    // 3. Crear el "navegador robot" que visitará las páginas
    // PuppeteerCrawler se importa del módulo raíz, no de Actor
    const { PuppeteerCrawler } = require('apify'); // <--- IMPORTACIÓN ADICIONAL NECESARIA
    const navegadorRobot = new PuppeteerCrawler({ // <--- CAMBIO: No Apify.PuppeteerCrawler si desestructuraste
        requestQueue: colaDePaginas,
        launchContext: {
            launchOptions: { // Mejor usar launchOptions para los args
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
            useChrome: true, // Recomendado para Puppeteer
        },
        minConcurrency: 1,
        maxConcurrency: 1,
        maxRequestRetries: 1,
        handlePageTimeoutSecs: 180,

        handlePageFunction: async ({ request, page, log: pageLog }) => { // pageLog es útil
            const urlActual = request.url;
            const tipoDePagina = request.userData.tipoDePagina;

            pageLog.info(`📄 Estoy en [${tipoDePagina}]: ${urlActual}`);

            if (tipoDePagina === 'LISTA_DE_ARTICULOS') {
                pageLog.info('   🧐 Es una lista. Voy a buscar los enlaces a cada artículo...');
                const SELECTOR_DE_ENLACES_A_ARTICULOS = 'a.card__title-link';
                pageLog.info(`      Usando selector para enlaces de lista: "${SELECTOR_DE_ENLACES_A_ARTICULOS}"`);

                const urlsDeArticulos = await page.evaluate((selector) => {
                    // ... (código de evaluate sin cambios)
                }, SELECTOR_DE_ENLACES_A_ARTICULOS);

                pageLog.info(`   🔍 Encontré ${urlsDeArticulos.length} enlaces a artículos.`);
                if (urlsDeArticulos.length > 0) {
                    pageLog.info(`      Algunos ejemplos (max 3): ${urlsDeArticulos.slice(0, 3).join(' | ')}`);
                } else {
                    pageLog.warning('      ⚠️ ¡No encontré ningún enlace con ese selector! Revisa el SELECTOR_DE_ENLACES_A_ARTICULOS.');
                    const htmlDePaginaLista = await page.content();
                    await Actor.setValue('DEBUG_PAGINA_LISTA_HTML', htmlDePaginaLista, { contentType: 'text/html' }); // <--- CAMBIO
                    pageLog.info('      (Guardé el HTML de esta página de lista como "DEBUG_PAGINA_LISTA_HTML" para que lo revises en el Key-Value Store de Apify)');
                }

                for (const urlArticulo of urlsDeArticulos) {
                    // ... (código sin cambios significativos, solo usa pageLog)
                }

            } else if (tipoDePagina === 'PAGINA_DE_ARTICULO') {
                pageLog.info('   ✍️ Es la página de un artículo. Voy a extraer la información...');
                const SELECTOR_TITULO = 'h1#article-heading_1-0';
                const SELECTOR_CONTENIDO = 'div#article-body_1-0';
                pageLog.info(`      Usando selector de título: "${SELECTOR_TITULO}"`);
                pageLog.info(`      Usando selector de contenido: "${SELECTOR_CONTENIDO}"`);

                const datosExtraidos = await page.evaluate((selTitulo, selContenido) => {
                    // ... (código de evaluate sin cambios)
                }, SELECTOR_TITULO, SELECTOR_CONTENIDO);

                pageLog.info(`      Título encontrado: ${datosExtraidos.titulo}`);
                pageLog.info(`      Contenido encontrado (primeros 100 caracteres): ${datosExtraidos.contenido?.substring(0, 100)}...`);

                if (datosExtraidos.titulo || datosExtraidos.contenido) {
                    await Actor.pushData({ // <--- CAMBIO
                        urlDelArticulo: urlActual,
                        tituloDelArticulo: datosExtraidos.titulo,
                        textoDelArticulo: datosExtraidos.contenido?.trim(),
                    });
                    pageLog.info(`   💾 ¡Información guardada para: ${datosExtraidos.titulo || urlActual}!`);
                } else {
                    pageLog.warning(`      ⚠️ No pude extraer título o contenido de esta página de artículo: ${urlActual}`);
                    const htmlDePaginaDetalle = await page.content();
                    const debugKey = `DEBUG_PAGINA_DETALLE_HTML_${request.uniqueKey.replace(/[\/:\.]/g, '_')}`;
                    await Actor.setValue(debugKey, htmlDePaginaDetalle, { contentType: 'text/html' }); // <--- CAMBIO
                    pageLog.info(`      (Guardé el HTML de esta página de detalle como "${debugKey}" para que lo revises en el Key-Value Store de Apify)`);
                }
            }
        },

        handleFailedRequestFunction: async ({ request, log: pageLog, error }) => { // pageLog aquí también
            pageLog.error(`❌ ¡Ups! Falló la visita a ${request.url} (Etiqueta: ${request.userData.tipoDePagina}): ${error.message}`);
        },
    });

    log.info('▶️  El navegador robot va a empezar a visitar las páginas...');
    await navegadorRobot.run();
    log.info('🏁 ¡Trabajo terminado por el navegador robot!');
});
